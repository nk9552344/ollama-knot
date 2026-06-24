import { readStore } from "@/lib/store";
import {
  buildAuthHeaders,
  canRefreshOauth,
  getAuthSummary,
  isOauthExpired,
  refreshOauthToken,
} from "@/lib/mcpAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkHttp(server) {
  const startedAt = Date.now();
  if (!server.url) {
    return { reachable: false, error: "No URL configured" };
  }

  const headers = {
    Accept: "application/json, text/event-stream",
    ...buildAuthHeaders(server.auth),
  };

  // MCP HTTP servers speak JSON-RPC over POST. A bare HEAD/GET often returns
  // 405 — that still proves the host is alive, so we accept it as reachable.
  const doRequest = async (method, extra = {}) =>
    fetchWithTimeout(server.url, {
      method,
      headers,
      cache: "no-store",
      ...extra,
    });

  try {
    let response = await doRequest("HEAD").catch(() => null);
    if (!response || response.status === 405 || response.status === 501) {
      response = await doRequest("GET").catch(() => null);
    }
    if (!response) {
      return {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: "No response from server",
      };
    }

    const latencyMs = Date.now() - startedAt;
    const status = response.status;

    if (status === 401 || status === 403) {
      const wwwAuth = response.headers.get("www-authenticate") || undefined;
      return {
        reachable: false,
        authRequired: true,
        status,
        wwwAuthenticate: wwwAuth,
        latencyMs,
        error:
          status === 401
            ? "Authentication required"
            : "Authenticated but forbidden",
      };
    }

    // For MCP HTTP servers, any non-5xx response means the host is alive.
    const reachable = status < 500;
    return {
      reachable,
      status,
      latencyMs,
      error: reachable ? undefined : `HTTP ${status}`,
    };
  } catch (error) {
    const aborted = error.name === "AbortError";
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: aborted ? "Connection timed out" : error.message || "Unreachable",
    };
  }
}

function checkStdio(server) {
  if (!server.command) {
    return {
      reachable: false,
      error: "No command configured",
      note: "stdio servers are reported as configured-only",
    };
  }
  return {
    reachable: true,
    note: "stdio reachability is reported based on configuration",
  };
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const servers = readStore("mcp-servers");
    let server = servers.find((s) => s.id === id);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (!server.active) {
      return Response.json({
        id: server.id,
        reachable: false,
        disabled: true,
        note: "Server is marked inactive",
        auth: getAuthSummary(server.auth),
      });
    }

    // If we have an OAuth refresh token and the access token is expired,
    // attempt a silent refresh before checking reachability.
    let refreshError = null;
    if (canRefreshOauth(server.auth) && isOauthExpired(server.auth)) {
      try {
        const refreshed = await refreshOauthToken(server.id);
        server = { ...server, auth: refreshed };
      } catch (err) {
        refreshError = err.message;
      }
    }

    const result =
      server.type === "http" ? await checkHttp(server) : checkStdio(server);

    return Response.json({
      id: server.id,
      type: server.type,
      ...result,
      auth: getAuthSummary(server.auth),
      ...(refreshError ? { refreshError } : {}),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

