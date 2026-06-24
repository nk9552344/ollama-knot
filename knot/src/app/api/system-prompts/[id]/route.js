import { readStore, writeStore } from "@/lib/store";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const prompts = readStore("system-prompts");
    const prompt = prompts.find((p) => p.id === id);

    if (!prompt) {
      return Response.json({ error: "Prompt not found" }, { status: 404 });
    }

    return Response.json(prompt);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const updates = await request.json();
    const prompts = readStore("system-prompts");
    const index = prompts.findIndex((p) => p.id === id);

    if (index === -1) {
      return Response.json({ error: "Prompt not found" }, { status: 404 });
    }

    prompts[index] = {
      ...prompts[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    writeStore("system-prompts", prompts);
    return Response.json(prompts[index]);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prompts = readStore("system-prompts");
    const filtered = prompts.filter((p) => p.id !== id);

    if (filtered.length === prompts.length) {
      return Response.json({ error: "Prompt not found" }, { status: 404 });
    }

    writeStore("system-prompts", filtered);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
