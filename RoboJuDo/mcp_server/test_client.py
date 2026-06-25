"""Quick CLI to drive the RoboJuDo pipeline over Redis without an LLM/MCP client.
Useful for verifying the McpRedisCtrl path works before plugging in Claude Desktop.

Examples:
    python mcp_server/test_client.py list
    python mcp_server/test_client.py play video_017
    python mcp_server/test_client.py sequence video_017 video_025
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import redis

REDIS_HOST = os.environ.get("ROBOJUDO_REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("ROBOJUDO_REDIS_PORT", "6379"))
REDIS_DB = int(os.environ.get("ROBOJUDO_REDIS_DB", "0"))
COMMAND_QUEUE = os.environ.get("ROBOJUDO_COMMAND_QUEUE", "policy:commands")
EVENT_QUEUE = os.environ.get("ROBOJUDO_EVENT_QUEUE", "policy:events")

DEFAULT_MOTION_DIR = Path(__file__).resolve().parent.parent / "assets/models/g1/beyondmimic"
MOTION_DIR = Path(os.environ.get("ROBOJUDO_MOTION_DIR", str(DEFAULT_MOTION_DIR)))


def motions() -> list[str]:
    return sorted(p.stem for p in MOTION_DIR.glob("*.onnx")) if MOTION_DIR.is_dir() else []


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="List available motions and recent events")
    s_play = sub.add_parser("play", help="Push one policy ID and wait for policy_completed")
    s_play.add_argument("name")
    s_play.add_argument("--timeout", type=float, default=30.0)
    s_seq = sub.add_parser("sequence", help="Push several policy IDs in order")
    s_seq.add_argument("names", nargs="+")
    s_seq.add_argument("--timeout", type=float, default=30.0)
    args = p.parse_args()

    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB)
    r.ping()

    def push_policy(policy_id: str) -> None:
        r.rpush(COMMAND_QUEUE, policy_id)
        print(f"→ {COMMAND_QUEUE}: {policy_id!r}")

    def wait_done(name: str, timeout_s: float) -> bool:
        r.delete(EVENT_QUEUE)  # drain
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            item = r.blpop([EVENT_QUEUE], timeout=2)
            if item is None:
                continue
            try:
                ev = json.loads(item[1])
            except Exception:
                continue
            print(f"  ← {ev}")
            if ev.get("policy_id") != name:
                continue
            if ev.get("type") == "policy_completed":
                return True
            if ev.get("type") == "policy_failed":
                return False
        return False

    if args.cmd == "list":
        print("Motions:", motions())
        print("Recent events:")
        for raw in r.lrange(EVENT_QUEUE, -10, -1):
            try:
                print(" ", json.loads(raw))
            except Exception:
                print(" ", raw)
        return 0

    if args.cmd == "play":
        avail = motions()
        if avail and args.name not in avail:
            print(f"Unknown motion {args.name!r}. Available: {avail}", file=sys.stderr)
            return 2
        push_policy(args.name)
        ok = wait_done(args.name, args.timeout)
        print("DONE" if ok else "FAILED or TIMEOUT")
        return 0 if ok else 1

    if args.cmd == "sequence":
        avail = motions()
        for n in args.names:
            if avail and n not in avail:
                print(f"Unknown motion {n!r}. Available: {avail}", file=sys.stderr)
                return 2
        for n in args.names:
            push_policy(n)
            ok = wait_done(n, args.timeout)
            print(f"{n}: {'DONE' if ok else 'FAILED or TIMEOUT'}")
            if not ok:
                return 1
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())