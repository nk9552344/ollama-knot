"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerUpLeft,
  Loader2,
  User,
  Wrench,
  X as XIcon,
} from "lucide-react";
import { useStore } from "@/store";

function ActionButton({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded p-1 text-text-muted opacity-0 transition group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function MessageActions({ text }) {
  const [copied, setCopied] = useState(false);
  const setPendingInputText = useStore((s) => s.setPendingInputText);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleUseAsInput = () => {
    setPendingInputText(text);
  };

  return (
    <div className="flex items-center gap-1">
      <ActionButton onClick={handleCopy} title={copied ? "Copied" : "Copy"}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </ActionButton>
      <ActionButton onClick={handleUseAsInput} title="Use as input">
        <CornerUpLeft size={13} />
      </ActionButton>
    </div>
  );
}

function ThinkingBlock({ text, streaming }) {
  const [expanded, setExpanded] = useState(true);
  const collapsed = !streaming && !expanded;

  return (
    <div className="mb-2 rounded-md border border-border bg-bg-overlay/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-text-muted hover:text-text-primary"
      >
        <span className="flex items-center gap-1.5">
          <Brain size={12} />
          <span>Thinking</span>
          {streaming && (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          )}
        </span>
        {streaming || expanded ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
      </button>
      {!collapsed && (
        <pre className="m-0 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 font-mono text-[11.5px] leading-relaxed text-text-secondary">
          {text}
          {streaming && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-text-secondary align-middle" />
          )}
        </pre>
      )}
    </div>
  );
}

function AssistantBody({ content }) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : null;
            return !inline && language ? (
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={language}
                customStyle={{
                  margin: "0.5rem 0",
                  borderRadius: "0.5rem",
                  fontSize: "0.8125rem",
                }}
                {...props}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code className="rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-[0.85em] text-text-primary">
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return (
              <ul className="mb-2 list-inside list-disc space-y-1">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="mb-2 list-inside list-decimal space-y-1">
                {children}
              </ol>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                className="text-accent hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-2 border-l-2 border-border pl-3 text-text-secondary">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}

function ToolCallCard({ callMeta, callName, callArgs }) {
  const [expanded, setExpanded] = useState(false);
  const status = callMeta?.status || "running";

  const StatusIcon = () => {
    if (status === "success") {
      return <Check size={12} className="text-status-green" />;
    }
    if (status === "error") {
      return <XIcon size={12} className="text-status-red" />;
    }
    return <Loader2 size={12} className="animate-spin text-accent" />;
  };

  const statusLabel = {
    running: "running",
    success: "ok",
    error: "error",
  }[status];

  return (
    <div className="mb-2 rounded-md border border-border bg-bg-overlay/60 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:text-text-primary"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Wrench size={12} className="text-text-muted" />
          <span className="font-mono text-text-primary truncate">
            {callMeta?.displayName || callName}
          </span>
          {callMeta?.server && (
            <span className="rounded bg-bg-active px-1.5 py-0.5 text-[10px] text-text-secondary">
              {callMeta.server}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
          <StatusIcon />
          <span>{statusLabel}</span>
          {expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
              Arguments
            </div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1.5 font-mono text-[11px] text-text-secondary">
              {JSON.stringify(callArgs ?? callMeta?.args ?? {}, null, 2)}
            </pre>
          </div>
          {(callMeta?.result || callMeta?.error) && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">
                {callMeta.status === "error" ? "Error" : "Result"}
              </div>
              <pre
                className={`max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg px-2 py-1.5 font-mono text-[11px] ${
                  callMeta.status === "error"
                    ? "text-status-red"
                    : "text-text-secondary"
                }`}
              >
                {callMeta.error || callMeta.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message }) {
  const streamingChatId = useStore((s) => s.streamingChatId);
  const activeChatId = useStore((s) => s.activeChatId);
  const chats = useStore((s) => s.chats);

  // `tool` role messages are intentionally hidden — their content shows up
  // inside the matching ToolCallCard on the preceding assistant message.
  if (message.role === "tool") return null;

  const isAssistant = message.role === "assistant";

  const liveChat = chats.find((c) => c.id === activeChatId);
  const lastMsg = liveChat?.messages?.[liveChat?.messages?.length - 1];
  const isStreamingThisMessage =
    streamingChatId === activeChatId &&
    isAssistant &&
    lastMsg === message;

  if (isAssistant) {
    const hasToolCalls =
      Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

    return (
      <div className="group flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Bot size={15} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          {message.thinking ? (
            <ThinkingBlock
              text={message.thinking}
              streaming={
                isStreamingThisMessage && !(message.content || "").length
              }
            />
          ) : null}

          {hasToolCalls && (
            <div>
              {message.tool_calls.map((tc) => {
                const meta = message._meta?.calls?.[tc.id];
                let args;
                try {
                  args =
                    typeof tc.function?.arguments === "string"
                      ? JSON.parse(tc.function.arguments)
                      : tc.function?.arguments;
                } catch {
                  args = tc.function?.arguments;
                }
                return (
                  <ToolCallCard
                    key={tc.id}
                    callMeta={meta}
                    callName={tc.function?.name}
                    callArgs={args}
                  />
                );
              })}
            </div>
          )}

          {message.content ? (
            <AssistantBody content={message.content} />
          ) : !message.thinking && !hasToolCalls ? (
            <p className="text-sm italic text-text-muted">
              {isStreamingThisMessage ? "Waiting for response…" : "(empty)"}
            </p>
          ) : null}

          {(message.content || message.thinking) && (
            <div className="mt-1">
              <MessageActions
                text={
                  message.content ||
                  (message.thinking ? `<thinking>\n${message.thinking}` : "")
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-end gap-3">
      <div className="flex max-w-[85%] flex-col items-end">
        <div className="rounded-2xl rounded-tr-md bg-accent/15 px-3.5 py-2 text-sm text-text-primary">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {message.content && (
          <div className="mt-1 flex justify-end">
            <MessageActions text={message.content} />
          </div>
        )}
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-active text-text-secondary">
        <User size={15} />
      </div>
    </div>
  );
}

