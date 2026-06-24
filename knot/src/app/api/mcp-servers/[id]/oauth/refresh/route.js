import { canRefreshOauth, refreshOauthToken } from "@/lib/mcpAuth";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const servers = readStore("mcp-servers");
    const server = servers.find((s) => s.id === id);
    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }
    if (!canRefreshOauth(server.auth)) {
      return Response.json(
        { error: "No refresh token available" },
        { status: 400 },
      );
    }
    const auth = await refreshOauthToken(id);
    return Response.json({
      ok: true,
      tokenType: auth.tokenType,
      scope: auth.scope || null,
      expiresAt: auth.expiresAt || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
