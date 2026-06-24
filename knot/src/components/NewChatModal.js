"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Select } from "./FormElements";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";
import { Toggle } from "./Toggle";
import { useStore } from "@/store";
import { v4 as uuidv4 } from "uuid";
import { AlertCircle } from "lucide-react";

export function NewChatModal({ isOpen, onClose }) {
  const {
    models,
    systemPrompts,
    mcpServers,
    mcpHealth,
    ollamaHealth,
    createChat,
  } = useStore();
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [selectedServers, setSelectedServers] = useState([]);
  const [think, setThink] = useState(false);

  const ollamaOnline = ollamaHealth.status === "online";
  const activeServers = mcpServers.filter((s) => s.active);

  // Whenever the modal opens, default to "all active MCP servers selected".
  useEffect(() => {
    if (!isOpen) return;
    setSelectedServers(activeServers.map((s) => s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mcpServers.length]);

  const handleStart = async () => {
    if (!selectedModel) return;

    const newChat = {
      id: uuidv4(),
      title: "New Chat",
      model: selectedModel,
      systemPromptId: selectedPrompt || null,
      mcpServerIds: selectedServers,
      think,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createChat(newChat);
    onClose();
    setSelectedModel("");
    setSelectedPrompt("");
    setSelectedServers([]);
    setThink(false);
  };

  const allSelected =
    activeServers.length > 0 &&
    selectedServers.length === activeServers.length;
  const toggleAll = () => {
    setSelectedServers(
      allSelected ? [] : activeServers.map((s) => s.id),
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New chat">
      <div className="space-y-4">
        {!ollamaOnline && (
          <div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 p-3 text-xs text-status-red">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Ollama is unreachable. Make sure it&apos;s running before starting
              a chat.
            </span>
          </div>
        )}

        {models.length === 0 && ollamaOnline && (
          <div className="rounded-md border border-border bg-bg-overlay p-3 text-xs text-text-secondary">
            No models installed. Visit the <strong>Models</strong> page to pull
            one.
          </div>
        )}

        <Select
          label="Model (required)"
          options={
            models.length === 0
              ? [{ label: "No models available", value: "" }]
              : [
                  { label: "Select a model…", value: "" },
                  ...models.map((m) => ({ label: m.name, value: m.name })),
                ]
          }
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        />

        <Select
          label="System Prompt (optional)"
          options={[
            { label: "None", value: "" },
            ...systemPrompts.map((p) => ({ label: p.name, value: p.id })),
          ]}
          value={selectedPrompt}
          onChange={(e) => setSelectedPrompt(e.target.value)}
        />

        {activeServers.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">
                MCP Servers
              </label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] text-text-secondary hover:text-text-primary"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="space-y-1 rounded-md border border-border bg-bg-overlay p-2">
              {activeServers.map((server) => {
                const status = mcpHealth[server.id]?.status || "unknown";
                return (
                  <label
                    key={server.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    <input
                      type="checkbox"
                      checked={selectedServers.includes(server.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedServers([...selectedServers, server.id]);
                        } else {
                          setSelectedServers(
                            selectedServers.filter((id) => id !== server.id),
                          );
                        }
                      }}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex-1 text-text-primary">
                      {server.name}
                    </span>
                    <StatusDot status={status} />
                  </label>
                );
              })}
            </div>
            <p className="text-[11px] text-text-muted">
              Only the servers you tick here will be exposed to this chat.
            </p>
          </div>
        ) : mcpServers.length > 0 ? (
          <div className="rounded-md border border-border bg-bg-overlay p-3 text-xs text-text-secondary">
            All configured MCP servers are marked inactive. Toggle one active
            on the <strong>MCP Servers</strong> page to use it here.
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg-overlay p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Enable reasoning
            </p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              Off by default. Turn on for reasoning models (qwen3,
              deepseek-r1, gpt-oss, qwq…) to see the model’s thinking. Slower.
            </p>
          </div>
          <Toggle checked={think} onChange={setThink} />
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="primary"
            onClick={handleStart}
            disabled={!selectedModel || !ollamaOnline}
            className="flex-1"
          >
            Start chat
          </Button>
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
