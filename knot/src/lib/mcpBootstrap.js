/**
 * Env-driven MCP server bootstrap.
 *
 * On the first import of this module (i.e. once per server process) we
 * reconcile the entries in `data/mcp-servers.json` against the environment.
 * This lets a docker-compose `environment:` block declare the MCP servers
 * the app should know about — perfect for "I always have the same one
 * sitting next to me on the compose network".
 *
 * Two input formats are supported (highest precedence first):
 *
 *   1. MCP_BOOTSTRAP_SERVERS  — a JSON array of server configs, e.g.
 *
 *        MCP_BOOTSTRAP_SERVERS='[{"id":"g1","name":"Unitree G1",
 *          "type":"http","url":"http://mcp-g1:8000/mcp","transport":"http"}]'
 *
 *   2. MCP_BOOTSTRAP_URL      — convenience single-server form. Pairs with
 *      MCP_BOOTSTRAP_ID, MCP_BOOTSTRAP_NAME, MCP_BOOTSTRAP_TRANSPORT
 *      ("http" | "sse" | unset for auto), MCP_BOOTSTRAP_DESCRIPTION.
 *
 * Behaviour
 * ─────────
 *  • Matching is by `id`. Existing entries are updated with the env-supplied
 *    fields; new ones are appended.
 *  • A user's `active` toggle in the UI is preserved across restarts
 *    (env does not force-enable an entry the user disabled).
 *  • Failures are logged but never throw — bootstrap must not crash the app.
 */

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "mcp-servers.json");

let bootstrapped = false;

function parseConfigs() {
  const jsonRaw = process.env.MCP_BOOTSTRAP_SERVERS;
  if (jsonRaw && jsonRaw.trim()) {
    try {
      const arr = JSON.parse(jsonRaw);
      if (Array.isArray(arr)) return arr;
      console.warn(
        "[mcpBootstrap] MCP_BOOTSTRAP_SERVERS must be a JSON array — ignoring.",
      );
    } catch (err) {
      console.warn(
        `[mcpBootstrap] MCP_BOOTSTRAP_SERVERS is not valid JSON: ${err.message}`,
      );
    }
  }

  const url = process.env.MCP_BOOTSTRAP_URL;
  if (url && url.trim()) {
    const transport = process.env.MCP_BOOTSTRAP_TRANSPORT || null;
    return [
      {
        id: process.env.MCP_BOOTSTRAP_ID || "bootstrap-default",
        name: process.env.MCP_BOOTSTRAP_NAME || "Bootstrapped MCP Server",
        type: "http",
        url: url.trim(),
        transport: transport === "http" || transport === "sse" ? transport : null,
        description: process.env.MCP_BOOTSTRAP_DESCRIPTION || "",
        auth: { type: "none" },
      },
    ];
  }

  return [];
}

function readExisting() {
  if (!fs.existsSync(FILE)) return [];
  try {
    const raw = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(
      `[mcpBootstrap] Could not parse ${FILE} (${err.message}); starting from empty list.`,
    );
    return [];
  }
}

function normalise(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  if (!cfg.id || !cfg.url) return null;
  return {
    id: String(cfg.id),
    name: cfg.name || cfg.id,
    type: "http",
    url: String(cfg.url),
    transport:
      cfg.transport === "http" || cfg.transport === "sse" ? cfg.transport : null,
    description: cfg.description || "",
    auth: cfg.auth && typeof cfg.auth === "object" ? cfg.auth : { type: "none" },
    bootstrapped: true,
  };
}

export function bootstrapMcpServers() {
  if (bootstrapped) return;
  bootstrapped = true;

  const configs = parseConfigs().map(normalise).filter(Boolean);
  if (configs.length === 0) return;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const existing = readExisting();
  let changed = false;

  for (const cfg of configs) {
    const idx = existing.findIndex((s) => s && s.id === cfg.id);
    if (idx >= 0) {
      // Preserve the user's `active` toggle; everything else mirrors env.
      const userActive =
        typeof existing[idx].active === "boolean" ? existing[idx].active : true;
      const next = {
        ...existing[idx],
        ...cfg,
        active: userActive,
      };
      // Skip the write if nothing actually changed.
      if (JSON.stringify(next) !== JSON.stringify(existing[idx])) {
        existing[idx] = next;
        changed = true;
      }
    } else {
      existing.push({
        ...cfg,
        active: true,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }

  if (!changed) return;

  try {
    fs.writeFileSync(FILE, JSON.stringify(existing, null, 2), "utf-8");
    console.log(
      `[mcpBootstrap] reconciled ${configs.length} server(s) from environment.`,
    );
  } catch (err) {
    console.error(`[mcpBootstrap] failed to write ${FILE}: ${err.message}`);
  }
}
