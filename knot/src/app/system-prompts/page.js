"use client";

import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/Button";
import { Input, Textarea } from "@/components/FormElements";
import { Modal } from "@/components/Modal";
import { ConfirmInline } from "@/components/ConfirmInline";
import { useStore } from "@/store";
import { v4 as uuidv4 } from "uuid";
import { Edit2, Plus, Sparkles, Trash2 } from "lucide-react";

const EMPTY_FORM = { name: "", description: "", content: "" };

export default function SystemPromptsPage() {
  const {
    systemPrompts,
    createSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const handleOpenModal = (prompt = null) => {
    if (prompt) {
      setEditingId(prompt.id);
      setFormData({
        name: prompt.name || "",
        description: prompt.description || "",
        content: prompt.content || "",
      });
    } else {
      setEditingId(null);
      setFormData(EMPTY_FORM);
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) return;

    if (editingId) {
      await updateSystemPrompt(editingId, formData);
    } else {
      await createSystemPrompt({
        id: uuidv4(),
        ...formData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    setShowModal(false);
    setFormData(EMPTY_FORM);
    setEditingId(null);
  };

  const handleDelete = async (id) => {
    await deleteSystemPrompt(id);
    setDeleting(null);
  };

  return (
    <Layout>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-bg-raised px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              System Prompts
            </h1>
            <p className="text-xs text-text-muted">
              Reusable instructions injected into chats.
            </p>
          </div>
          <Button variant="primary" onClick={() => handleOpenModal()}>
            <Plus size={16} />
            New Prompt
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {systemPrompts.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-raised text-text-muted">
                <Sparkles size={22} />
              </div>
              <p className="text-text-secondary">
                No system prompts yet.
              </p>
              <p className="text-xs text-text-muted">
                Create one to define how the model should behave.
              </p>
              <Button variant="primary" onClick={() => handleOpenModal()}>
                <Plus size={16} />
                Create your first prompt
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {systemPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className="flex flex-col rounded-lg border border-border bg-bg-raised p-4 transition-colors hover:border-text-muted"
                >
                  <div className="mb-2">
                    <h3 className="font-semibold text-text-primary">
                      {prompt.name}
                    </h3>
                    {prompt.description && (
                      <p className="mt-1 text-xs text-text-muted line-clamp-2">
                        {prompt.description}
                      </p>
                    )}
                  </div>
                  <pre className="mb-3 flex-1 max-h-32 overflow-hidden whitespace-pre-wrap rounded bg-bg-overlay p-3 text-xs text-text-secondary font-mono">
                    {prompt.content.slice(0, 240)}
                    {prompt.content.length > 240 ? "…" : ""}
                  </pre>
                  {prompt.content.includes("${USER_PROMPT}") && (
                    <div className="mb-3 inline-flex w-fit items-center gap-1 rounded bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                      template
                    </div>
                  )}
                  <div className="mt-auto flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenModal(prompt)}
                      className="flex-1"
                    >
                      <Edit2 size={13} />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDeleting(
                          deleting === prompt.id ? null : prompt.id,
                        )
                      }
                      className="flex-1 text-status-red hover:bg-status-red/10"
                    >
                      <Trash2 size={13} />
                      Delete
                    </Button>
                  </div>
                  {deleting === prompt.id && (
                    <div className="mt-2">
                      <ConfirmInline
                        message="Delete this prompt?"
                        onConfirm={() => handleDelete(prompt.id)}
                        onCancel={() => setDeleting(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Edit System Prompt" : "New System Prompt"}
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
            placeholder="e.g. Senior code reviewer"
          />

          <Input
            label="Description (optional)"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder="Short summary"
          />

          <div>
            <Textarea
              label="Content"
              value={formData.content}
              onChange={(e) =>
                setFormData({ ...formData, content: e.target.value })
              }
              placeholder="You are a helpful assistant…"
              rows={10}
              className="font-mono text-sm"
            />
            <p className="mt-1 text-xs text-text-muted">
              Tip: include{" "}
              <code className="rounded bg-bg-overlay px-1 font-mono text-text-secondary">
                ${"{USER_PROMPT}"}
              </code>{" "}
              in the content to inject the user&apos;s message directly into
              this template instead of appending it as a separate turn.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.content.trim()}
              className="flex-1"
            >
              {editingId ? "Update" : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowModal(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
