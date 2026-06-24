const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

export async function POST(request) {
  try {
    const { model } = await request.json();

    if (!model) {
      return Response.json(
        { error: "Model name is required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });

    if (!response.ok) {
      throw new Error("Failed to pull model from Ollama");
    }

    // Return SSE stream
    const encoder = new TextEncoder();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split("\n");

              for (const line of lines) {
                if (line.trim()) {
                  controller.enqueue(encoder.encode(`data: ${line}\n\n`));
                }
              }
            }
            controller.close();
          } catch (error) {
            console.error("Streaming error:", error);
            controller.error(error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  } catch (error) {
    console.error("Error pulling model:", error);
    return Response.json(
      { error: "Failed to pull model", details: error.message },
      { status: 500 }
    );
  }
}
