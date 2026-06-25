"""MCP server that exposes RoboJuDo's loco-mimic pipeline as LLM tools.

Architecture (see docs/mcp_orchestrator.md):

    LLM client (Claude Desktop, VSCode, ...)
        │  MCP tool call
        ▼
    server.py (this file, FastMCP over stdio)
        │  RPUSH robojudo:commands "<cmd>"
        ▼
    Redis
        ▼
    McpRedisCtrl  (inside the running RoboJuDo pipeline)

The pipeline is always running a policy (loco when idle, mimic when playing),
so chaining tools never leaves the robot uncontrolled.

Run:
    pip install fastmcp redis
    python mcp_server/server.py        # stdio transport
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

import redis
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("robojudo.mcp")

# ───────────── Configuration ─────────────

REDIS_HOST = os.environ.get("ROBOJUDO_REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("ROBOJUDO_REDIS_PORT", "6379"))
REDIS_DB = int(os.environ.get("ROBOJUDO_REDIS_DB", "0"))

CMD_KEY = os.environ.get("ROBOJUDO_CMD_KEY", "policy:command")
EVENT_KEY = os.environ.get("ROBOJUDO_EVENT_KEY", "policy:events")

# Same directory the McpRedisCtrl-equipped pipeline scans. Adjust via env var
# if the server runs on a different machine from the simulator.
DEFAULT_MOTION_DIR = (
    Path(__file__).resolve().parent.parent / "assets" / "models" / "g1" / "beyondmimic"
)
MOTION_DIR = Path(os.environ.get("ROBOJUDO_MOTION_DIR", str(DEFAULT_MOTION_DIR)))

# Max time (s) to wait for a MIMIC_DONE before giving up. Pipeline auto-returns
# to loco on max_timestep, so this is mostly an upper bound for safety.
DEFAULT_MOTION_TIMEOUT_S = float(os.environ.get("ROBOJUDO_MOTION_TIMEOUT_S", "30"))


# ───────────── Redis helpers ─────────────


def _connect() -> redis.Redis:
    client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, socket_timeout=2)
    client.ping()
    return client


_redis: redis.Redis | None = None


def r() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = _connect()
    return _redis


def _push(*items: str) -> None:
    """Push one or more raw command strings to the pipeline."""
    if not items:
        return
    r().rpush(CMD_KEY, *items)
    logger.info("→ pipeline: %s", list(items))


def _drain_events() -> None:
    """Discard old events so the next wait starts from a clean slate."""
    try:
        r().delete(EVENT_KEY)
    except redis.RedisError:
        pass


def _wait_for_event(predicate, timeout_s: float) -> dict | None:
    """Block until an event matching predicate appears, or timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        remaining = max(0.1, deadline - time.time())
        # BLPOP returns (key, value) or None on timeout.
        item = r().blpop([EVENT_KEY], timeout=min(remaining, 2.0))
        if item is None:
            continue
        _, raw = item
        try:
            ev = json.loads(raw)
        except Exception:
            continue
        if predicate(ev):
            return ev
    return None


# ───────────── Motion discovery ─────────────


def _list_motion_names() -> list[str]:
    if not MOTION_DIR.is_dir():
        return []
    return sorted(p.stem for p in MOTION_DIR.glob("*.onnx"))


def _motion_index(name: str) -> int:
    names = _list_motion_names()
    if name not in names:
        raise ValueError(
            f"Unknown motion {name!r}. Available: {names}. "
            f"(Searched {MOTION_DIR}; override with ROBOJUDO_MOTION_DIR.)"
        )
    return names.index(name)


# ───────────── MCP server + tools ─────────────

mcp = FastMCP("robojudo")


@mcp.tool()
def list_motions() -> list[str]:
    """List every BeyondMimic motion the robot can play. The names returned here
    are the exact strings to pass to `play_motion`."""
    return _list_motion_names()


@mcp.tool()
def status() -> dict:
    """Return server + pipeline reachability and the most recent pipeline events."""
    try:
        pending_cmds = int(r().llen(CMD_KEY))
        recent_events_raw = r().lrange(EVENT_KEY, -10, -1)
        recent_events = [json.loads(e) for e in recent_events_raw]
        ok = True
        err = None
    except Exception as e:
        pending_cmds = -1
        recent_events = []
        ok = False
        err = str(e)
    return {
        "redis_ok": ok,
        "redis_error": err,
        "cmd_key": CMD_KEY,
        "event_key": EVENT_KEY,
        "pending_commands": pending_cmds,
        "recent_events": recent_events,
        "motions_available": _list_motion_names(),
    }


@mcp.tool()
def stand_loco() -> str:
    """Force the robot back to the locomotion policy (safe standing). Use this
    to interrupt a mimic motion or as the default 'idle' between actions."""
    _push("[POLICY_LOCO]")
    return "Sent [POLICY_LOCO]."


@mcp.tool()
def play_motion(name: str, wait: bool = True, timeout_s: float | None = None) -> str:
    """Play a BeyondMimic motion to completion.

    Args:
        name: motion name returned by `list_motions` (e.g. "video_017").
        wait: if True, block until the pipeline reports MIMIC_DONE for this clip,
              then return. If False, fire-and-forget (the next tool call should
              still leave the robot in a safe state).
        timeout_s: hard upper bound for `wait`. Defaults to ROBOJUDO_MOTION_TIMEOUT_S.

    Returns a status string describing what happened.
    """
    idx = _motion_index(name)
    timeout_s = timeout_s if timeout_s is not None else DEFAULT_MOTION_TIMEOUT_S

    if wait:
        _drain_events()

    # SELECT:<name> is a side-channel string consumed by McpRedisCtrl so it can
    # attach the human-readable name to the MIMIC_STARTED/MIMIC_DONE events.
    _push(f"SELECT:{name}", f"[POLICY_SWITCH],{idx}", "[POLICY_MIMIC]")

    if not wait:
        return f"Started {name} (idx={idx}). Not waiting."

    ev = _wait_for_event(
        lambda e: e.get("event") == f"MIMIC_DONE:{name}",
        timeout_s=timeout_s,
    )
    if ev is None:
        # Defensive: force back to loco so the robot is not stuck.
        _push("[POLICY_LOCO]")
        return f"Timed out after {timeout_s}s waiting for {name} to finish; forced [POLICY_LOCO]."
    return f"Completed {name}."


@mcp.tool()
def play_sequence(names: list[str], timeout_s_per_motion: float | None = None) -> list[str]:
    """Play several motions back-to-back. Returns the per-motion status strings.
    The robot returns to the loco policy between clips (handled by the pipeline's
    [MOTION_DONE] → [POLICY_LOCO] auto-transition), so the chain is always safe."""
    results = []
    for n in names:
        results.append(play_motion(n, wait=True, timeout_s=timeout_s_per_motion))
    return results


@mcp.tool()
def reset_motion() -> str:
    """Restart the currently-playing motion from frame 0 without leaving mimic."""
    _push("[MOTION_RESET]")
    return "Sent [MOTION_RESET]."


@mcp.tool()
def reborn_sim() -> str:
    """Respawn the robot in simulation (no effect on a real robot env)."""
    _push("[SIM_REBORN]")
    return "Sent [SIM_REBORN]."


@mcp.tool()
def emergency_shutdown() -> str:
    """Stop the pipeline. Use only in genuine emergencies — it tears the run down."""
    _push("[SHUTDOWN]")
    return "Sent [SHUTDOWN]."


# ───────────── Entrypoint ─────────────


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("ROBOJUDO_LOG", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # Verify Redis reachable at startup so the client gets a clear error early.
    try:
        r().ping()
        logger.info("Redis reachable at %s:%s db=%s", REDIS_HOST, REDIS_PORT, REDIS_DB)
        logger.info("Motions discovered: %s", _list_motion_names())
    except Exception as e:
        logger.error("Cannot reach Redis at %s:%s — %s", REDIS_HOST, REDIS_PORT, e)
        # Don't exit — let the MCP client see the status() error in context.
    mcp.run()


if __name__ == "__main__":
    main()
