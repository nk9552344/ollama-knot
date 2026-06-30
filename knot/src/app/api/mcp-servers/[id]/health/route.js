import { readStore } from "@/lib/store";
import { mcpListTools } from "@/lib/mcpClient";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const servers = readStore("mcp-servers");
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (!server.active) {
      return Response.json({ disabled: true });
    }

    const start = Date.now();
    const { tools, error } = await mcpListTools(server);
    const latencyMs = Date.now() - start;

    if (error) {
      const authRequired =
        /401|403|unauthorized|forbidden|auth/i.test(error);
      return Response.json({
        reachable: false,
        latencyMs,
        error,
        authRequired,
      });
    }

    return Response.json({
      reachable: true,
      latencyMs,
      toolCount: tools?.length ?? 0,
    });
  } catch (error) {
    return Response.json({ reachable: false, error: error.message });
  }
}
