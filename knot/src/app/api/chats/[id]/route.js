import { readStore, writeStore } from "@/lib/store";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const chats = readStore("chats");
    const chat = chats.find((c) => c.id === id);

    if (!chat) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }

    return Response.json(chat);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const chats = readStore("chats");
    const index = chats.findIndex((c) => c.id === id);

    if (index === -1) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }

    chats[index] = { ...chats[index], ...updates };
    writeStore("chats", chats);
    return Response.json(chats[index]);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const chats = readStore("chats");
    const filtered = chats.filter((c) => c.id !== id);

    if (filtered.length === chats.length) {
      return Response.json({ error: "Chat not found" }, { status: 404 });
    }

    writeStore("chats", filtered);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
