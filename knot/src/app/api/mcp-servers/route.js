import { readStore, writeStore } from "@/lib/store";

export async function GET() {
  try {
    const servers = readStore("mcp-servers");
    return Response.json(servers);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const server = await request.json();
    const servers = readStore("mcp-servers");
    servers.push(server);
    writeStore("mcp-servers", servers);
    return Response.json(server, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
