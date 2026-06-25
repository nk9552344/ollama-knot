"""Quick CLI to drive the RoboJuDo pipeline over Redis without an LLM/MCP client.
Useful for verifying the McpRedisCtrl path works before plugging in Claude Desktop.

Examples:
    python mcp_server/test_client.py list
    python mcp_server/test_client.py play video_017
    python mcp_server/test_client.py sequence video_017 video_025
    python mcp_server/test_client.py loco
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
CMD_KEY = os.environ.get("ROBOJUDO_CMD_KEY", "policy:command")
EVENT_KEY = os.environ.get("ROBOJUDO_EVENT_KEY", "policy:events")

DEFAULT_MOTION_DIR = Path(__file__).resolve().parent.parent / "assets/models/g1/beyondmimic"
MOTION_DIR = Path(os.environ.get("ROBOJUDO_MOTION_DIR", str(DEFAULT_MOTION_DIR)))


def motions() -> list[str]:
    return sorted(p.stem for p in MOTION_DIR.glob("*.onnx")) if MOTION_DIR.is_dir() else []


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="List available motions and recent events")
    s_play = sub.add_parser("play", help="Play one motion and wait for MIMIC_DONE")
    s_play.add_argument("name")
    s_play.add_argument("--timeout", type=float, default=30.0)
    s_seq = sub.add_parser("sequence", help="Play several motions in order")
    s_seq.add_argument("names", nargs="+")
    s_seq.add_argument("--timeout", type=float, default=30.0)
    sub.add_parser("loco", help="Force back to loco")
    sub.add_parser("reset", help="Restart current motion")
    sub.add_parser("reborn", help="Respawn sim robot")
    sub.add_parser("shutdown", help="Stop the pipeline")
    args = p.parse_args()

    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB)
    r.ping()

    def push(*items: str) -> None:
        r.rpush(CMD_KEY, *items)
        print(f"→ {list(items)}")

    def wait_done(name: str, timeout_s: float) -> bool:
        r.delete(EVENT_KEY)  # drain
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            item = r.blpop([EVENT_KEY], timeout=2)
            if item is None:
                continue
            ev = json.loads(item[1])
            print(f"  ← {ev['event']}")
            if ev["event"] == f"MIMIC_DONE:{name}":
                return True
        return False

    if args.cmd == "list":
        print("Motions:", motions())
        print("Recent events:")
        for raw in r.lrange(EVENT_KEY, -10, -1):
            print(" ", json.loads(raw))
        return 0

    if args.cmd == "play":
        if args.name not in motions():
            print(f"Unknown motion {args.name!r}. Available: {motions()}", file=sys.stderr)
            return 2
        idx = motions().index(args.name)
        push(f"SELECT:{args.name}", f"[POLICY_SWITCH],{idx}", "[POLICY_MIMIC]")
        ok = wait_done(args.name, args.timeout)
        print("DONE" if ok else "TIMEOUT (forcing loco)")
        if not ok:
            push("[POLICY_LOCO]")
        return 0 if ok else 1

    if args.cmd == "sequence":
        avail = motions()
        for n in args.names:
            if n not in avail:
                print(f"Unknown motion {n!r}. Available: {avail}", file=sys.stderr)
                return 2
        for n in args.names:
            idx = avail.index(n)
            push(f"SELECT:{n}", f"[POLICY_SWITCH],{idx}", "[POLICY_MIMIC]")
            ok = wait_done(n, args.timeout)
            print(f"{n}: {'DONE' if ok else 'TIMEOUT'}")
            if not ok:
                push("[POLICY_LOCO]")
                return 1
        return 0

    if args.cmd == "loco":
        push("[POLICY_LOCO]")
    elif args.cmd == "reset":
        push("[MOTION_RESET]")
    elif args.cmd == "reborn":
        push("[SIM_REBORN]")
    elif args.cmd == "shutdown":
        push("[SHUTDOWN]")
    return 0


if __name__ == "__main__":
    sys.exit(main())


