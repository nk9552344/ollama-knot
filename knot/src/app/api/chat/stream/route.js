/**
 * Server-side chat orchestrator.
 *
 * The browser POSTs `{ chatId }` here. We:
 *   1. Read the chat + system prompt + selected (active) MCP servers from disk
 *   2. Fetch tool definitions from each MCP server (HTTP only)
 *   3. Stream from Ollama, executing tool calls in a loop, until the model
 *      stops emitting tool_calls or we hit MAX_TURNS
 *   4. Forward everything to the browser as Server-Sent Events
 *
 * Event types written to the SSE stream:
 *   { type: "mcp_status", server, status, message?, toolCount? }
 *   { type: "thinking",    delta }
 *   { type: "content",     delta }
 *   { type: "tool_call",   id, server, displayName, fullName, args, status: "running" }
 *   { type: "tool_result", id, server, displayName, status: "success"|"error", content, error? }
 *   { type: "new_turn" }                       // emitted before each fresh assistant block
 *   { type: "error",       error }
 *   { type: "done" }
 */

import { readStore } from "@/lib/store";
import {
  mcpCallTool,
  mcpListTools,
  mcpResultToText,
  serverSlug,
  toOllamaTool,
} from "@/lib/mcpClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // up to 5 minutes for long tool loops

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const MAX_TURNS = 8;

function sseEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function normaliseToolArgs(raw) {
  // Ollama's `/api/chat` expects tool_calls[].function.arguments to be a
  // JSON OBJECT (not a JSON-encoded string the way OpenAI does it). If we
  // send a string, Ollama tries to interpret it as the schema-typed object
  // and returns:
  //   {"error":"Value looks like object, but can't find closing '}' symbol"}
  // So normalise every shape we might get from storage or upstream into
  // a plain object.
  if (raw == null) return {};
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return {};
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

function expandMessagesForOllama(messages) {
  // Strip client-only fields (`thinking`, `_meta`) before sending.
  return messages.map((m) => {
    const out = { role: m.role, content: m.content || "" };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      out.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: tc.type || "function",
        function: {
          name: tc.function?.name,
          // Object (Ollama format) — not a JSON-encoded string.
          arguments: normaliseToolArgs(tc.function?.arguments),
        },
      }));
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });
}

function applySystemPrompt(messages, systemPromptContent) {
  if (!systemPromptContent) return messages;
  if (systemPromptContent.includes("${USER_PROMPT}")) {
    // Find the last user message and inject.
    const idx = [...messages]
      .reverse()
      .findIndex((m) => m.role === "user");
    if (idx === -1) return messages;
    const realIdx = messages.length - 1 - idx;
    const lastUser = messages[realIdx];
    const injected = systemPromptContent.replace(
      "${USER_PROMPT}",
      lastUser.content || "",
    );
    return [
      ...messages.slice(0, realIdx),
      { ...lastUser, content: injected },
      ...messages.slice(realIdx + 1),
    ];
  }
  return [{ role: "system", content: systemPromptContent }, ...messages];
}

/**
 * Returns the largest k (k >= 1, k < needle.length) such that
 * haystack.endsWith(needle.slice(0, k)). Used to detect a tag split across
 * stream chunks.
 */
function findPartialSuffixMatch(haystack, needle) {
  const max = Math.min(needle.length - 1, haystack.length);
  for (let k = max; k > 0; k--) {
    if (haystack.slice(-k) === needle.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Stateful splitter that pulls `<think>…</think>` blocks out of a token
 * stream and routes them to a separate `thinking` channel. For models that
 * emit reasoning inline (deepseek-r1, qwq, etc.) this prevents the tags from
 * leaking into the visible response.
 */
function createThinkSplitter() {
  let pending = "";
  let mode = "content"; // "content" | "thinking"
  const OPEN = "<think>";
  const CLOSE = "</think>";

  return function feed(text) {
    pending += text;
    const out = { content: "", thinking: "" };
    let progressed = true;
    while (progressed) {
      progressed = false;
      if (mode === "content") {
        const idx = pending.indexOf(OPEN);
        if (idx !== -1) {
          out.content += pending.slice(0, idx);
          pending = pending.slice(idx + OPEN.length);
          mode = "thinking";
          progressed = true;
          continue;
        }
        const partial = findPartialSuffixMatch(pending, OPEN);
        if (partial > 0) {
          out.content += pending.slice(0, pending.length - partial);
          pending = pending.slice(pending.length - partial);
        } else {
          out.content += pending;
          pending = "";
        }
      } else {
        const idx = pending.indexOf(CLOSE);
        if (idx !== -1) {
          out.thinking += pending.slice(0, idx);
          pending = pending.slice(idx + CLOSE.length);
          mode = "content";
          progressed = true;
          continue;
        }
        const partial = findPartialSuffixMatch(pending, CLOSE);
        if (partial > 0) {
          out.thinking += pending.slice(0, pending.length - partial);
          pending = pending.slice(pending.length - partial);
        } else {
          out.thinking += pending;
          pending = "";
        }
      }
    }
    return out;
  };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { chatId } = body || {};
  if (!chatId) {
    return Response.json({ error: "chatId is required" }, { status: 400 });
  }

  const chats = readStore("chats");
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) {
    return Response.json({ error: "Chat not found" }, { status: 404 });
  }

  const allServers = readStore("mcp-servers");
  const systemPrompts = readStore("system-prompts");
  const sysPromptObj = chat.systemPromptId
    ? systemPrompts.find((p) => p.id === chat.systemPromptId)
    : null;
  const systemPromptContent = sysPromptObj?.content || null;

  const selectedServers = (chat.mcpServerIds || [])
    .map((id) => allServers.find((s) => s.id === id))
    .filter((s) => s && s.active);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        try {
          controller.enqueue(encoder.encode(sseEvent(event)));
        } catch {
          /* stream may already be closed */
        }
      };

      const abortSignal = request.signal;

      try {
        // --- 1) Collect tools from all selected MCP servers --------------
        const tools = [];
        const toolMap = new Map(); // fullName → { server, displayName }

        for (const server of selectedServers) {
          if (abortSignal.aborted) return;
          send({
            type: "mcp_status",
            server: server.name,
            status: "listing",
          });

          const { tools: serverTools, error } = await mcpListTools(server);
          if (error) {
            send({
              type: "mcp_status",
              server: server.name,
              status: "error",
              message: error,
            });
            continue;
          }

          const slug = serverSlug(server);
          for (const t of serverTools) {
            const tool = toOllamaTool(server, t, { namespacePrefix: slug });
            tools.push(tool);
            toolMap.set(tool.function.name, {
              server,
              displayName: t.name,
            });
          }

          send({
            type: "mcp_status",
            server: server.name,
            status: "ready",
            toolCount: serverTools.length,
          });
        }

        // --- 2) Build the working message buffer --------------------------
        // Strip out _meta + thinking from stored messages, then expand to
        // the format Ollama expects.
        let messages = expandMessagesForOllama(chat.messages || []);
        messages = applySystemPrompt(messages, systemPromptContent);

        // --- 3) Tool-call loop --------------------------------------------
        let turn = 0;
        let anyContent = false;
        let anyThinking = false;

        send({ type: "new_turn" });

        while (turn < MAX_TURNS) {
          if (abortSignal.aborted) return;
          turn++;

          const reqBody = {
            model: chat.model,
            messages,
            stream: true,
          };
          if (tools.length > 0) reqBody.tools = tools;
          // Always send an explicit `think` value: if we omit it, Ollama
          // falls back to the model default and reasoning models think
          // anyway. Sending `think: false` actually suppresses reasoning.
          reqBody.think = chat.think === true;

          let ollamaRes;
          try {
            ollamaRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(reqBody),
              signal: abortSignal,
            });
          } catch (err) {
            if (err?.name === "AbortError") return;
            throw err;
          }

          if (!ollamaRes.ok) {
            const txt = await ollamaRes.text().catch(() => "");
            throw new Error(
              `Ollama ${ollamaRes.status}: ${txt || ollamaRes.statusText}`,
            );
          }

          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          let turnContent = "";
          let turnToolCalls = []; // accumulate raw tool_calls from this turn
          // Some models stream <think> tags inline in content even when
          // think=false. Split them per-turn so they never reach the user.
          const splitInlineThink = createThinkSplitter();

          while (true) {
            if (abortSignal.aborted) {
              try {
                reader.cancel();
              } catch {
                /* ignore */
              }
              return;
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const raw of lines) {
              const trimmed = raw.trim();
              if (!trimmed) continue;

              let parsed;
              try {
                parsed = JSON.parse(trimmed);
              } catch {
                continue;
              }
              if (parsed.error) throw new Error(parsed.error);

              const msg = parsed.message || {};

              // 1) Native reasoning field from Ollama.
              if (typeof msg.thinking === "string" && msg.thinking.length) {
                anyThinking = true;
                send({ type: "thinking", delta: msg.thinking });
              }

              // 2) `content` may carry inline <think>…</think> tags for
              // older r1-style models — route those to the thinking stream
              // and forward only the rest as visible content.
              if (typeof msg.content === "string" && msg.content.length) {
                const split = splitInlineThink(msg.content);
                if (split.thinking) {
                  anyThinking = true;
                  send({ type: "thinking", delta: split.thinking });
                }
                if (split.content) {
                  turnContent += split.content;
                  anyContent = true;
                  send({ type: "content", delta: split.content });
                }
              }

              if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
                // Some models stream tool_calls incrementally; for now we
                // accept the final array from any chunk that carries one.
                turnToolCalls = msg.tool_calls;
              }
            }
          }

          // No tool calls → model finished its answer.
          if (turnToolCalls.length === 0) break;

          // --- Execute tool calls, add results to the messages array -----
          // Note: `arguments` must be a JSON OBJECT for Ollama — not a
          // JSON-encoded string. Same reason as in expandMessagesForOllama.
          const assistantToolMsg = {
            role: "assistant",
            content: turnContent,
            tool_calls: turnToolCalls.map((tc) => ({
              id: tc.id || `call_${turn}_${Math.random().toString(36).slice(2, 8)}`,
              type: tc.type || "function",
              function: {
                name: tc.function?.name,
                arguments: normaliseToolArgs(tc.function?.arguments),
              },
            })),
          };
          messages.push(assistantToolMsg);

          for (const tc of assistantToolMsg.tool_calls) {
            const fnName = tc.function.name;
            // arguments is already an object after normalisation above.
            const fnArgs = tc.function.arguments || {};

            const mapping = toolMap.get(fnName);
            const displayName = mapping?.displayName || fnName;
            const serverName = mapping?.server?.name || "unknown";

            send({
              type: "tool_call",
              id: tc.id,
              server: serverName,
              displayName,
              fullName: fnName,
              args: fnArgs,
              status: "running",
            });

            if (!mapping) {
              const errMsg = `Tool "${fnName}" is not known to any configured MCP server.`;
              messages.push({
                role: "tool",
                content: errMsg,
                tool_call_id: tc.id,
              });
              send({
                type: "tool_result",
                id: tc.id,
                server: serverName,
                displayName,
                status: "error",
                content: errMsg,
                error: errMsg,
              });
              continue;
            }

            let resultText;
            let isError = false;
            try {
              const mcpRes = await mcpCallTool(
                mapping.server,
                mapping.displayName,
                fnArgs,
              );
              resultText = mcpResultToText(mcpRes);
              isError = Boolean(mcpRes?.isError);
            } catch (err) {
              resultText = err.message || "Tool call failed";
              isError = true;
            }

            messages.push({
              role: "tool",
              content: resultText || "(empty result)",
              tool_call_id: tc.id,
            });

            send({
              type: "tool_result",
              id: tc.id,
              server: serverName,
              displayName,
              status: isError ? "error" : "success",
              content: resultText,
              error: isError ? resultText : undefined,
            });
          }

          // Loop to let the model see the tool results.
          send({ type: "new_turn" });
        }

        if (turn >= MAX_TURNS && !anyContent) {
          send({
            type: "content",
            delta: `\n\n_⚠ Reached the maximum tool-call depth (${MAX_TURNS}) without a final answer._`,
          });
        } else if (!anyContent && !anyThinking) {
          send({
            type: "content",
            delta:
              "_⚠ The model returned an empty response. Try a different model or simplify your prompt._",
          });
        }

        send({ type: "done" });
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("/api/chat/stream error:", error);
          send({ type: "error", error: error.message || String(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },

    cancel() {
      // Browser disconnected — nothing to clean up explicitly.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
