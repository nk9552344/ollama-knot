const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export async function GET() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!response.ok) {
      throw new Error("Failed to fetch models from Ollama");
    }

    const data = await response.json();
    const models = (data.models || [])
      .map((m) => ({
        name: m.name,
        size: m.size,
        sizeFormatted: formatBytes(m.size),
        modifiedAt: m.modified_at,
      }))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    return Response.json(models);
  } catch (error) {
    console.error("Error fetching models:", error);
    return Response.json(
      { error: "Failed to fetch models", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { name } = await request.json();

    const response = await fetch(`${OLLAMA_HOST}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error("Failed to delete model from Ollama");
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error deleting model:", error);
    return Response.json(
      { error: "Failed to delete model", details: error.message },
      { status: 500 }
    );
  }
}
