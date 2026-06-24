"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Select } from "./FormElements";
import { Button } from "./Button";
import { StatusDot } from "./StatusDot";
import { useStore } from "@/store";

/**
 * Lets the user change the system prompt and MCP-server selection for an
 * existing chat. The model is immutable (chosen at chat creation).
 */
export function ChatSettingsModal({ chat, isOpen, onClose }) {
  const systemPrompts = useStore((s) => s.systemPrompts);
  const mcpServers = useStore((s) => s.mcpServers);
  const mcpHealth = useStore((s) => s.mcpHealth);
  const updateChat = useStore((s) => s.updateChat);

  const [systemPromptId, setSystemPromptId] = useState("");
  const [selectedServers, setSelectedServers] = useState([]);
  const [saving, setSaving] = useState(false);

  const activeServers = mcpServers.filter((s) => s.active);

  useEffect(() => {
    if (!isOpen || !chat) return;
    setSystemPromptId(chat.systemPromptId || "");
    setSelectedServers(chat.mcpServerIds || []);
  }, [isOpen, chat]);

  if (!chat) return null;

  const allSelected =
    activeServers.length > 0 &&
    activeServers.every((s) => selectedServers.includes(s.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelectedServers(
        selectedServers.filter(
          (id) => !activeServers.some((s) => s.id === id),
        ),
      );
    } else {
      const next = new Set(selectedServers);
      activeServers.forEach((s) => next.add(s.id));
      setSelectedServers(Array.from(next));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateChat(chat.id, {
        systemPromptId: systemPromptId || null,
        mcpServerIds: selectedServers,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Chat settings">
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-bg-overlay px-3 py-2 text-xs">
          <span className="text-text-muted">Model: </span>
          <span className="font-mono text-text-primary">{chat.model}</span>
          <span className="ml-2 text-text-muted">
            (set at chat creation)
          </span>
        </div>

        <Select
          label="System Prompt"
          options={[
            { label: "None", value: "" },
            ...systemPrompts.map((p) => ({ label: p.name, value: p.id })),
          ]}
          value={systemPromptId}
          onChange={(e) => setSystemPromptId(e.target.value)}
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
          </div>
        ) : mcpServers.length > 0 ? (
          <div className="rounded-md border border-border bg-bg-overlay p-3 text-xs text-text-secondary">
            All MCP servers are inactive. Toggle one on from the MCP Servers
            page to use it here.
          </div>
        ) : null}

        <div className="flex gap-2 pt-2">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
            className="flex-1"
          >
            Save
          </Button>
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
