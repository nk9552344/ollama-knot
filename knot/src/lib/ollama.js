/**
 * Browser-side client for the chat endpoint.
 *
 * All chats are routed through `/api/chat/stream`, which handles:
 *  - System-prompt injection
 *  - MCP tool discovery + execution
 *  - The multi-turn tool-call loop with Ollama
 *  - Streaming everything back as SSE
 *
 * We just parse the SSE events and hand them to the caller via `onEvent`.
 *
 * onEvent receives one of:
 *   { type: "content",     delta }
 *   { type: "thinking",    delta }
 *   { type: "tool_call",   id, server, displayName, fullName, args, status: "running" }
 *   { type: "tool_result", id, server, displayName, status: "success"|"error", content, error? }
 *   { type: "mcp_status",  server, status, message?, toolCount? }
 *   { type: "new_turn" }
 *   { type: "error",       error }
 *   { type: "done" }
 */
export async function streamChat({ chatId, signal, onEvent, onDone, onError }) {
  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Chat API ${response.status}${body ? ` — ${body}` : ""}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim());
        if (dataLines.length === 0) continue;

        let parsed;
        try {
          parsed = JSON.parse(dataLines.join("\n"));
        } catch {
          continue;
        }

        if (parsed?.type === "error") {
          throw new Error(parsed.error || "Stream error");
        }
        if (parsed?.type === "done") {
          // Done event; loop ends when reader.read() finishes.
          continue;
        }
        onEvent?.(parsed);
      }
    }

    onDone?.();
  } catch (error) {
    if (error?.name === "AbortError") {
      onError?.(error);
      return;
    }
    console.error("Streaming error:", error);
    onError?.(error);
  }
}
