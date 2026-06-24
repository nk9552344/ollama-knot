# mcp_g1 — Policy Queue MCP Server

A tiny [Model Context Protocol](https://modelcontextprotocol.io) server that
lets an AI agent enqueue robot-policy executions for the Unitree G1.

The server exposes three tools:

| Tool | Purpose |
|---|---|
| `list_policies()` | Returns every policy from the registry (`id`, `name`, `description`). |
| `push_policy(policy_id)` | Pushes a single policy id onto a Redis list. |
| `push_policy_sequence(policy_ids)` | Pushes an ordered batch of policy ids onto the same Redis list. |

Policies are pushed with `RPUSH`, so a downstream worker consuming with
`LPOP`/`BLPOP` will receive them in FIFO order.

---

## Registry file format

**Recommended format: YAML.** It is the best fit here because:

- The file is **human-edited config** (operator-supplied), and YAML is the most
  readable of the common config formats.
- It supports **comments**, so you can document each policy inline.
- It maps naturally to a list of records (cleaner than TOML's `[[array]]`
  syntax and less noisy than JSON for hand-editing).
- It is trivially parseable in Python with `PyYAML`.

JSON works too if you prefer machine-generated registries — just change
`yaml.safe_load` to `json.load` in [server.py](server.py). Plain text is not
recommended because it forces you to write a custom parser.

Schema:

```yaml
policies:
  - id: <unique string – this is what gets pushed to Redis>
    name: <human readable label>
    description: <free text>
```

See [policies.yaml](policies.yaml) for a working example.

The registry is **re-read on every tool call**, so you can edit the file
on a running container (via the mounted volume) and the changes are picked
up immediately — no restart needed.

---

## Configuration

All configuration is via environment variables. For local development copy
the template:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `POLICY_REGISTRY_PATH` | `policies.yaml` | Path to the registry file. |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection URL. |
| `REDIS_QUEUE_NAME` | `policy_queue` | Redis list used as the queue. |
| `MCP_TRANSPORT` | `stdio` | `stdio` for local subprocess; `http` for streamable-HTTP (use this in Docker). |
| `MCP_HOST` | `0.0.0.0` | HTTP bind host. |
| `MCP_PORT` | `8000` | HTTP bind port. |

---

## Run with Docker (recommended)

The included `docker-compose.yml` starts Redis and the MCP server together
and mounts `./policies.yaml` into the container read-only.

```bash
docker compose up --build
```

The MCP endpoint is then reachable at `http://localhost:8000/mcp` over the
streamable-HTTP transport.

To use a **different registry file**, edit the volume mapping in
`docker-compose.yml`:

```yaml
volumes:
  - /absolute/path/to/your-registry.yaml:/app/policies.yaml:ro
```

Or override `POLICY_REGISTRY_PATH` and mount the file at a different location.

---

## Run locally (without Docker)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start a Redis server somewhere, e.g.:
docker run --rm -p 6379:6379 redis:7-alpine

# Run the MCP server over stdio (default):
python server.py
```

To run with HTTP transport instead:

```bash
MCP_TRANSPORT=http python server.py
```

---

## Verify the queue

After the agent calls `push_policy` / `push_policy_sequence`, you can
inspect the queue with `redis-cli`:

```bash
redis-cli LRANGE policy_queue 0 -1
```

A worker on the robot side consumes policies like this (Python):

```python
import redis
r = redis.Redis.from_url("redis://localhost:6379/0", decode_responses=True)
while True:
    _, policy_id = r.blpop("policy_queue")
    run_policy(policy_id)  # your dispatch logic
```

---

## Files

| File | Purpose |
|---|---|
| [server.py](server.py) | MCP server implementation. |
| [policies.yaml](policies.yaml) | Example registry; replace with your own. |
| [requirements.txt](requirements.txt) | Python dependencies. |
| [.env.example](.env.example) | Template for local env config. |
| [Dockerfile](Dockerfile) | Container image for the MCP server. |
| [docker-compose.yml](docker-compose.yml) | Brings up Redis + MCP server together. |
