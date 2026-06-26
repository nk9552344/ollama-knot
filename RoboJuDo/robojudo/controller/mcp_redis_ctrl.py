import json
import logging
import time
from collections import deque
from threading import Thread

import redis
from redis.exceptions import RedisError

from robojudo.controller import Controller, ctrl_registry
from robojudo.controller.ctrl_cfgs import McpRedisCtrlCfg

logger = logging.getLogger(__name__)


@ctrl_registry.register
class McpRedisCtrl(Controller):
    """Bridge between the MCP server (``mcp_g1/server.py``) and the RoboJuDo
    pipeline, communicating exclusively over two Redis lists.

    Contract (must stay in lockstep with ``mcp_g1/server.py``)
    ---------------------------------------------------------
    Inbound — ``command_queue`` (default ``policy:commands``), Redis LIST:
        The MCP server ``RPUSH``-es **plain policy IDs** (one per execution).
        Each ID is a string matching an ``id`` in ``mcp_g1/policies.yaml``,
        which is itself the mimic-policy filename loaded by the pipeline
        (e.g. ``video_017``, ``video_033``). This controller ``LPOP``-s them
        in FIFO order. **No internal protocol tokens** (``[...]``, ``SELECT:``)
        ever appear on this queue — the MCP server validates IDs against the
        registry before pushing, and ``execute_policies`` enqueues batches
        atomically via a single multi-arg ``RPUSH``.

            # MCP side (mcp_g1/server.py)
            redis_client.rpush("policy:commands", "video_017")
            redis_client.rpush("policy:commands", "video_033", "video_017")

    Outbound — ``event_queue`` (default ``policy:events``), Redis LIST:
        Structured JSON events with a single schema (consumed by the MCP
        server's ``wait_for_event`` tool):

            {"timestamp": <float>, "type": <str>, "policy_id": <str>, "message": <str>}

        Event types: ``ready``, ``policy_started``, ``policy_completed``,
        ``policy_failed``, ``shutdown``, ``motion_reset``.

    The pipeline's internal command bus (``[POLICY_SWITCH]``/``[POLICY_MIMIC]``/
    ``[POLICY_LOCO]``) is driven locally by this controller in response to the
    popped IDs and never crosses the Redis boundary.

    Scheduling guarantees
    ---------------------
    The MCP server only ever pushes **active (mimic) policy IDs** — the loco
    policy is the local default and is never enqueued. This controller weaves
    loco between every queued policy:

        [loco (default)] → [policy_a] → [loco (transition)]
                          → [policy_b] → [loco (transition)]
                          → ... → [loco (idle, queue empty)]

    * Locomotion is the default idle state — when the queue is empty the robot
      stays in loco.
    * Each queued policy runs exactly once and to completion before the next
      is popped (FIFO).
    * Every policy transition passes through locomotion: the pipeline's
      ``[MOTION_DONE]`` → ``[POLICY_LOCO]`` auto-handoff fires when each mimic
      finishes, and ``loco_transition_hold_steps`` lets the mimic→loco
      interpolation settle before the next ``switch_to_mimic()`` runs.
    """

    cfg_ctrl: McpRedisCtrlCfg

    def __init__(self, cfg_ctrl: McpRedisCtrlCfg, env=None, device="cpu"):
        super().__init__(cfg_ctrl=cfg_ctrl, env=env, device=device)

        self.command_queue = cfg_ctrl.command_queue
        self.event_queue = cfg_ctrl.event_queue
        self.publish_events = cfg_ctrl.publish_events
        self.event_history_max = cfg_ctrl.event_history_max
        self.loco_transition_hold_steps = cfg_ctrl.loco_transition_hold_steps

        # Inbound queue of raw policy IDs LPOP-ed from Redis. process_triggers
        # consumes one at a time and translates each into the internal command
        # sequence required to switch + start the matching mimic policy.
        self._inbound: deque[str] = deque(maxlen=256)
        self._stop = False

        self._redis_client: redis.Redis | None = None
        self._connect_redis_blocking()

        self._inbound_thread = Thread(target=self._inbound_worker, daemon=True)
        self._inbound_thread.start()

        # Policy-ID → internal mimic index, populated by the pipeline after
        # construction (see RlLocoMimicPipeline.__init__). Policy IDs match
        # the policy filenames so the MCP server never needs to know indices.
        self._policy_id_to_idx: dict[str, int] = {}

        # ── Execution state machine ──────────────────────────────────────
        self._policy_in_flight: str | None = None
        """Policy ID we've dispatched and are waiting on. None means we're
        idle in loco and may pop the next queued ID."""

        self._pending_switch: tuple[str, int] | None = None
        """(policy_id, mimic_idx) primed by process_triggers to emit
        '[POLICY_SWITCH],N' on the next tick."""

        self._pending_kick: bool = False
        """True between emitting '[POLICY_SWITCH],N' and emitting '[POLICY_MIMIC]'.
        The two tokens must arrive on separate ticks because CtrlManager merges
        commands across controllers through a set, which loses ordering — so
        the pipeline must see SWITCH (which only updates policy_mimic_idx)
        before MIMIC (which triggers switch_to_mimic() using that idx)."""

        self._loco_hold_remaining = 0
        """Ticks remaining before the next queued policy may be dispatched.
        Set when [POLICY_LOCO] is observed so the mimic→loco interpolation in
        PolicyInterpManager can finish before the next switch_to_mimic() runs;
        otherwise the pipeline silently rejects the switch."""

        self._publish_event("ready")
        logger.info(
            "[McpRedisCtrl] Initialized. command_queue=%r event_queue=%r",
            self.command_queue,
            self.event_queue,
        )

    # ───────────── Controller protocol ─────────────

    def set_mimic_names(self, names: list[str]) -> None:
        """Register the policy IDs the pipeline knows about.

        Policy IDs in the MCP protocol are the mimic-policy filenames; the
        pipeline assigns each one an internal index. We use that index to
        translate a queued ID into the '[POLICY_SWITCH],N' token the pipeline
        expects, so the MCP server never has to know about indices.

        Idempotent — safe to call again to refresh after reconfiguration."""
        self._policy_id_to_idx = {name: idx for idx, name in enumerate(names)}
        logger.info(
            "[McpRedisCtrl] Registered %d policy IDs: %s",
            len(self._policy_id_to_idx),
            list(self._policy_id_to_idx),
        )

    def reset(self):
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

        # Idle: pop the next queued policy ID — but only once we're back in loco
        # AND the mimic→loco interpolation hold has elapsed.
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
        """Observe the final command list (including pipeline-appended ones such
        as the [POLICY_LOCO] auto-inserted on [MOTION_DONE]) and publish events.
        Also drives the loco-interpolation hold-down timer."""
        if self._loco_hold_remaining > 0:
            self._loco_hold_remaining -= 1

        for cmd in commands or []:
            if cmd == "[POLICY_LOCO]":
                # The pipeline auto-emits [POLICY_LOCO] when the current mimic
                # finishes (via [MOTION_DONE]). It also fires on manual loco
                # overrides (e.g. a keyboard '['). Either way, whatever was in
                # flight is no longer running.
                if self._policy_in_flight is not None:
                    completed = self._policy_in_flight
                    self._policy_in_flight = None
                    self._publish_event("policy_completed", policy_id=completed)
                # Start (or restart) the hold so the next queued policy waits
                # for the mimic→loco interpolation in PolicyInterpManager to
                # finish.
                self._loco_hold_remaining = self.loco_transition_hold_steps
            elif cmd == "[SHUTDOWN]":
                self._publish_event(
                    "shutdown",
                    policy_id=self._policy_in_flight or "",
                )
            elif cmd == "[MOTION_RESET]":
                self._publish_event(
                    "motion_reset",
                    policy_id=self._policy_in_flight or "",
                )

    # ───────────── Internals ─────────────

    def _inbound_worker(self):
        """Poll the Redis list for policy IDs; never block the main thread."""
        backoff = 0.005
        while not self._stop:
            client = self._redis_client
            if client is None:
                client = self._connect_redis_blocking()
                if client is None:
                    return
            try:
                # LPOP returns None when empty; a short sleep keeps the worker
                # responsive to _stop without an extra signaling thread.
                item = client.lpop(self.command_queue)
            except RedisError as e:
                logger.warning("[McpRedisCtrl] Redis lost (%s); reconnecting", e)
                self._redis_client = None
                time.sleep(0.5)
                continue
            if item is None:
                time.sleep(backoff)
                continue
            try:
                text = (
                    item.decode()
                    if isinstance(item, (bytes, bytearray))
                    else str(item)
                ).strip()
            except Exception:
                logger.warning("[McpRedisCtrl] Could not decode item: %r", item)
                continue
            if not text:
                continue
            self._inbound.append(text)

    def _connect_redis_blocking(self) -> redis.Redis | None:
        delay = 0.5
        while not self._stop:
            try:
                client = redis.Redis(
                    host=self.cfg_ctrl.redis_host,
                    port=self.cfg_ctrl.redis_port,
                    db=self.cfg_ctrl.redis_db,
                    socket_timeout=1,
                    socket_connect_timeout=1,
                )
                client.ping()
                logger.info(
                    "[McpRedisCtrl] Redis connected (%s:%s)",
                    self.cfg_ctrl.redis_host,
                    self.cfg_ctrl.redis_port,
                )
                self._redis_client = client
                return client
            except Exception as e:
                logger.error(
                    "[McpRedisCtrl] Redis connect failed: %s; retrying in %ss",
                    e,
                    delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, 5.0)
        return None

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
        except RedisError as e:
            logger.warning(
                "[McpRedisCtrl] Could not publish event %r: %s", event_type, e
            )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ctrl = McpRedisCtrl(cfg_ctrl=McpRedisCtrlCfg(), env=None)
    print(
        "Listening on",
        ctrl.command_queue,
        "— push a policy ID (matching mcp_g1/policies.yaml) with:",
    )
    print(f"  redis-cli RPUSH {ctrl.command_queue} 'video_017'")
    while True:
        data = ctrl.get_data()
        _, cmds = ctrl.process_triggers(data)
        if cmds:
            print("Emitting:", cmds)
            ctrl.post_step_callback(cmds)
        time.sleep(0.05)
