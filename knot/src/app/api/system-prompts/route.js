import { readStore, writeStore } from "@/lib/store";

export async function GET() {
  try {
    const prompts = readStore("system-prompts");
    return Response.json(prompts);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const prompt = await request.json();
    const prompts = readStore("system-prompts");
    prompts.push(prompt);
    writeStore("system-prompts", prompts);
    return Response.json(prompt, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
