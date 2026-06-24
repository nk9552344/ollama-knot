import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function checkHttp(server) {
  const startedAt = Date.now();
  if (!server.url) {
    return { reachable: false, error: "No URL configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    // Try a HEAD first, fall back to GET if the server doesn't allow HEAD.
    let response = await fetch(server.url, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    }).catch(() => null);

    if (!response || response.status === 405 || response.status === 501) {
      response = await fetch(server.url, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
    }

    clearTimeout(timeoutId);

    // For MCP HTTP servers, any non-5xx response means the host is alive.
    const reachable = response.status < 500;
    return {
      reachable,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: reachable ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const aborted = error.name === "AbortError";
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      error: aborted ? "Connection timed out" : error.message || "Unreachable",
    };
  }
}

function checkStdio(server) {
  // We cannot spawn the process from a serverless route reliably,
  // so we report "configured" when a command is set.
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
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (!server.active) {
      return Response.json({
        id: server.id,
        reachable: false,
        disabled: true,
        note: "Server is marked inactive",
      });
    }

    const result =
      server.type === "http" ? await checkHttp(server) : checkStdio(server);

    return Response.json({ id: server.id, type: server.type, ...result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
