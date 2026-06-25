"""
Minimal MCP server for executing robot policies through Redis.

Queues
------
Command Queue (policy:commands)
    MCP writes policy IDs.

    Example:
        walk_forward
        wave
        sit_down

Event Queue (policy:events)
    Robot writes structured status updates.
    MCP only reads this queue.

    Example:
        {
            "timestamp": 1782397863.12,
            "type": "policy_started",
            "policy_id": "wave",
            "message": ""
        }

Tools
-----
- list_policies()
- execute_policy(policy_id)
- wait_for_event(timeout_s=30)

Environment Variables
---------------------
POLICY_REGISTRY_PATH   Path to policies.yaml
REDIS_URL              Redis connection URL
COMMAND_QUEUE_NAME     Redis command queue
EVENT_QUEUE_NAME       Redis event queue
MCP_TRANSPORT          stdio | http | sse
MCP_HOST               HTTP host
MCP_PORT               HTTP port
MCP_STATELESS_HTTP     true/false
MCP_JSON_RESPONSE      true/false
"""

from __future__ import annotations

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

COMMAND_QUEUE_NAME = os.getenv(
    "COMMAND_QUEUE_NAME",
    "policy:commands",
)

EVENT_QUEUE_NAME = os.getenv(
    "EVENT_QUEUE_NAME",
    "policy:events",
)

MCP_TRANSPORT = os.getenv("MCP_TRANSPORT", "stdio").lower()
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

MCP_STATELESS_HTTP = (
    os.getenv("MCP_STATELESS_HTTP", "true").lower()
    in ("1", "true", "yes")
)

MCP_JSON_RESPONSE = (
    os.getenv("MCP_JSON_RESPONSE", "true").lower()
    in ("1", "true", "yes")
)

mcp = FastMCP(
    "g1-policy-server",
    host=MCP_HOST,
    port=MCP_PORT,
    stateless_http=MCP_STATELESS_HTTP,
    json_response=MCP_JSON_RESPONSE,
)

redis_client = redis.Redis.from_url(
    REDIS_URL,
    decode_responses=True,
)


def load_registry() -> list[dict[str, Any]]:
    """Load policy registry."""

    if not REGISTRY_PATH.exists():
        raise FileNotFoundError(
            f"Policy registry not found: {REGISTRY_PATH}"
        )

    with REGISTRY_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    policies = data.get("policies", [])

    if not isinstance(policies, list):
        raise ValueError(
            "Registry must contain a top-level 'policies' list."
        )

    return policies


@mcp.tool()
def list_policies() -> list[dict[str, Any]]:
    """
    List all available policies.
    """
    return load_registry()


@mcp.tool()
def execute_policy(policy_id: str) -> dict[str, Any]:
    """
    Queue a policy for execution.
    """

    policies = load_registry()

    if policy_id not in {
        policy["id"]
        for policy in policies
        if "id" in policy
    }:
        return {
            "status": "error",
            "message": f"Unknown policy '{policy_id}'.",
        }

    redis_client.rpush(COMMAND_QUEUE_NAME, policy_id)

    return {
        "status": "ok",
        "policy_id": policy_id,
        "queue": COMMAND_QUEUE_NAME,
    }


def read_recent_events(limit: int = 200) -> list[dict[str, Any]]:
    raw_events = redis_client.lrange(
        EVENT_QUEUE_NAME,
        -limit,
        -1,
    )

    events = []

    for raw in raw_events:
        try:
            event = json.loads(raw)

            if isinstance(event, dict):
                events.append(event)

        except Exception:
            continue

    return events


@mcp.tool()
def wait_for_event(timeout_s: float = 30.0) -> dict[str, Any]:
    """
    Wait until the robot publishes a new event.

    Returns the first new event after this call starts.
    """

    timeout_s = max(0.1, min(timeout_s, 300.0))

    start_time = time.monotonic()
    cutoff_timestamp = time.time()

    while time.monotonic() - start_time < timeout_s:

        events = read_recent_events()

        for event in events:

            timestamp = float(
                event.get("timestamp", 0)
            )

            if timestamp > cutoff_timestamp:

                return {
                    "status": "ok",
                    "event": event,
                    "waited_s": round(
                        time.monotonic() - start_time,
                        3,
                    ),
                }

        time.sleep(0.5)

    return {
        "status": "timeout",
        "timeout_s": timeout_s,
    }


if __name__ == "__main__":

    if MCP_TRANSPORT == "http":
        mcp.run(transport="streamable-http")

    elif MCP_TRANSPORT == "sse":
        mcp.run(transport="sse")

    else:
        mcp.run()