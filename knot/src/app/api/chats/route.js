import { readStore, writeStore } from "@/lib/store";

export async function GET() {
  try {
    const chats = readStore("chats");
    return Response.json(chats);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const chat = await request.json();
    const chats = readStore("chats");
    chats.push(chat);
    writeStore("chats", chats);
    return Response.json(chat, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
