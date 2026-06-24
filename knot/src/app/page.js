"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Layout } from "@/components/Layout";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { NewChatModal } from "@/components/NewChatModal";
import { ThinkingDots } from "@/components/ThinkingDots";
import { Button } from "@/components/Button";
import { StatusDot } from "@/components/StatusDot";
import { useStore } from "@/store";
import { streamChat } from "@/lib/ollama";
import { AlertCircle, MessageSquarePlus, Sparkles } from "lucide-react";

function ChatPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const isNewChat = searchParams.get("new") === "true";

  const chats = useStore((s) => s.chats);
  const activeChatId = useStore((s) => s.activeChatId);
  const isStreaming = useStore((s) => s.isStreaming);
  const setIsStreaming = useStore((s) => s.setIsStreaming);
  const systemPrompts = useStore((s) => s.systemPrompts);
  const mcpServers = useStore((s) => s.mcpServers);
  const mcpHealth = useStore((s) => s.mcpHealth);
  const ollamaHealth = useStore((s) => s.ollamaHealth);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateLastAssistantMessage = useStore(
    (s) => s.updateLastAssistantMessage,
  );
  const persistMessages = useStore((s) => s.persistMessages);
  const setStreamAbortController = useStore((s) => s.setStreamAbortController);
  const cancelStreaming = useStore((s) => s.cancelStreaming);

  const [showNewChatModal, setShowNewChatModal] = useState(isNewChat);
  const [showThinking, setShowThinking] = useState(false);
  const messagesEndRef = useRef(null);

  const activeChat = chats.find((c) => c.id === activeChatId);

  useEffect(() => {
    if (isNewChat) {
      setShowNewChatModal(true);
    }
  }, [isNewChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages?.length, showThinking]);

  const closeNewChatModal = () => {
    setShowNewChatModal(false);
    if (isNewChat) {
      router.replace("/");
    }
  };

  const handleSendMessage = async (content) => {
    if (!activeChat || isStreaming) return;

    await appendMessage(activeChatId, { role: "user", content });

    setIsStreaming(true);
    setShowThinking(true);

    let systemPromptContent = null;
    if (activeChat.systemPromptId) {
      const prompt = systemPrompts.find(
        (p) => p.id === activeChat.systemPromptId,
      );
      systemPromptContent = prompt?.content;
    }

    const updatedChat = useStore
      .getState()
      .chats.find((c) => c.id === activeChatId);
    const messages = updatedChat.messages;

    const abortController = new AbortController();
    setStreamAbortController(abortController);

    try {
      await streamChat({
        model: activeChat.model,
        messages,
        systemPromptContent,
        signal: abortController.signal,
        onChunk: (token) => {
          setShowThinking(false);
          updateLastAssistantMessage(activeChatId, (prev) => (prev || "") + token);
        },
        onDone: async () => {
          setShowThinking(false);
          setIsStreaming(false);
          setStreamAbortController(null);
          await persistMessages(activeChatId);
        },
        onError: async (error) => {
          console.error("Chat error:", error);
          setShowThinking(false);
          setIsStreaming(false);
          setStreamAbortController(null);
          const message =
            error?.name === "AbortError"
              ? "\n\n_⏹ Stopped by user._"
              : `\n\n_⚠ ${error?.message || "Stream failed"}_`;
          updateLastAssistantMessage(activeChatId, (prev) => (prev || "") + message);
          await persistMessages(activeChatId);
        },
      });
    } catch (error) {
      console.error("Error:", error);
      setShowThinking(false);
      setIsStreaming(false);
      setStreamAbortController(null);
    }
  };

  const handleCancel = () => {
    cancelStreaming();
    setShowThinking(false);
  };

  const buildPills = () => {
    if (!activeChat) return [];
    const pills = [{ label: activeChat.model, tone: "accent" }];
    if (activeChat.systemPromptId) {
      const sp = systemPrompts.find(
        (p) => p.id === activeChat.systemPromptId,
      );
      if (sp) pills.push({ label: sp.name, tone: "default" });
    }
    for (const id of activeChat.mcpServerIds || []) {
      const server = mcpServers.find((s) => s.id === id);
      if (!server) continue;
      const health = mcpHealth[id];
      const status = !server.active
        ? "disabled"
        : health?.status || "unknown";
      pills.push({
        label: server.name,
        status,
        title: `MCP ${server.name}: ${status}`,
      });
    }
    return pills;
  };

  const ollamaOffline = ollamaHealth.status === "offline";

  if (!activeChat) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          {ollamaOffline ? (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-status-red/10 text-status-red">
                <AlertCircle size={24} />
              </div>
              <h2 className="text-lg font-semibold text-text-primary">
                Ollama is unreachable
              </h2>
              <p className="max-w-md text-sm text-text-muted">
                {ollamaHealth.details?.error ||
                  "Start the Ollama service to begin chatting."}
              </p>
              <Button
                variant="outline"
                onClick={() => useStore.getState().checkOllamaHealth()}
              >
                Try again
              </Button>
            </>
          ) : (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-raised text-text-muted">
                <Sparkles size={24} />
              </div>
              <h2 className="text-lg font-semibold text-text-primary">
                Welcome to MCP Studio
              </h2>
              <p className="max-w-md text-sm text-text-muted">
                Start a new chat to talk to a local Ollama model.
              </p>
              <Button
                variant="primary"
                onClick={() => setShowNewChatModal(true)}
              >
                <MessageSquarePlus size={16} />
                New chat
              </Button>
              <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                <StatusDot status={ollamaHealth.status} />
                <span>
                  Ollama{" "}
                  {ollamaHealth.status === "online" &&
                    `online · ${ollamaHealth.details?.modelCount ?? 0} models`}
                  {ollamaHealth.status === "checking" && "checking…"}
                  {ollamaHealth.status === "unknown" && "—"}
                </span>
              </div>
            </>
          )}
        </div>
        <NewChatModal isOpen={showNewChatModal} onClose={closeNewChatModal} />
      </>
    );
  }

  const pills = buildPills();

  return (
    <>
      {/* Chat header */}
      <div className="border-b border-border bg-bg-raised px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <h2 className="truncate text-sm font-medium text-text-primary">
            {activeChat.title}
          </h2>
          <div
            className="shrink-0"
            title={
              isStreaming
                ? "Wait for response to finish"
                : "Start a new chat"
            }
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={isStreaming}
              onClick={() => setShowNewChatModal(true)}
            >
              <MessageSquarePlus size={14} />
              New chat
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {activeChat.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-text-secondary">
                Start the conversation…
              </p>
              <p className="text-xs text-text-muted">
                You are talking to{" "}
                <span className="font-mono text-text-secondary">
                  {activeChat.model}
                </span>
              </p>
            </div>
          ) : (
            <>
              {activeChat.messages.map((msg, idx) => (
                <ChatMessage key={idx} message={msg} />
              ))}
              {showThinking && (
                <div className="flex items-center gap-3 pl-10">
                  <ThinkingDots />
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSendMessage}
        onCancel={handleCancel}
        disabled={isStreaming}
        isStreaming={isStreaming}
        pills={pills}
      />

      <NewChatModal isOpen={showNewChatModal} onClose={closeNewChatModal} />
    </>
  );
}

export default function ChatPage() {
  return (
    <Layout>
      <Suspense fallback={null}>
        <ChatPageInner />
      </Suspense>
    </Layout>
  );
}
