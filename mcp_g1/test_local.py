"""Local smoke test for the MCP server tools.

Calls the tool functions directly (bypassing the MCP transport) and prints
the results, then dumps the Redis queue contents. Use this to confirm:

  * the registry file is found and parsed
  * Redis is reachable at REDIS_URL
  * push_policy / push_policy_sequence enqueue what you expect

Run:
    python test_local.py
"""

from __future__ import annotations

import json

from server import (
    QUEUE_NAME,
    list_policies,
    push_policy,
    push_policy_sequence,
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

    ids = [p["id"] for p in policies]

    # Start from a clean queue so the printout below is deterministic.
    redis_client.delete(QUEUE_NAME)

    _dump(f"push_policy({ids[0]!r})", push_policy(ids[0]))
    _dump(f"push_policy_sequence({ids!r})", push_policy_sequence(ids))
    _dump("push_policy('does_not_exist')  # should be rejected",
          push_policy("does_not_exist"))

    _dump(f"queue contents ({QUEUE_NAME})",
          redis_client.lrange(QUEUE_NAME, 0, -1))


if __name__ == "__main__":
    main()
