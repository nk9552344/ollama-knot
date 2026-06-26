"""Consume policy IDs from the ``mcp_g1/server.py`` MCP server over Redis and
drive them through the RoboJuDo pipeline as loco→policy→loco→… sequences.

Wire contract — **identical** to ``mcp_g1/server.py``
=====================================================
Both sides connect with the same call:

    redis.Redis.from_url(REDIS_URL, decode_responses=True)

so push/pop go through the exact same client config, and queue items are
always ``str`` (never ``bytes``).

MCP side (``mcp_g1/server.py``)::

    redis_client.rpush("policy:commands", "video_017")           # execute_policy
    redis_client.rpush("policy:commands", "video_033", "video_017")  # execute_policies

Robot side (this file)::

    redis_client.blpop(["policy:commands"], timeout=1)  # returns ("policy:commands", "video_017")

Each queue item is a plain policy ID matching an ``id`` in
``mcp_g1/policies.yaml`` (which is also the mimic-policy ONNX filename loaded
by the pipeline, e.g. ``video_017``, ``video_033``).

Outbound events (``policy:events``) — JSON schema consumed by the MCP server's
``wait_for_event`` tool::

    {"timestamp": <float>, "type": <str>, "policy_id": <str>, "message": <str>}

Event types: ``ready``, ``policy_queued``, ``policy_started``,
``policy_completed``, ``policy_failed``, ``shutdown``, ``motion_reset``.

* ``policy_queued`` is published by this controller every time a policy ID is
  successfully BLPOP-ed from the command queue (before it's dispatched). This
  lets you confirm the receive side is alive from ``redis-cli MONITOR``
  without reading pipeline logs.

Scheduling
==========
The MCP server only ever pushes **active (mimic) policy IDs**. The loco policy
is the local default and is never enqueued. This controller weaves loco between
every queued policy::

    [loco (default)] → [policy_a] → [loco (transition)]
                     → [policy_b] → [loco (transition)]
                     → ... → [loco (idle, queue empty)]

* Locomotion is the default idle state — when the queue is empty the robot
  stays in loco.
* Each queued policy runs exactly once and to completion (FIFO).
* Every policy transition passes through locomotion: the pipeline's
  ``[MOTION_DONE] → [POLICY_LOCO]`` auto-handoff fires when each mimic
  finishes, and ``loco_transition_hold_steps`` lets the mimic→loco
  interpolation settle before the next ``switch_to_mimic()`` runs.
"""

from __future__ import annotations

import json
import logging
import os
import time
import traceback
from collections import deque
from threading import Thread

import redis
from redis.exceptions import RedisError

from robojudo.controller import Controller, ctrl_registry
from robojudo.controller.ctrl_cfgs import McpRedisCtrlCfg

logger = logging.getLogger(__name__)

# Default queue names — must match ``mcp_g1/server.py`` and
# ``RoboJuDo/mcp_server/server.py`` (both default to the same strings). These
# are the final fallback if neither the cfg nor any env var is set.
DEFAULT_COMMAND_QUEUE = "policy:commands"
DEFAULT_EVENT_QUEUE = "policy:events"


@ctrl_registry.register
class McpRedisCtrl(Controller):
    cfg_ctrl: McpRedisCtrlCfg

    def __init__(self, cfg_ctrl: McpRedisCtrlCfg, env=None, device="cpu"):
        super().__init__(cfg_ctrl=cfg_ctrl, env=env, device=device)

        # Queue names — ROBOJUDO_* env vars match test_client.py; legacy
        # COMMAND_QUEUE_NAME / EVENT_QUEUE_NAME are also accepted for
        # back-compat. Final fallback is the module-level default constant
        # so that even an unconfigured controller talks to the right queues.
        self.command_queue = (
            os.getenv("ROBOJUDO_COMMAND_QUEUE")
            or os.getenv("COMMAND_QUEUE_NAME")
            or cfg_ctrl.command_queue
            or DEFAULT_COMMAND_QUEUE
        )
        self.event_queue = (
            os.getenv("ROBOJUDO_EVENT_QUEUE")
            or os.getenv("EVENT_QUEUE_NAME")
            or cfg_ctrl.event_queue
            or DEFAULT_EVENT_QUEUE
        )
        self.redis_url = self._resolve_redis_url(cfg_ctrl)

        self.publish_events = cfg_ctrl.publish_events
        self.event_history_max = cfg_ctrl.event_history_max
        self.loco_transition_hold_steps = cfg_ctrl.loco_transition_hold_steps

        # Inbound queue of policy IDs BLPOP-ed from Redis. process_triggers
        # consumes one at a time and translates each into the internal command
        # sequence required to switch + start the matching mimic policy.
        self._inbound: deque[str] = deque(maxlen=256)
        self._stop = False

        # ── Execution state machine ──────────────────────────────────────
        # Policy ID we've dispatched and are waiting on. None means we're idle
        # in loco and may pop the next queued ID.
        self._policy_in_flight: str | None = None
        # (policy_id, mimic_idx) primed by process_triggers to emit
        # '[POLICY_SWITCH],N' on the next tick.
        self._pending_switch: tuple[str, int] | None = None
        # True between emitting '[POLICY_SWITCH],N' and emitting '[POLICY_MIMIC]'.
        # The two tokens must arrive on separate ticks because CtrlManager merges
        # commands across controllers through a set, which loses ordering — so
        # the pipeline must see SWITCH (which only updates policy_mimic_idx)
        # before MIMIC (which triggers switch_to_mimic() using that idx).
        self._pending_kick: bool = False
        # Ticks remaining before the next queued policy may be dispatched.
        # Set when [POLICY_LOCO] is observed so the mimic→loco interpolation
        # in PolicyInterpManager can finish before the next switch_to_mimic()
        # runs; otherwise the pipeline silently rejects the switch.
        self._loco_hold_remaining = 0

        # Policy-ID → internal mimic index, populated by the pipeline after
        # construction (see RlLocoMimicPipeline.__init__). IDs match policy
        # filenames so the MCP server never needs to know indices.
        self._policy_id_to_idx: dict[str, int] = {}

        # Connect synchronously so we fail fast if Redis isn't reachable, then
        # start the background BLPOP worker.
        self._redis_client: redis.Redis | None = None
        self._connect_redis_blocking()
        self._inbound_thread = Thread(
            target=self._inbound_worker_safe,
            name="McpRedisCtrl-inbound",
            daemon=True,
        )
        self._inbound_thread.start()

        self._publish_event("ready")
        # Use logger.info AND a print so the message is visible even when the
        # caller hasn't configured logging — the #1 symptom of a "silent"
        # controller is that the worker thread isn't running.
        banner = (
            f"[McpRedisCtrl] Ready. url={self.redis_url!r} "
            f"command_queue={self.command_queue!r} event_queue={self.event_queue!r}"
        )
        logger.info(banner)
        print(banner, flush=True)

    # ─────────────── Connection helpers ───────────────

    @staticmethod
    def _resolve_redis_url(cfg_ctrl: McpRedisCtrlCfg) -> str:
        """Pick the Redis URL using the same precedence as ``mcp_g1/server.py``:
        cfg field → ``$REDIS_URL`` env var → host/port/db fallback.

        Using one URL string everywhere eliminates the common "RPUSH works but
        nothing pops" failure mode where the producer and consumer talk to
        different Redis instances.
        """
        if cfg_ctrl.redis_url:
            return cfg_ctrl.redis_url
        env_url = os.getenv("REDIS_URL")
        if env_url:
            return env_url
        # ROBOJUDO_REDIS_* mirrors the env vars used by test_client.py so that
        # a single .env configures both the controller and the test harness.
        host = os.getenv("ROBOJUDO_REDIS_HOST") or os.getenv("REDIS_HOST") or cfg_ctrl.redis_host
        port = os.getenv("ROBOJUDO_REDIS_PORT") or os.getenv("REDIS_PORT") or str(cfg_ctrl.redis_port)
        db = os.getenv("ROBOJUDO_REDIS_DB") or os.getenv("REDIS_DB") or str(cfg_ctrl.redis_db)
        return f"redis://{host}:{port}/{db}"

    def _new_client(self) -> redis.Redis:
        """Build a Redis client with the exact same call as ``mcp_g1/server.py``
        so push and pop go through identical client configuration."""
        return redis.Redis.from_url(
            self.redis_url,
            decode_responses=True,
            socket_connect_timeout=2,
            # BLPOP must outlive socket_timeout, so keep socket_timeout None
            # for the worker connection (BLPOP timeout is enforced server-side).
        )

    def _connect_redis_blocking(self) -> redis.Redis | None:
        delay = 0.5
        while not self._stop:
            try:
                client = self._new_client()
                client.ping()
                logger.info("[McpRedisCtrl] Redis connected (%s)", self.redis_url)
                self._redis_client = client
                return client
            except Exception as e:
                logger.error(
                    "[McpRedisCtrl] Redis connect failed (%s): %s; retrying in %ss",
                    self.redis_url,
                    e,
                    delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, 5.0)
        return None

    # ─────────────── Controller protocol ───────────────

    def set_mimic_names(self, names: list[str]) -> None:
        """Register the policy IDs the pipeline knows about.

        IDs match mimic-policy filenames; the pipeline assigns each one an
        internal index. We translate a queued ID into the
        '[POLICY_SWITCH],N' token the pipeline expects, so the MCP server
        never has to know about indices. Idempotent."""
        self._policy_id_to_idx = {name: idx for idx, name in enumerate(names)}
        logger.info(
            "[McpRedisCtrl] Registered %d policy IDs: %s",
            len(self._policy_id_to_idx),
            list(self._policy_id_to_idx),
        )

    def reset(self):
        logger.info(
            "[McpRedisCtrl] [RESET] clearing state (was in_flight=%r, pending=%d)",
            self._policy_in_flight,
            len(self._inbound),
        )
        self._inbound.clear()
        self._policy_in_flight = None
        self._pending_switch = None
        self._pending_kick = False
        self._loco_hold_remaining = 0
        self._publish_event("ready")

    def get_data(self):
        return {
            "mcp_pending": len(self._inbound),
            "mcp_in_flight": self._policy_in_flight or "",
        }

    def process_triggers(self, ctrl_data):
        commands: list[str] = []

        # Stage 2: emit '[POLICY_MIMIC]' one tick after '[POLICY_SWITCH],N'.
        if self._pending_kick:
            self._pending_kick = False
            commands.append("[POLICY_MIMIC]")
            return ctrl_data, commands

        # Stage 1: emit '[POLICY_SWITCH],N' for the primed policy.
        if self._pending_switch is not None:
            policy_id, idx = self._pending_switch
            self._pending_switch = None
            self._policy_in_flight = policy_id
            self._pending_kick = True
            commands.append(f"[POLICY_SWITCH],{idx}")
            self._publish_event("policy_started", policy_id=policy_id)
            logger.info(
                "[McpRedisCtrl] Dispatching policy %r (idx=%d).", policy_id, idx
            )
            return ctrl_data, commands

        # Idle: pop the next queued policy ID — but only once we're back in
        # loco AND the mimic→loco interpolation hold has elapsed.
        if (
            self._policy_in_flight is None
            and self._loco_hold_remaining == 0
            and self._inbound
        ):
            policy_id = self._inbound.popleft()
            idx = self._policy_id_to_idx.get(policy_id)
            if idx is None:
                logger.warning(
                    "[McpRedisCtrl] Unknown policy id %r. Known: %s",
                    policy_id,
                    list(self._policy_id_to_idx),
                )
                self._publish_event(
                    "policy_failed",
                    policy_id=policy_id,
                    message=(
                        f"Unknown policy id {policy_id!r}. "
                        f"Known: {list(self._policy_id_to_idx)}"
                    ),
                )
            else:
                self._pending_switch = (policy_id, idx)

        return ctrl_data, commands

    def post_step_callback(self, commands: list[str] | None = None):
        """Observe the final command list (including pipeline-appended ones
        such as the [POLICY_LOCO] auto-inserted on [MOTION_DONE]) and publish
        events. Also drives the loco-interpolation hold-down timer."""
        if self._loco_hold_remaining > 0:
            self._loco_hold_remaining -= 1

        for cmd in commands or []:
            if cmd == "[POLICY_LOCO]":
                # Pipeline auto-emits [POLICY_LOCO] when the current mimic
                # finishes (via [MOTION_DONE]). It also fires on manual loco
                # overrides (e.g. a keyboard ']'). Either way, whatever was
                # in flight is no longer running.
                if self._policy_in_flight is not None:
                    completed = self._policy_in_flight
                    self._policy_in_flight = None
                    logger.info(
                        "[McpRedisCtrl] [COMPLETE] policy_id=%r → [POLICY_LOCO] "
                        "received, loco hold starting (%d steps, pending=%d)",
                        completed,
                        self.loco_transition_hold_steps,
                        len(self._inbound),
                    )
                    self._publish_event("policy_completed", policy_id=completed)
                else:
                    logger.info(
                        "[McpRedisCtrl] [LOCO]     [POLICY_LOCO] received "
                        "(no policy in flight)"
                    )
                # Start (or restart) the hold so the next queued policy waits
                # for the mimic→loco interpolation in PolicyInterpManager to
                # finish.
                self._loco_hold_remaining = self.loco_transition_hold_steps
            elif cmd == "[SHUTDOWN]":
                logger.info(
                    "[McpRedisCtrl] [SHUTDOWN] received, in_flight=%r",
                    self._policy_in_flight or "",
                )
                self._publish_event(
                    "shutdown", policy_id=self._policy_in_flight or ""
                )
            elif cmd == "[MOTION_RESET]":
                logger.info(
                    "[McpRedisCtrl] [MOTION_RESET] received, in_flight=%r",
                    self._policy_in_flight or "",
                )
                self._publish_event(
                    "motion_reset", policy_id=self._policy_in_flight or ""
                )

    # ─────────────── Inbound worker (background thread) ───────────────

    def _inbound_worker_safe(self):
        """Top-level guard: catches any otherwise-silent crash in the worker
        and logs a full traceback. Daemon threads die silently by default;
        this is the most common cause of RPUSH succeeding while nothing
        pops from the command queue.
        """
        try:
            self._inbound_worker()
        except BaseException:
            logger.critical(
                "[McpRedisCtrl] [WORKER_CRASH] Inbound worker crashed — no more "
                "policies will be popped from %r. Traceback:\n%s",
                self.command_queue,
                traceback.format_exc(),
            )
            # Also print so it's visible even without logging configured.
            print(
                f"[McpRedisCtrl] INBOUND WORKER CRASHED on queue "
                f"{self.command_queue!r}:\n{traceback.format_exc()}",
                flush=True,
            )

    def _inbound_worker(self):
        """Block on BLPOP for each policy ID. BLPOP is preferred over LPOP
        polling because it shows up in redis-cli MONITOR as a client
        subscription (making it obvious from the outside that the consumer
        is alive), has lower CPU, and gives sub-millisecond dispatch latency.
        The 1-second timeout keeps us responsive to self._stop.

        Every successful pop also publishes a 'policy_queued' event to the
        event queue so the dispatch is visible end-to-end in MONITOR.
        """
        last_listen_log = 0.0
        while not self._stop:
            client = self._redis_client
            if client is None:
                client = self._connect_redis_blocking()
                if client is None:
                    return  # shutdown

            try:
                result = client.blpop([self.command_queue], timeout=1)
            except RedisError as e:
                logger.warning(
                    "[McpRedisCtrl] [BLPOP_ERR] %s; reconnecting", e
                )
                self._redis_client = None
                time.sleep(0.5)
                continue

            if result is None:
                # Timeout — queue empty. Re-log every 30 s so the user can
                # confirm the worker is alive without flooding the log.
                now = time.time()
                if now - last_listen_log >= 30.0:
                    logger.info(
                        "[McpRedisCtrl] [LISTEN]   waiting on %r (queue empty)…",
                        self.command_queue,
                    )
                    last_listen_log = now
                continue

            # decode_responses=True → result is (queue_name: str, value: str).
            _queue_name, raw = result
            text = str(raw).strip()
            if not text:
                logger.warning(
                    "[McpRedisCtrl] [POP]      ignoring empty item from %r",
                    self.command_queue,
                )
                continue

            self._inbound.append(text)
            logger.info(
                "[McpRedisCtrl] [POP]      policy_id=%r from %r (inbound=%d)",
                text,
                self.command_queue,
                len(self._inbound),
            )
            # User-requested: publish a `policy_queued` event for every
            # successful pop so the receive side is auditable from MONITOR
            # without having to read the pipeline logs.
            self._publish_event(
                "policy_queued",
                policy_id=text,
                message=(
                    f"Popped from {self.command_queue}; "
                    f"inbound_pending={len(self._inbound)}"
                ),
            )
            last_listen_log = 0.0  # reset so LISTEN logs again once queue drains

    # ─────────────── Event publishing ───────────────

    def _publish_event(
        self,
        event_type: str,
        *,
        policy_id: str = "",
        message: str = "",
    ) -> None:
        if not self.publish_events:
            return
        client = self._redis_client
        if client is None:
            return
        payload = {
            "timestamp": time.time(),
            "type": event_type,
            "policy_id": policy_id,
            "message": message,
        }
        try:
            pipe = client.pipeline()
            pipe.rpush(self.event_queue, json.dumps(payload))
            if self.event_history_max > 0:
                pipe.ltrim(self.event_queue, -self.event_history_max, -1)
            pipe.execute()
            logger.debug(
                "[McpRedisCtrl] [EVENT]    published %r policy_id=%r → %r",
                event_type,
                policy_id,
                self.event_queue,
            )
        except RedisError as e:
            logger.warning(
                "[McpRedisCtrl] [EVENT_ERR] could not publish %r: %s",
                event_type,
                e,
            )


if __name__ == "__main__":
    # Standalone smoke test — no pipeline, no env. Verifies the Redis bridge
    # end-to-end against either MCP server:
    #
    #   1. python -m robojudo.controller.mcp_redis_ctrl    (in this shell)
    #   2. redis-cli RPUSH policy:commands video_017       (in another shell)
    #
    # You should see the controller log:
    #   [POP]      policy_id='video_017' from 'policy:commands' (inbound=1)
    #   [POLICY_SWITCH],0
    #   [POLICY_MIMIC]
    #   [COMPLETE] policy_id='video_017' …
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    ctrl = McpRedisCtrl(cfg_ctrl=McpRedisCtrlCfg(), env=None)
    # Pre-register the demo policy IDs so the dispatch loop is exercisable
    # without the full pipeline calling set_mimic_names().
    ctrl.set_mimic_names(["video_017", "video_025", "video_033"])
    print(
        f"Listening on {ctrl.command_queue!r}. Push a policy ID with:\n"
        f"  redis-cli RPUSH {ctrl.command_queue} 'video_017'",
        flush=True,
    )
    while True:
        data = ctrl.get_data()
        _, cmds = ctrl.process_triggers(data)
        if cmds:
            print("Emitting:", cmds, flush=True)
            ctrl.post_step_callback(cmds)
            # Simulate the pipeline completing the motion so that
            # (a) policy_completed is published to policy:events and
            # (b) _policy_in_flight is cleared so the next queued policy runs.
            if "[POLICY_MIMIC]" in cmds:
                time.sleep(1.0)
                print("Simulating motion done → [POLICY_LOCO]", flush=True)
                ctrl.post_step_callback(["[POLICY_LOCO]"])
        time.sleep(0.05)
