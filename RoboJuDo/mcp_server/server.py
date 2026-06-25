"""MCP server that exposes RoboJuDo's loco-mimic pipeline as LLM tools.

Architecture (see docs/mcp_orchestrator.md):

    LLM client (Claude Desktop, VSCode, ...)
        │  MCP tool call
        ▼
    server.py (this file, FastMCP over stdio)
        │  RPUSH policy:commands "<policy_id>"
        ▼
    Redis
        ▼
    McpRedisCtrl  (inside the running RoboJuDo pipeline)

Protocol (kept deliberately narrow):
    command_queue  — MCP RPUSHes plain policy IDs (one per execution).
    event_queue    — controller RPUSHes JSON events with schema
                     {"timestamp", "type", "policy_id", "message"}.

The robot owns all policy scheduling and transitions. The MCP knows only about
policy IDs; pipeline internals never leak onto the wire.

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

COMMAND_QUEUE = os.environ.get("ROBOJUDO_COMMAND_QUEUE", "policy:commands")
EVENT_QUEUE = os.environ.get("ROBOJUDO_EVENT_QUEUE", "policy:events")

# Same directory the McpRedisCtrl-equipped pipeline scans. Adjust via env var
# if the server runs on a different machine from the simulator.
DEFAULT_MOTION_DIR = (
    Path(__file__).resolve().parent.parent / "assets" / "models" / "g1" / "beyondmimic"
)
MOTION_DIR = Path(os.environ.get("ROBOJUDO_MOTION_DIR", str(DEFAULT_MOTION_DIR)))

# Max time (s) to wait for a policy_completed event before giving up. Pipeline
# auto-returns to loco on max_timestep, so this is mostly an upper bound for
# safety.
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


def _push_policy(policy_id: str) -> None:
    """Push a single policy ID onto the command queue."""
    r().rpush(COMMAND_QUEUE, policy_id)
    logger.info("→ %s: %r", COMMAND_QUEUE, policy_id)


def _drain_events() -> None:
    """Discard old events so the next wait starts from a clean slate."""
    try:
        r().delete(EVENT_QUEUE)
    except redis.RedisError:
        pass


def _wait_for_event(predicate, timeout_s: float) -> dict | None:
    """Block until a JSON event matching predicate appears, or timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        remaining = max(0.1, deadline - time.time())
        # BLPOP returns (key, value) or None on timeout.
        item = r().blpop([EVENT_QUEUE], timeout=min(remaining, 2.0))
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


# ───────────── MCP server + tools ─────────────

mcp = FastMCP("robojudo")


@mcp.tool()
def list_motions() -> list[str]:
    """List every motion the robot can play. The names returned here are the
    exact policy IDs to pass to `play_motion`."""
    return _list_motion_names()


@mcp.tool()
def status() -> dict:
    """Return server + pipeline reachability and the most recent pipeline events."""
    try:
        pending_cmds = int(r().llen(COMMAND_QUEUE))
        recent_events_raw = r().lrange(EVENT_QUEUE, -10, -1)
        recent_events: list[dict] = []
        for raw in recent_events_raw:
            try:
                parsed = json.loads(raw)
            except Exception:
                continue
            if isinstance(parsed, dict):
                recent_events.append(parsed)
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
        "command_queue": COMMAND_QUEUE,
        "event_queue": EVENT_QUEUE,
        "pending_commands": pending_cmds,
        "recent_events": recent_events,
        "motions_available": _list_motion_names(),
    }


@mcp.tool()
def play_motion(name: str, wait: bool = True, timeout_s: float | None = None) -> str:
    """Queue a motion for execution.

    Args:
        name: motion name returned by `list_motions` (e.g. "video_017"). This
              is the policy ID — the robot resolves it to a policy file internally.
        wait: if True, block until the pipeline reports `policy_completed` for
              this clip, then return. If False, fire-and-forget.
        timeout_s: hard upper bound for `wait`. Defaults to ROBOJUDO_MOTION_TIMEOUT_S.

    Returns a status string describing what happened.
    """
    available = _list_motion_names()
    if available and name not in available:
        return f"Unknown motion {name!r}. Available: {available}"

    timeout_s = timeout_s if timeout_s is not None else DEFAULT_MOTION_TIMEOUT_S

    if wait:
        _drain_events()

    _push_policy(name)

    if not wait:
        return f"Queued {name}. Not waiting."

    ev = _wait_for_event(
        lambda e: (
            e.get("type") in ("policy_completed", "policy_failed")
            and e.get("policy_id") == name
        ),
        timeout_s=timeout_s,
    )
    if ev is None:
        return f"Timed out after {timeout_s}s waiting for {name} to finish."
    if ev.get("type") == "policy_failed":
        return f"Failed: {ev.get('message') or 'unknown error'}"
    return f"Completed {name}."


@mcp.tool()
def play_sequence(names: list[str], timeout_s_per_motion: float | None = None) -> list[str]:
    """Play several motions back-to-back. Returns the per-motion status strings.
    The robot transitions through its locomotion policy between clips — every
    policy switch passes through loco — so the chain is always safe."""
    results = []
    for n in names:
        results.append(play_motion(n, wait=True, timeout_s=timeout_s_per_motion))
    return results


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
