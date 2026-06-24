"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Bot, Check, Copy, User } from "lucide-react";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={handleCopy}
      className="rounded p-1 text-text-muted opacity-0 transition group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary"
      title={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function ChatMessage({ message }) {
  const isAssistant = message.role === "assistant";

  if (isAssistant) {
    return (
      <div className="group flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Bot size={15} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
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
              {message.content || ""}
            </ReactMarkdown>
          </div>
          {message.content && (
            <div className="mt-1">
              <CopyButton text={message.content} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-end gap-3">
      <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-accent/15 px-3.5 py-2 text-sm text-text-primary">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-active text-text-secondary">
        <User size={15} />
      </div>
    </div>
  );
}
