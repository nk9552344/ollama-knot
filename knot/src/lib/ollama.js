function buildFinalMessages(systemPromptContent, chatMessages) {
  if (!systemPromptContent) return chatMessages;

  if (systemPromptContent.includes("${USER_PROMPT}")) {
    const lastUserMsg = chatMessages[chatMessages.length - 1];
    const injected = systemPromptContent.replace(
      "${USER_PROMPT}",
      lastUserMsg.content,
    );
    return [
      ...chatMessages.slice(0, -1),
      { role: "user", content: injected },
    ];
  }

  return [{ role: "system", content: systemPromptContent }, ...chatMessages];
}

function resolveOllamaHost() {
  if (typeof window !== "undefined") {
    return (
      process.env.NEXT_PUBLIC_OLLAMA_HOST || "http://localhost:11434"
    );
  }
  return process.env.OLLAMA_HOST || "http://localhost:11434";
}

export async function streamChat({
  model,
  messages,
  systemPromptContent,
  signal,
  onChunk,
  onDone,
  onError,
}) {
  try {
    const finalMessages = buildFinalMessages(systemPromptContent, messages);
    const ollamaHost = resolveOllamaHost();

    const response = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.message?.content) {
            fullContent += parsed.message.content;
            onChunk(parsed.message.content);
          }
        } catch {
          // Ignore parse errors for incomplete JSON
        }
      }
    }

    onDone(fullContent);
  } catch (error) {
    if (error?.name === "AbortError") {
      onError?.(error);
      return;
    }
    console.error("Streaming error:", error);
    onError?.(error);
  }
}
