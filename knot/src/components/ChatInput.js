"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { useStore } from "@/store";
import { StatusDot } from "./StatusDot";

function McpPill({ pill, toneClass }) {
  const [open, setOpen] = useState(false);
  const hasTools = pill.tools && pill.tools.length > 0;
  return (
    <span
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        title={!hasTools ? (pill.title || pill.label) : undefined}
        className={`inline-flex cursor-default items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}
      >
        <StatusDot status={pill.status} />
        {pill.label}
        {hasTools && (
          <span className="font-normal opacity-40">· {pill.tools.length}</span>
        )}
      </span>
      {open && hasTools && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 w-64 max-w-xs rounded-lg border border-border bg-bg-overlay shadow-xl">
          <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {pill.label} · {pill.tools.length} tool{pill.tools.length !== 1 ? "s" : ""}
          </div>
          <div className="max-h-52 overflow-y-auto px-3 py-2 space-y-2">
            {pill.tools.map((t) => (
              <div key={t.name}>
                <code className="text-[11px] text-accent">{t.name}</code>
                {t.description && (
                  <p className="mt-0.5 text-[10px] leading-tight text-text-muted">
                    {t.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Pill: { label, icon?, tone?: 'default'|'accent'|'warning'|'danger', status? }
 */
export function ChatInput({
  onSend,
  onCancel,
  disabled = false,
  isStreaming = false,
  pills = [],
  placeholder = "Type your message…  (Enter to send, Shift+Enter for newline)",
}) {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  // Allow other components (e.g. ChatMessage "Use as input") to push text
  // into the textarea via the store.
  const pendingInputText = useStore((s) => s.pendingInputText);
  const setPendingInputText = useStore((s) => s.setPendingInputText);

  const adjustHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const newHeight = Math.min(textarea.scrollHeight, 200);
      textarea.style.height = `${newHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (pendingInputText == null) return;
    setInput(pendingInputText);
    setPendingInputText(null);
    // Defer focus + caret-to-end until React applies the value.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      adjustHeight();
    });
  }, [pendingInputText, setPendingInputText]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input);
      setInput("");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="border-t border-border bg-bg px-4 py-3">
      <div className="mx-auto max-w-4xl space-y-2">
        {pills.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((pill, idx) => {
              const tones = {
                default: "bg-bg-active text-text-secondary",
                accent: "bg-accent/15 text-accent",
                warning: "bg-status-red/10 text-status-red",
              };
              const toneClass = tones[pill.tone || "default"];
              // MCP server pills (have a `status` field) get the interactive tooltip.
              if (pill.status !== undefined) {
                return <McpPill key={idx} pill={pill} toneClass={toneClass} />;
              }
              return (
                <span
                  key={idx}
                  title={pill.title || pill.label}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}
                >
                  {pill.label}
                </span>
              );
            })}
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 rounded-xl border border-border bg-bg-overlay p-2 focus-within:border-accent/70"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled && !isStreaming}
            rows={1}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-red text-white hover:opacity-90"
              title="Stop generating"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send"
            >
              <Send size={16} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
