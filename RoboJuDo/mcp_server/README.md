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
   │   RPUSH robojudo:commands "<cmd>"
   ▼
Redis
   ▼
McpRedisCtrl                ← robojudo/controller/mcp_redis_ctrl.py
   │   ctrl_data["COMMANDS"].append("<cmd>")
   ▼
RlLocoMimicPipeline         ← unchanged
```

The pipeline is always running a policy (loco when idle, mimic when playing),
so chained calls never leave the robot uncontrolled. Loco↔mimic transitions
use the existing `PolicyInterpManager` joint-space interpolation.

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
   draining `robojudo:commands`. It also publishes transition events to
   `robojudo:events` (READY, LOCO_ACTIVE, MIMIC_STARTED:&lt;name&gt;,
   MIMIC_DONE:&lt;name&gt;, SHUTDOWN).

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

| Tool                  | Behaviour                                                     |
|-----------------------|---------------------------------------------------------------|
| `list_motions`        | Returns every `.onnx` in `assets/models/g1/beyondmimic/`      |
| `status`              | Redis reachability + recent pipeline events + motion list     |
| `stand_loco`          | Force back to the loco policy (safe stand)                    |
| `play_motion(name)`   | Plays one motion, blocks until `MIMIC_DONE:<name>`            |
| `play_sequence(names)`| Plays motions back-to-back, returning between them            |
| `reset_motion`        | Restart current motion at frame 0                             |
| `reborn_sim`          | Respawn sim robot                                             |
| `emergency_shutdown`  | Tear the run down                                             |

## Env vars

| Variable                     | Default                                              |
|------------------------------|------------------------------------------------------|
| `ROBOJUDO_REDIS_HOST`        | `localhost`                                          |
| `ROBOJUDO_REDIS_PORT`        | `6379`                                               |
| `ROBOJUDO_REDIS_DB`          | `0`                                                  |
| `ROBOJUDO_CMD_KEY`           | `robojudo:commands`                                  |
| `ROBOJUDO_EVENT_KEY`         | `robojudo:events`                                    |
| `ROBOJUDO_MOTION_DIR`        | `<repo>/assets/models/g1/beyondmimic`                |
| `ROBOJUDO_MOTION_TIMEOUT_S`  | `30`                                                 |
| `ROBOJUDO_LOG`               | `INFO`                                               |

## Adding a motion

Drop the `.onnx` into `assets/models/g1/beyondmimic/`. Both the pipeline cfg
(`g1_mcp`) and the MCP server autodiscover from that directory — restart both
processes to pick it up. Each new motion gets `max_timestep=400` by default;
edit `_discover_beyondmimic_motions` in
`robojudo/config/g1/g1_loco_mimic_cfg.py` if a clip's true length differs.

## Safety / sim2real notes

- `McpRedisCtrl` cannot lock the policy: the keyboard controller is still
  registered in `g1_mcp` (`o` shutdown, `i` reborn, `]` force loco) as a
  manual override.
- `play_motion` always issues `[POLICY_LOCO]` after a timeout so the robot
  never freezes mid-action.
- The MCP server is a separate process; it can be killed and restarted without
  touching the running pipeline.
