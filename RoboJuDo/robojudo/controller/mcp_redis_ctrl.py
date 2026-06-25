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
    """Bridge between an external MCP server (or any other client) and the RoboJuDo
    pipeline command bus over Redis.

    Inbound:  LPOP <cmd_key>   → injects strings into ctrl_data["COMMANDS"].
    Outbound: RPUSH <event_key> with transition events the server can BLPOP on.

    The pipeline is *always* running a policy (loco by default, mimic when the
    server pushes [POLICY_MIMIC]), so there is never any dead time between
    motions — perfect for sim2real safety.
    """

    cfg_ctrl: McpRedisCtrlCfg

    def __init__(self, cfg_ctrl: McpRedisCtrlCfg, env=None, device="cpu"):
        super().__init__(cfg_ctrl=cfg_ctrl, env=env, device=device)

        self.cmd_key = cfg_ctrl.cmd_key
        self.event_key = cfg_ctrl.event_key
        self.publish_events = cfg_ctrl.publish_events
        self.event_history_max = cfg_ctrl.event_history_max
        self.loco_transition_hold_steps = cfg_ctrl.loco_transition_hold_steps

        self.cmd_buffer: deque[str] = deque(maxlen=256)
        self._stop = False

        self._redis_client: redis.Redis | None = None
        self._connect_redis_blocking()

        self._inbound_thread = Thread(target=self._inbound_worker, daemon=True)
        self._inbound_thread.start()

        # Track previous policy state so we can emit edge-triggered events.
        self._prev_in_mimic = False
        self._current_mimic_name: str | None = None

        # Name→index map for mimic policies, populated by the pipeline after
        # construction. Lets us rewrite '[POLICY_SWITCH],N' tokens that follow
        # 'SELECT:<name>' so external producers (e.g. a separate MCP server)
        # don't need to know the pipeline's mimic-policy ordering.
        self._mimic_name_to_idx: dict[str, int] = {}
        self._pending_idx_override: int | None = None

        # Loco-interpolation gate. While > 0 we refuse to forward [POLICY_MIMIC]
        # so the previous mimic→loco transition can complete.
        self._loco_hold_remaining = 0

        self._publish_event("READY")
        logger.info(
            f"[McpRedisCtrl] Initialized. cmd_key={self.cmd_key!r} event_key={self.event_key!r}"
        )

    # ───────────── Controller protocol ─────────────

    def set_mimic_names(self, names: list[str]) -> None:
        """Populate the name→index map used to rewrite '[POLICY_SWITCH],N' after
        a 'SELECT:<name>' side-channel command. Idempotent; call again to refresh."""
        self._mimic_name_to_idx = {name: idx for idx, name in enumerate(names)}
        logger.info(f"[McpRedisCtrl] Registered {len(names)} mimic names: {list(self._mimic_name_to_idx)}")

    def reset(self):
        self.cmd_buffer.clear()
        self._prev_in_mimic = False
        self._current_mimic_name = None
        self._pending_idx_override = None
        self._loco_hold_remaining = 0
        self._publish_event("RESET")

    def get_data(self):
        return {"mcp_pending": len(self.cmd_buffer)}

    def process_triggers(self, ctrl_data):
        # Emit at most ONE real command per tick. The CtrlManager merges commands
        # from all controllers through a set, which loses ordering — so
        # sequencing-sensitive pairs like ([POLICY_SWITCH],N + [POLICY_MIMIC])
        # must hit separate ticks. At 50 Hz this adds at most ~20 ms latency.
        # SELECT:<name> is metadata, not a real command — we consume any leading
        # SELECTs inline in the same tick so they stay glued to the POLICY_SWITCH
        # that follows them (otherwise a batched RPUSH of two motions would let
        # the second SELECT overwrite the first before its POLICY_SWITCH ran).
        commands: list[str] = []
        while self.cmd_buffer:
            head = self.cmd_buffer[0]

            if head.startswith("SELECT:"):
                self.cmd_buffer.popleft()
                self._apply_select(head[len("SELECT:") :])
                continue

            # Hold [POLICY_MIMIC] until the pipeline is back in loco AND the
            # mimic→loco interpolation has finished. Otherwise switch_to_mimic()
            # is silently rejected ('Already in mimic policy') and the next
            # motion is dropped. Crucially this also blocks a pre-queued mimic
            # while a previous mimic is still playing (batched RPUSH from the
            # docker MCP server's push_policy_sequence).
            if head == "[POLICY_MIMIC]" and (
                self._prev_in_mimic or self._loco_hold_remaining > 0
            ):
                return ctrl_data, commands

            cmd = self.cmd_buffer.popleft()
            # If the most recent SELECT:<name> resolved to a known mimic index,
            # rewrite the very next [POLICY_SWITCH],N so external producers
            # (e.g. the docker MCP server's hardcoded POLICY_MIMIC_INDEX) don't
            # need to know our local mimic ordering.
            if cmd.startswith("[POLICY_SWITCH],") and self._pending_idx_override is not None:
                original = cmd
                cmd = f"[POLICY_SWITCH],{self._pending_idx_override}"
                if original != cmd:
                    logger.info(
                        f"[McpRedisCtrl] Rewrote {original!r} → {cmd!r} for mimic "
                        f"{self._current_mimic_name!r}"
                    )
                self._pending_idx_override = None
            commands.append(cmd)
            logger.info(f"[McpRedisCtrl] Emitting command: {cmd}")
            break
        return ctrl_data, commands

    def _apply_select(self, name: str) -> None:
        """Side-channel SELECT:<name> handler. Sets the event label and primes a
        one-shot index override for the next [POLICY_SWITCH],N."""
        self._current_mimic_name = name
        idx = self._mimic_name_to_idx.get(name)
        if idx is not None:
            self._pending_idx_override = idx
        elif self._mimic_name_to_idx:
            logger.warning(
                f"[McpRedisCtrl] SELECT:{name!r} — unknown mimic name. "
                f"Known: {list(self._mimic_name_to_idx)}. "
                "Falling back to whatever [POLICY_SWITCH],N follows."
            )

    def post_step_callback(self, commands: list[str] | None = None):
        """Observe the final command list (including pipeline-appended ones such
        as the [POLICY_LOCO] auto-inserted on [MOTION_DONE]) and publish events.
        Also drives the loco-interpolation hold-down timer."""
        # Tick down the loco hold and publish LOCO_READY on the edge.
        if self._loco_hold_remaining > 0:
            self._loco_hold_remaining -= 1
            if self._loco_hold_remaining == 0:
                self._publish_event("LOCO_READY")

        if not self.publish_events:
            return
        for cmd in commands or []:
            if cmd == "[POLICY_LOCO]":
                if self._prev_in_mimic:
                    name = self._current_mimic_name or "?"
                    self._publish_event(f"MIMIC_DONE:{name}")
                    self._current_mimic_name = None
                self._prev_in_mimic = False
                self._publish_event("LOCO_ACTIVE")
                # Start (or restart) the hold so the next mimic waits for the
                # mimic→loco interpolation in PolicyInterpManager to finish.
                self._loco_hold_remaining = self.loco_transition_hold_steps
            elif cmd == "[POLICY_MIMIC]":
                self._prev_in_mimic = True
                # name is set by the server right before pushing POLICY_MIMIC
                self._publish_event(f"MIMIC_STARTED:{self._current_mimic_name or '?'}")
            elif cmd.startswith("[POLICY_SWITCH]"):
                # Tracked via the SELECT:<name> side-channel below.
                pass
            elif cmd == "[SHUTDOWN]":
                self._publish_event("SHUTDOWN")
            elif cmd == "[MOTION_RESET]":
                self._publish_event("MOTION_RESET")

    # ───────────── Internals ─────────────

    def _inbound_worker(self):
        """Poll the Redis list for command strings; never block the main thread."""
        backoff = 0.005
        while not self._stop:
            client = self._redis_client
            if client is None:
                client = self._connect_redis_blocking()
                if client is None:
                    return
            try:
                # LPOP returns None when empty; use a short sleep instead of BLPOP
                # to keep the worker responsive to _stop without an extra thread.
                item = client.lpop(self.cmd_key)
            except RedisError as e:
                logger.warning(f"[McpRedisCtrl] Redis lost ({e}); reconnecting")
                self._redis_client = None
                time.sleep(0.5)
                continue
            if item is None:
                time.sleep(backoff)
                continue
            try:
                text = item.decode() if isinstance(item, (bytes, bytearray)) else str(item)
            except Exception:
                logger.warning(f"[McpRedisCtrl] Could not decode item: {item!r}")
                continue

            # SELECT:<name> is metadata that must stay in order with its
            # POLICY_SWITCH/POLICY_MIMIC. Push it onto cmd_buffer like any
            # other token; process_triggers consumes it inline in the right
            # tick. (Consuming SELECTs eagerly here used to let a batched RPUSH
            # of multiple motions overwrite each other's index override.)
            self.cmd_buffer.append(text)

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
                    f"[McpRedisCtrl] Redis connected ({self.cfg_ctrl.redis_host}:{self.cfg_ctrl.redis_port})"
                )
                self._redis_client = client
                return client
            except Exception as e:
                logger.error(f"[McpRedisCtrl] Redis connect failed: {e}; retrying in {delay}s")
                time.sleep(delay)
                delay = min(delay * 2, 5.0)
        return None

    def _publish_event(self, payload: str):
        if not self.publish_events:
            return
        client = self._redis_client
        if client is None:
            return
        try:
            event = json.dumps({"ts": time.time(), "event": payload})
            pipe = client.pipeline()
            pipe.rpush(self.event_key, event)
            if self.event_history_max > 0:
                pipe.ltrim(self.event_key, -self.event_history_max, -1)
            pipe.execute()
        except RedisError as e:
            logger.warning(f"[McpRedisCtrl] Could not publish event {payload!r}: {e}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ctrl = McpRedisCtrl(cfg_ctrl=McpRedisCtrlCfg(), env=None)
    print("Listening on", ctrl.cmd_key, "— push commands with:")
    print(f"  redis-cli RPUSH {ctrl.cmd_key} '[POLICY_MIMIC]'")
    while True:
        data = ctrl.get_data()
        _, cmds = ctrl.process_triggers(data)
        if cmds:
            print("Received:", cmds)
            ctrl.post_step_callback(cmds)
        time.sleep(0.05)
