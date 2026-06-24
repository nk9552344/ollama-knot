/**
 * Server-side MCP client supporting BOTH HTTP transports defined by the
 * Model Context Protocol:
 *
 *   1. Streamable HTTP  (current spec, 2025-03-26)
 *      Single endpoint. POST JSON-RPC; response is either application/json
 *      or text/event-stream on the same connection. Session ID is conveyed
 *      via the `Mcp-Session-Id` header.
 *
 *   2. HTTP + SSE       (legacy spec, 2024-11-05; still used by DeepWiki,
 *                        many community servers)
 *      Persistent GET stream that announces a separate POST endpoint via
 *      `event: endpoint`. JSON-RPC responses are pushed back through the
 *      GET stream, not the POST response.
 *
 * Transport is auto-selected:
 *   • If `server.auth?.transport` is "sse" or "http" use that explicitly.
 *   • Otherwise, URL paths ending in `/sse` (or `/sse/`) are treated as the
 *     legacy SSE transport (this is the de-facto convention).
 *   • Everything else uses Streamable HTTP.
 */

import { randomUUID } from "node:crypto";
import { buildAuthHeaders } from "@/lib/mcpAuth";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "MCP Studio", version: "0.1.0" };
const REQUEST_TIMEOUT_MS = 30_000;
const ENDPOINT_DISCOVERY_TIMEOUT_MS = 10_000;

function authHeaders(server) {
  return buildAuthHeaders(server?.auth) || {};
}

function transportOverride(server) {
  // Servers can pin a transport explicitly. We accept the field both at the
  // top level (preferred) and inside `auth` (legacy) so old configs keep
  // working.
  const fromTop = server?.transport;
  const fromAuth = server?.auth?.transport;
  const val = fromTop || fromAuth;
  if (val === "sse" || val === "http") return val;
  return null;
}

function transportFromUrl(server) {
  try {
    const u = new URL(server.url);
    // De-facto conventions: `/sse` ⇒ legacy SSE, `/mcp` ⇒ Streamable HTTP.
    if (/\/sse\/?$/.test(u.pathname)) return "sse";
    if (/\/mcp\/?$/.test(u.pathname)) return "http";
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Probe the URL with GET and check whether the server speaks SSE. We send
 * `Accept: text/event-stream` so any well-behaved Streamable HTTP server
 * either 405s (POST-only) or returns a non-SSE content type — both of
 * which keep us on the HTTP path.
 */
async function probeTransport(server) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const probe = await fetch(server.url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...authHeaders(server),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const ct = (probe.headers.get("content-type") || "").toLowerCase();
    try {
      await probe.body?.cancel();
    } catch {
      /* ignore */
    }
    if (probe.ok && ct.includes("text/event-stream")) return "sse";
  } catch {
    /* probe failed — fall back to URL heuristic */
  }
  return null;
}

/**
 * Resolve the transport to use. Order of precedence:
 *   1. explicit `transport` field on the server config
 *   2. URL path heuristic (`/sse` ⇒ sse, `/mcp` ⇒ http)
 *   3. live probe (GET → text/event-stream?)
 *   4. default: Streamable HTTP
 */
async function resolveTransport(server) {
  const explicit = transportOverride(server);
  if (explicit) return explicit;

  const fromUrl = transportFromUrl(server);
  if (fromUrl) return fromUrl;

  const probed = await probeTransport(server);
  if (probed) return probed;

  return "http";
}

// ────────────────────────────────────────────────────────────────────────────
// Streamable HTTP transport (single-shot POST)
// ────────────────────────────────────────────────────────────────────────────

async function postJsonRpcOnce(server, payload, { sessionId, timeoutMs } = {}) {
  if (!server?.url) throw new Error("MCP server URL is not configured");

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...authHeaders(server),
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  let response;
  try {
    response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  return response;
}

async function readJsonRpcReply(response, expectedId) {
  // Notifications return 202 Accepted with no body.
  if (response.status === 202) return null;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MCP HTTP ${response.status}: ${body || response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = rawEvent
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;

        let parsed;
        try {
          parsed = JSON.parse(dataLines.join("\n"));
        } catch {
          continue;
        }

        if (parsed && parsed.id === expectedId) {
          try {
            reader.cancel().catch(() => {});
          } catch {
            /* ignore */
          }
          return parsed;
        }
      }
    }

    throw new Error(
      "MCP server closed the SSE stream before responding (try the legacy /sse transport)",
    );
  }

  // Standard JSON response
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function httpRpcCall(server, method, params = {}, { sessionId } = {}) {
  const id = randomUUID();
  const payload = { jsonrpc: "2.0", id, method, params };
  const response = await postJsonRpcOnce(server, payload, { sessionId });
  const returnedSession =
    response.headers.get("mcp-session-id") || sessionId || null;
  const data = await readJsonRpcReply(response, id);
  if (!data) throw new Error(`MCP ${method}: empty response`);
  if (data.error) {
    const err = data.error;
    throw new Error(
      err.message
        ? `MCP ${method}: ${err.message}${err.data ? ` (${JSON.stringify(err.data)})` : ""}`
        : `MCP ${method}: ${JSON.stringify(err)}`,
    );
  }
  return { result: data.result, sessionId: returnedSession };
}

async function httpRpcNotify(server, method, params = {}, { sessionId } = {}) {
  const payload = { jsonrpc: "2.0", method, params };
  const response = await postJsonRpcOnce(server, payload, { sessionId });
  try {
    await response.body?.cancel();
  } catch {
    /* ignore */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy HTTP+SSE transport (persistent GET + separate POST endpoint)
// ────────────────────────────────────────────────────────────────────────────

function parseSseEvent(rawEvent) {
  let eventType = "message";
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) eventType = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { eventType, data: dataLines.join("\n") };
}

async function openSseSession(server) {
  const headers = {
    Accept: "text/event-stream",
    ...authHeaders(server),
  };

  const abortController = new AbortController();
  let response;
  try {
    response = await fetch(server.url, {
      method: "GET",
      headers,
      signal: abortController.signal,
    });
  } catch (err) {
    throw new Error(`MCP SSE GET ${server.url}: ${err.message}`);
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `MCP SSE GET ${server.url}: ${response.status}${body ? ` — ${body}` : ""}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Pending JSON-RPC responses keyed by id
  const pending = new Map(); // id → { resolve, reject, timer }
  let closed = false;
  let endpointUrl = null;
  let resolveEndpoint;
  let rejectEndpoint;
  const endpointPromise = new Promise((res, rej) => {
    resolveEndpoint = res;
    rejectEndpoint = rej;
  });
  const endpointTimer = setTimeout(() => {
    if (!endpointUrl) {
      rejectEndpoint(
        new Error(
          `MCP SSE: endpoint not announced within ${ENDPOINT_DISCOVERY_TIMEOUT_MS}ms`,
        ),
      );
    }
  }, ENDPOINT_DISCOVERY_TIMEOUT_MS);

  function processRawEvent(rawEvent) {
    const { eventType, data } = parseSseEvent(rawEvent);
    if (!data) return;

    if (eventType === "endpoint") {
      try {
        endpointUrl = new URL(data, server.url).toString();
        clearTimeout(endpointTimer);
        resolveEndpoint(endpointUrl);
      } catch (e) {
        rejectEndpoint(e);
      }
      return;
    }

    // Default "message" event carries JSON-RPC
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    if (parsed && parsed.id !== undefined && pending.has(parsed.id)) {
      const entry = pending.get(parsed.id);
      pending.delete(parsed.id);
      clearTimeout(entry.timer);
      if (parsed.error) {
        const err = parsed.error;
        entry.reject(
          new Error(
            err.message
              ? `${err.message}${err.data ? ` (${JSON.stringify(err.data)})` : ""}`
              : JSON.stringify(err),
          ),
        );
      } else {
        entry.resolve(parsed.result);
      }
    }
    // Notifications (no id) are ignored.
  }

  // Background read loop
  (async () => {
    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          processRawEvent(rawEvent);
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") {
        for (const [, p] of pending) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        pending.clear();
        if (!endpointUrl) {
          clearTimeout(endpointTimer);
          rejectEndpoint(err);
        }
      }
    } finally {
      closed = true;
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("MCP SSE: stream ended before response"));
      }
      pending.clear();
    }
  })();

  // Wait for the endpoint announcement
  await endpointPromise;

  async function request(method, params = {}, { timeoutMs } = {}) {
    if (closed) throw new Error("MCP SSE: session closed");
    const id = randomUUID();
    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(
            new Error(
              `MCP ${method}: timeout after ${timeoutMs ?? REQUEST_TIMEOUT_MS}ms`,
            ),
          );
        }
      }, timeoutMs ?? REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });

    const postRes = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(server),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    if (!postRes.ok && postRes.status !== 202) {
      const body = await postRes.text().catch(() => "");
      pending.delete(id);
      throw new Error(
        `MCP POST ${endpointUrl}: ${postRes.status}${body ? ` — ${body}` : ""}`,
      );
    }
    try {
      await postRes.body?.cancel();
    } catch {
      /* ignore */
    }

    return responsePromise;
  }

  async function notify(method, params = {}) {
    if (closed) return;
    try {
      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(server),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      });
      await res.body?.cancel();
    } catch {
      /* notifications are fire-and-forget */
    }
  }

  async function close() {
    closed = true;
    try {
      abortController.abort();
    } catch {
      /* ignore */
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }

  return { request, notify, close, endpointUrl };
}

// ────────────────────────────────────────────────────────────────────────────
// Unified session adapter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Opens a session, runs the initialize handshake, hands a small adapter to
 * `fn`, then closes the session. Works with both transports and will
 * automatically fall back from Streamable HTTP → legacy SSE if the server
 * never sends a matching response on the POST connection (a clear sign it
 * actually wants the SSE transport).
 */
async function withSession(server, fn) {
  if (server.type !== "http") {
    throw new Error(
      "stdio MCP transport is not supported by this build (HTTP only)",
    );
  }

  const transport = await resolveTransport(server);
  return runWithTransport(server, transport, fn);
}

async function runWithTransport(server, transport, fn) {
  if (transport === "sse") {
    const session = await openSseSession(server);
    try {
      await session.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      // Many servers require this notification before they will respond
      // to tools/list. Failure is non-fatal — some servers don't require it.
      session.notify("notifications/initialized").catch(() => {});
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  // Streamable HTTP path.
  let sessionId = null;
  try {
    const init = await httpRpcCall(server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    sessionId = init.sessionId;
    await httpRpcNotify(
      server,
      "notifications/initialized",
      {},
      { sessionId },
    ).catch(() => {});
  } catch (err) {
    // If the server returned an SSE stream but never produced a matching
    // response, it's almost certainly the legacy SSE transport. Retry once
    // automatically — unless the user explicitly pinned "http".
    const pinned = transportOverride(server);
    const looksLikeSse = /closed the SSE stream before responding/i.test(
      err?.message || "",
    );
    if (!pinned && looksLikeSse) {
      return runWithTransport(server, "sse", fn);
    }
    throw new Error(`MCP initialize failed: ${err.message}`);
  }

  const adapter = {
    request: async (method, params = {}) => {
      const { result } = await httpRpcCall(server, method, params, {
        sessionId,
      });
      return result;
    },
    notify: async (method, params = {}) => {
      await httpRpcNotify(server, method, params, { sessionId });
    },
    close: async () => {
      /* nothing to do for stateless HTTP */
    },
  };

  return await fn(adapter);
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated kept only so existing call-sites continue to compile. Prefer
 * `mcpListTools` / `mcpCallTool` which already handle initialize internally.
 */
export async function mcpInitialize(server) {
  return withSession(server, async () => ({
    sessionId: null,
    serverInfo: null,
    capabilities: {},
  }));
}

/**
 * Lists all tools exposed by an HTTP MCP server. Returns a plain object —
 * callers should check `error` before using `tools`.
 */
export async function mcpListTools(server) {
  if (!server) return { tools: [], error: "No server" };
  if (server.type !== "http") {
    return {
      tools: [],
      error:
        "stdio MCP transport is not supported by this build (HTTP only)",
    };
  }
  try {
    const tools = await withSession(server, async (session) => {
      const result = await session.request("tools/list", {});
      return result?.tools || [];
    });
    return { tools };
  } catch (error) {
    return { tools: [], error: error.message };
  }
}

/**
 * Calls a single tool. The result follows the MCP shape:
 *   { content: [ { type, text?, ... } ], isError?: boolean }
 */
export async function mcpCallTool(server, toolName, args = {}) {
  if (server?.type !== "http") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "stdio MCP transport is not supported by this build (HTTP only).",
        },
      ],
    };
  }
  try {
    return await withSession(server, async (session) => {
      const result = await session.request("tools/call", {
        name: toolName,
        arguments: args || {},
      });
      return result || { content: [] };
    });
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: "text", text: `Tool call failed: ${error.message}` },
      ],
    };
  }
}

/**
 * Flattens an MCP tool-call result into a string suitable for feeding back
 * to the LLM as a tool message.
 */
export function mcpResultToText(result) {
  if (!result) return "";
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => {
        if (!c) return "";
        if (c.type === "text") return c.text || "";
        if (c.type === "image")
          return `[image content: ${c.mimeType || "unknown type"}]`;
        if (c.type === "resource")
          return `[resource: ${c.resource?.uri || ""}]`;
        return JSON.stringify(c);
      })
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(result);
}

/**
 * Converts an MCP tool definition into the Ollama / OpenAI tool schema.
 * Tool names are namespaced so collisions across servers are avoided.
 */
export function toOllamaTool(server, tool, { namespacePrefix } = {}) {
  const prefix = namespacePrefix || serverSlug(server);
  const name = `${prefix}__${tool.name}`;
  return {
    type: "function",
    function: {
      name,
      description:
        tool.description ||
        `Tool "${tool.name}" exposed by MCP server "${server.name}"`,
      parameters: tool.inputSchema || {
        type: "object",
        properties: {},
      },
    },
  };
}

export function serverSlug(server) {
  const raw = (server?.name || server?.id || "mcp")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40)
    .toLowerCase();
  return raw || "mcp";
}
