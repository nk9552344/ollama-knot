"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { Select } from "./FormElements";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";
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

  const ollamaOnline = ollamaHealth.status === "online";

  const handleStart = async () => {
    if (!selectedModel) return;

    const newChat = {
      id: uuidv4(),
      title: "New Chat",
      model: selectedModel,
      systemPromptId: selectedPrompt || null,
      mcpServerIds: selectedServers,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createChat(newChat);
    onClose();
    setSelectedModel("");
    setSelectedPrompt("");
    setSelectedServers([]);
  };

  const activeServers = mcpServers.filter((s) => s.active);

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

        {activeServers.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">
              MCP Servers (optional)
            </label>
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
          </div>
        )}

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
