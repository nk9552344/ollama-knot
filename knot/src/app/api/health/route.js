const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";

// Avoid Next.js caching this route — health must be live.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return Response.json(
        {
          online: false,
          host: OLLAMA_HOST,
          status: response.status,
          error: `Ollama responded with ${response.status}`,
          latencyMs: Date.now() - startedAt,
        },
        { status: 200 },
      );
    }

    const data = await response.json().catch(() => ({}));
    const modelCount = Array.isArray(data.models) ? data.models.length : 0;

    return Response.json({
      online: true,
      host: OLLAMA_HOST,
      modelCount,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    const aborted = error.name === "AbortError";
    return Response.json(
      {
        online: false,
        host: OLLAMA_HOST,
        error: aborted ? "Connection timed out" : error.message,
        latencyMs: Date.now() - startedAt,
      },
      { status: 200 },
    );
  }
}
