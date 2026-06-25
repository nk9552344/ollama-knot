"""MCP server that exposes policy execution tools backed by Redis queues.

Two Redis lists are used:

  * **Command queue** (`REDIS_QUEUE_NAME`, default `policy:command`)
    The MCP writes here. Each policy invocation pushes the three-token
    sequence that the robot-side worker already understands:

        SELECT:<policy_id>
        [POLICY_SWITCH],<POLICY_MIMIC_INDEX>
        [POLICY_MIMIC]

    A full push is atomic — one `RPUSH` per `push_policy` call — so the
    worker always sees the three tokens together (matching the format
    produced by the local Python controller).

  * **Events queue** (`REDIS_EVENTS_QUEUE_NAME`, default `policy:events`)
    The robot-side worker writes here. The MCP only **reads** it (LRANGE),
    never popping, so other monitors keep seeing the same events.

    Events look like: ``{"ts": 1782397863.99, "event": "MIMIC_DONE:video_017"}``

Tools
-----
- list_policies()                       -> registry contents
- push_policy(policy_id)                -> enqueue SELECT / SWITCH / MIMIC for one id
- push_policy_sequence(policy_ids)      -> same triplet repeated per id, single atomic push
- list_recent_events(limit=10)          -> last N events from the events queue
- wait_for_event(timeout_s, pattern?)   -> block until a matching event arrives

Configuration is read from environment variables (a local .env file is
loaded automatically for development):

    POLICY_REGISTRY_PATH      Path to the YAML registry file.   (default: policies.yaml)
    REDIS_URL                 Redis connection URL.             (default: redis://localhost:6379/0)
    REDIS_QUEUE_NAME          Command queue list name.          (default: policy:command)
    REDIS_EVENTS_QUEUE_NAME   Events queue list name.           (default: policy:events)
    POLICY_MIMIC_INDEX        Value used in `[POLICY_SWITCH],N`. (default: 6)
    MCP_TRANSPORT             "stdio" or "http".                (default: stdio)
    MCP_HOST                  Bind host when transport is http. (default: 0.0.0.0)
    MCP_PORT                  Bind port when transport is http. (default: 8000)
"""

from __future__ import annotations

import fnmatch
import json
import os
import time
from pathlib import Path
from typing import Any

import redis
import yaml
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

REGISTRY_PATH = Path(os.getenv("POLICY_REGISTRY_PATH", "policies.yaml"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = os.getenv("REDIS_QUEUE_NAME", "policy:command")
EVENTS_QUEUE_NAME = os.getenv("REDIS_EVENTS_QUEUE_NAME", "policy:events")
POLICY_MIMIC_INDEX = int(os.getenv("POLICY_MIMIC_INDEX", "6"))
MCP_TRANSPORT = os.getenv("MCP_TRANSPORT", "stdio").lower()
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))
# Streamable-HTTP can run "stateful" (client must echo back an mcp-session-id
# header from the initialize handshake) or "stateless" (every request is
# independent). Many MCP UI clients skip the session handshake, so we default
# to stateless – flip to "false" if you need per-session state.
MCP_STATELESS_HTTP = os.getenv("MCP_STATELESS_HTTP", "true").lower() in ("1", "true", "yes")
# When true, streamable-HTTP replies with `application/json` instead of an
# `text/event-stream` chunked response. Plain JSON is far more compatible
# with simple clients (e.g. those that complain "MCP server closed the SSE
# stream before responding"). Disable only if your client truly needs SSE
# framing on the streamable-HTTP endpoint.
MCP_JSON_RESPONSE = os.getenv("MCP_JSON_RESPONSE", "true").lower() in ("1", "true", "yes")

mcp = FastMCP(
    "g1-policy-server",
    host=MCP_HOST,
    port=MCP_PORT,
    stateless_http=MCP_STATELESS_HTTP,
    json_response=MCP_JSON_RESPONSE,
)
redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)


def _load_registry() -> list[dict[str, Any]]:
    """Read the registry from disk on every call so file edits take effect immediately."""
    if not REGISTRY_PATH.exists():
        raise FileNotFoundError(
            f"Policy registry file not found at {REGISTRY_PATH}. "
            "Set POLICY_REGISTRY_PATH or mount the file into the container."
        )
    with REGISTRY_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    policies = data.get("policies", [])
    if not isinstance(policies, list):
        raise ValueError("Registry must contain a top-level `policies:` list.")
    return policies


def _known_ids() -> set[str]:
    return {p["id"] for p in _load_registry() if "id" in p}


@mcp.tool()
def list_policies() -> list[dict[str, Any]]:
    """List all available policies from the registry.

    Each entry contains `id`, `name`, and `description` so the agent can
    decide which policies to enqueue.
    """
    return _load_registry()


def _mimic_commands(policy_id: str) -> list[str]:
    """Build the three-token sequence the robot worker expects for one policy."""
    return [
        f"SELECT:{policy_id}",
        f"[POLICY_SWITCH],{POLICY_MIMIC_INDEX}",
        "[POLICY_MIMIC]",
    ]


@mcp.tool()
def push_policy(policy_id: str) -> dict[str, Any]:
    """Push a single policy onto the command queue.

    Emits the three-token sequence ``SELECT:<id>``, ``[POLICY_SWITCH],<n>``,
    ``[POLICY_MIMIC]`` in a single atomic ``RPUSH`` so the robot-side worker
    sees them together.

    Args:
        policy_id: Must match an `id` from the registry.
    """
    known = _known_ids()
    if policy_id not in known:
        return {
            "status": "error",
            "message": f"Unknown policy id: {policy_id!r}",
            "known_ids": sorted(known),
        }
    commands = _mimic_commands(policy_id)
    redis_client.rpush(QUEUE_NAME, *commands)
    return {
        "status": "ok",
        "queued": [policy_id],
        "commands": commands,
        "queue": QUEUE_NAME,
    }


@mcp.tool()
def push_policy_sequence(policy_ids: list[str]) -> dict[str, Any]:
    """Push an ordered sequence of policies onto the command queue.

    For each id the same three-token sequence (``SELECT`` /
    ``[POLICY_SWITCH]`` / ``[POLICY_MIMIC]``) is emitted, and the whole batch
    is pushed in a single atomic ``RPUSH`` so the worker processes the
    policies in order.

    Args:
        policy_ids: Ordered list of policy ids from the registry.
    """
    if not policy_ids:
        return {"status": "error", "message": "policy_ids is empty"}
    known = _known_ids()
    unknown = [pid for pid in policy_ids if pid not in known]
    if unknown:
        return {
            "status": "error",
            "message": "Unknown policy ids",
            "unknown_ids": unknown,
            "known_ids": sorted(known),
        }
    commands: list[str] = []
    for pid in policy_ids:
        commands.extend(_mimic_commands(pid))
    redis_client.rpush(QUEUE_NAME, *commands)
    return {
        "status": "ok",
        "queued": list(policy_ids),
        "commands": commands,
        "queue": QUEUE_NAME,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Events queue (read-only monitoring)
# ─────────────────────────────────────────────────────────────────────────────


def _parse_event(raw: str) -> dict[str, Any]:
    """Best-effort parse of one event payload. Always returns a dict."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {"raw": parsed}
    except (TypeError, ValueError):
        return {"raw": raw}


def _read_recent_events(limit: int) -> list[dict[str, Any]]:
    """LRANGE the events queue without consuming, newest-last."""
    if limit <= 0:
        return []
    raw_events = redis_client.lrange(EVENTS_QUEUE_NAME, -limit, -1)
    return [_parse_event(r) for r in raw_events]


def _event_matches(event: dict[str, Any], pattern: str | None) -> bool:
    if not pattern:
        return True
    name = event.get("event") or event.get("raw") or ""
    name = str(name)
    return fnmatch.fnmatchcase(name, pattern) or pattern in name


@mcp.tool()
def list_recent_events(limit: int = 10) -> dict[str, Any]:
    """Return the most recent events from the events queue (non-destructive).

    Args:
        limit: Maximum number of events to return (newest last). Clamped to
            [1, 200].
    """
    capped = max(1, min(int(limit or 10), 200))
    events = _read_recent_events(capped)
    return {
        "status": "ok",
        "queue": EVENTS_QUEUE_NAME,
        "count": len(events),
        "events": events,
    }


@mcp.tool()
def wait_for_event(
    timeout_s: float = 30.0,
    pattern: str | None = None,
) -> dict[str, Any]:
    """Block until a new event arrives on the events queue, or timeout.

    Non-destructive: the events queue is polled with LRANGE, so other
    consumers/monitors still see every event. Only events whose timestamp
    (`ts` field) is greater than the moment this call started are
    considered "new".

    Args:
        timeout_s: Maximum seconds to wait. Clamped to [0.1, 300].
        pattern: Optional `fnmatch`-style glob applied to the event name
            (e.g. ``"MIMIC_DONE:*"``). Falls back to substring match if
            the glob does not match. Omit to wait for any new event.
    """
    timeout = max(0.1, min(float(timeout_s or 30.0), 300.0))
    poll_interval = 0.5
    start = time.monotonic()
    cutoff_ts = time.time()
    deadline = start + timeout

    while True:
        events = _read_recent_events(200)
        matches: list[dict[str, Any]] = []
        for ev in events:
            try:
                ts = float(ev.get("ts", 0))
            except (TypeError, ValueError):
                ts = 0.0
            if ts <= cutoff_ts:
                continue
            if _event_matches(ev, pattern):
                matches.append(ev)

        if matches:
            return {
                "status": "ok",
                "queue": EVENTS_QUEUE_NAME,
                "pattern": pattern,
                "count": len(matches),
                "events": matches,
                "waited_s": round(time.monotonic() - start, 3),
            }

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return {
                "status": "timeout",
                "queue": EVENTS_QUEUE_NAME,
                "pattern": pattern,
                "timeout_s": timeout,
            }
        time.sleep(min(poll_interval, remaining))


if __name__ == "__main__":
    if MCP_TRANSPORT == "http":
        # Streamable-HTTP endpoint at  http://<host>:<port>/mcp
        mcp.run(transport="streamable-http")
    elif MCP_TRANSPORT == "sse":
        # SSE endpoint at              http://<host>:<port>/sse
        mcp.run(transport="sse")
    else:
        mcp.run()
