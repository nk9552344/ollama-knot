"""Local smoke test for the MCP server tools.

Calls the tool functions directly (bypassing the MCP transport) and prints
the results, then dumps the Redis queue contents. Use this to confirm:

  * the registry file is found and parsed
  * Redis is reachable at REDIS_URL
  * execute_policy enqueues a single policy ID onto the command queue
  * the event queue is reachable and readable

Run:
    python test_local.py
"""

from __future__ import annotations

import json
import time

from server import (
    COMMAND_QUEUE_NAME,
    EVENT_QUEUE_NAME,
    execute_policy,
    list_policies,
    read_recent_events,
    redis_client,
)


def _dump(label: str, value: object) -> None:
    print(f"\n# {label}")
    print(json.dumps(value, indent=2, default=str))


def main() -> None:
    print("# redis ping ->", redis_client.ping())

    policies = list_policies()
    _dump("list_policies()", policies)
    if not policies:
        print("Registry is empty; nothing else to test.")
        return

    ids = [p["id"] for p in policies if "id" in p]

    # Start from a clean command queue so the printout below is deterministic.
    redis_client.delete(COMMAND_QUEUE_NAME)

    for pid in ids:
        _dump(f"execute_policy({pid!r})", execute_policy(pid))

    _dump(
        "execute_policy('does_not_exist')  # should be rejected",
        execute_policy("does_not_exist"),
    )

    _dump(
        f"command queue contents ({COMMAND_QUEUE_NAME})",
        redis_client.lrange(COMMAND_QUEUE_NAME, 0, -1),
    )

    # Inject a couple of fake events so the read tool has something to chew on.
    fake = [
        {
            "timestamp": time.time(),
            "type": "ready",
            "policy_id": "",
            "message": "",
        },
        {
            "timestamp": time.time(),
            "type": "policy_started",
            "policy_id": ids[0],
            "message": "",
        },
        {
            "timestamp": time.time(),
            "type": "policy_completed",
            "policy_id": ids[0],
            "message": "",
        },
    ]
    for ev in fake:
        redis_client.rpush(EVENT_QUEUE_NAME, json.dumps(ev))

    _dump(
        f"read_recent_events(limit=5) from {EVENT_QUEUE_NAME}",
        read_recent_events(limit=5),
    )


if __name__ == "__main__":
    main()
