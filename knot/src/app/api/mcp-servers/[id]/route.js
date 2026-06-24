import { readStore, writeStore } from "@/lib/store";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const servers = readStore("mcp-servers");
    const server = servers.find((s) => s.id === id);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    return Response.json(server);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const servers = readStore("mcp-servers");
    const index = servers.findIndex((s) => s.id === id);

    if (index === -1) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    servers[index] = { ...servers[index], ...updates };
    writeStore("mcp-servers", servers);
    return Response.json(servers[index]);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const servers = readStore("mcp-servers");
    const filtered = servers.filter((s) => s.id !== id);

    if (filtered.length === servers.length) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    writeStore("mcp-servers", filtered);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
