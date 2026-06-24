"""MCP server that exposes policy execution tools backed by a Redis queue.

Tools
-----
- list_policies()                       -> list available policies from the registry file
- push_policy(policy_id)                -> enqueue a single policy id
- push_policy_sequence(policy_ids)      -> enqueue an ordered list of policy ids

Configuration is read from environment variables (a local .env file is
loaded automatically for development):

    POLICY_REGISTRY_PATH   Path to the YAML registry file.   (default: policies.yaml)
    REDIS_URL              Redis connection URL.             (default: redis://localhost:6379/0)
    REDIS_QUEUE_NAME       Redis list used as the queue.     (default: policy_queue)
    MCP_TRANSPORT          "stdio" or "http".                (default: stdio)
    MCP_HOST               Bind host when transport is http. (default: 0.0.0.0)
    MCP_PORT               Bind port when transport is http. (default: 8000)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import redis
import yaml
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

REGISTRY_PATH = Path(os.getenv("POLICY_REGISTRY_PATH", "policies.yaml"))
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = os.getenv("REDIS_QUEUE_NAME", "policy_queue")
MCP_TRANSPORT = os.getenv("MCP_TRANSPORT", "stdio").lower()
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

mcp = FastMCP("g1-policy-server", host=MCP_HOST, port=MCP_PORT)
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


@mcp.tool()
def push_policy(policy_id: str) -> dict[str, Any]:
    """Push a single policy id onto the Redis execution queue.

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
    redis_client.rpush(QUEUE_NAME, policy_id)
    return {"status": "ok", "queued": [policy_id], "queue": QUEUE_NAME}


@mcp.tool()
def push_policy_sequence(policy_ids: list[str]) -> dict[str, Any]:
    """Push an ordered sequence of policy ids onto the Redis execution queue.

    Policies are enqueued in the given order (FIFO via RPUSH); a worker
    consuming with LPOP/BLPOP will receive them in the same order.

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
    redis_client.rpush(QUEUE_NAME, *policy_ids)
    return {"status": "ok", "queued": policy_ids, "queue": QUEUE_NAME}


if __name__ == "__main__":
    if MCP_TRANSPORT == "http":
        # Streamable-HTTP endpoint at  http://<host>:<port>/mcp
        mcp.run(transport="streamable-http")
    elif MCP_TRANSPORT == "sse":
        # SSE endpoint at              http://<host>:<port>/sse
        mcp.run(transport="sse")
    else:
        mcp.run()
