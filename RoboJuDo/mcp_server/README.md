# RoboJuDo MCP orchestrator

Exposes the RoboJuDo loco-mimic pipeline as MCP tools so an LLM (Claude Desktop,
VS Code MCP, etc.) can drive the robot with natural-language requests like
"move forward and squat".

## Architecture

```
LLM client (Claude Desktop / VS Code / ...)
   │   MCP tool call (stdio)
   ▼
mcp_server/server.py        ← this folder
   │   RPUSH policy:commands "<policy_id>"
   ▼
Redis
   ▼
McpRedisCtrl                ← robojudo/controller/mcp_redis_ctrl.py
   │   resolves policy_id → mimic index, generates internal
   │   [POLICY_SWITCH]/[POLICY_MIMIC] tokens
   ▼
RlLocoMimicPipeline         ← unchanged
```

## Protocol

Redis transports only policy IDs and structured events. The MCP server never
sees pipeline internals.

**Command queue (`policy:commands`)** — MCP → robot. Plain policy IDs:

```
RPUSH policy:commands wave
RPUSH policy:commands sit_down
```

**Event queue (`policy:events`)** — robot → MCP. JSON with a fixed schema:

```json
{
    "timestamp": 1782397863.12,
    "type": "policy_started",
    "policy_id": "wave",
    "message": ""
}
```

Event types: `ready`, `policy_started`, `policy_completed`, `policy_failed`,
`shutdown`, `motion_reset`.

The pipeline is always running a policy (loco when idle, mimic when playing).
The controller pops one policy ID at a time, drives it to completion, lets the
pipeline auto-transition back to loco, and waits for the mimic→loco
interpolation to settle before popping the next ID. Every transition therefore
passes through locomotion — there is never a direct mimic→mimic switch.

## Bring-up

1. **Install deps**

   ```bash
   pip install fastmcp redis
   sudo apt install redis-server                 # or: docker run -p 6379:6379 redis
   sudo systemctl start redis
   ```

2. **Start the pipeline**

   ```bash
   python scripts/run_pipeline.py -c g1_mcp
   ```

   The pipeline registers `McpRedisCtrl` (defined in
   `robojudo/controller/mcp_redis_ctrl.py`) which connects to Redis and starts
   draining `policy:commands`. It publishes structured JSON status events on
   `policy:events`.

3. **Verify the wire path without an LLM**

   ```bash
   python mcp_server/test_client.py list
   python mcp_server/test_client.py play video_017
   python mcp_server/test_client.py sequence video_017 video_025
   ```

4. **Start the MCP server (for LLM clients)**

   ```bash
   python mcp_server/server.py
   ```

   FastMCP runs over stdio by default. Configure your client to launch this
   script as a subprocess (Claude Desktop: `claude_desktop_config.json`,
   VS Code: an MCP profile).

## Tools exposed

| Tool                  | Behaviour                                                                |
|-----------------------|--------------------------------------------------------------------------|
| `list_motions`        | Returns every `.onnx` in `assets/models/g1/beyondmimic/` (policy IDs).   |
| `status`              | Redis reachability + recent JSON events + motion list                    |
| `play_motion(name)`   | Pushes the policy ID, blocks until `policy_completed` / `policy_failed`  |
| `play_sequence(names)`| Plays motions back-to-back, robot returns to loco between each clip      |

## Env vars

| Variable                       | Default                                              |
|--------------------------------|------------------------------------------------------|
| `ROBOJUDO_REDIS_HOST`          | `localhost`                                          |
| `ROBOJUDO_REDIS_PORT`          | `6379`                                               |
| `ROBOJUDO_REDIS_DB`            | `0`                                                  |
| `ROBOJUDO_COMMAND_QUEUE`       | `policy:commands`                                    |
| `ROBOJUDO_EVENT_QUEUE`         | `policy:events`                                      |
| `ROBOJUDO_MOTION_DIR`          | `<repo>/assets/models/g1/beyondmimic`                |
| `ROBOJUDO_MOTION_TIMEOUT_S`    | `30`                                                 |
| `ROBOJUDO_LOG`                 | `INFO`                                               |

## Adding a motion

Drop the `.onnx` into `assets/models/g1/beyondmimic/`. Both the pipeline cfg
(`g1_mcp`) and the MCP server autodiscover from that directory — restart both
processes to pick it up. Each new motion gets `max_timestep=400` by default;
edit `_discover_beyondmimic_motions` in
`robojudo/config/g1/g1_loco_mimic_cfg.py` if a clip's true length differs.

## Safety / sim2real notes

- `McpRedisCtrl` cannot lock the policy: the keyboard / joystick controllers
  are still registered in `g1_mcp` and `g1_mcp_real` as manual overrides
  (force-loco, shutdown, etc.).
- The MCP server is a separate process; it can be killed and restarted without
  touching the running pipeline.
