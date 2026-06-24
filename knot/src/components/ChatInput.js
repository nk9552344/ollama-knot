"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { StatusDot } from "./StatusDot";

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
              return (
                <span
                  key={idx}
                  title={pill.title || pill.label}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    tones[pill.tone || "default"]
                  }`}
                >
                  {pill.status && <StatusDot status={pill.status} />}
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
