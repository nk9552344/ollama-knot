"use client";

import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/Button";
import { Input, Textarea, Select } from "@/components/FormElements";
import { Toggle } from "@/components/Toggle";
import { StatusDot } from "@/components/StatusDot";
import { Modal } from "@/components/Modal";
import { ConfirmInline } from "@/components/ConfirmInline";
import { useStore } from "@/store";
import { v4 as uuidv4 } from "uuid";
import {
  Edit2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

export default function MCPServersPage() {
  const {
    mcpServers,
    mcpHealth,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
    checkMcpServerHealth,
    checkAllMcpServerHealth,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    type: "http",
    url: "",
    command: "",
    args: [],
    env: {},
    description: "",
    active: true,
  });

  const [envInput, setEnvInput] = useState("");

  const handleOpenModal = (server = null) => {
    if (server) {
      setEditingId(server.id);
      setFormData(server);
      setEnvInput(
        Object.entries(server.env || {})
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      );
    } else {
      setEditingId(null);
      setFormData({
        name: "",
        type: "http",
        url: "",
        command: "",
        args: [],
        env: {},
        description: "",
        active: true,
      });
      setEnvInput("");
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name) return;

    const envObj = {};
    envInput.split("\n").forEach((line) => {
      const [k, v] = line.split("=");
      if (k && v) envObj[k.trim()] = v.trim();
    });

    const data = {
      ...formData,
      env: envObj,
      args: formData.args.filter((a) => a),
    };

    if (editingId) {
      await updateMcpServer(editingId, data);
    } else {
      await createMcpServer({
        id: uuidv4(),
        ...data,
        createdAt: new Date().toISOString(),
      });
    }

    setShowModal(false);
  };

  const handleDelete = async (id) => {
    await deleteMcpServer(id);
    setDeleting(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await checkAllMcpServerHealth();
    setTimeout(() => setRefreshing(false), 300);
  };

  const handleToggleActive = async (server) => {
    await updateMcpServer(server.id, { active: !server.active });
    checkMcpServerHealth(server.id);
  };

  const activeCount = mcpServers.filter((s) => s.active).length;
  const onlineCount = mcpServers.filter(
    (s) => s.active && mcpHealth[s.id]?.status === "online",
  ).length;

  return (
    <Layout>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-bg-raised px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              MCP Servers
            </h1>
            {mcpServers.length > 0 && (
              <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                <StatusDot
                  status={
                    activeCount === 0
                      ? "unknown"
                      : onlineCount === activeCount
                        ? "online"
                        : onlineCount === 0
                          ? "offline"
                          : "checking"
                  }
                />
                <span>
                  {onlineCount}/{activeCount} reachable
                  {mcpServers.length - activeCount > 0 &&
                    ` · ${mcpServers.length - activeCount} inactive`}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCw
                size={14}
                className={refreshing ? "animate-spin" : ""}
              />
              Re-check
            </Button>
            <Button variant="primary" onClick={() => handleOpenModal()}>
              <Plus size={16} />
              Add Server
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {mcpServers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-raised text-text-muted">
                <Server size={22} />
              </div>
              <p className="text-text-secondary">
                No MCP servers yet.
              </p>
              <p className="text-xs text-text-muted">
                Add one to expose its tools to your chats.
              </p>
              <Button variant="primary" onClick={() => handleOpenModal()}>
                <Plus size={16} />
                Add your first server
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {mcpServers.map((server) => {
                const health = mcpHealth[server.id];
                const healthStatus = !server.active
                  ? "disabled"
                  : health?.status || "unknown";
                const latency = health?.details?.latencyMs;
                const errorMessage = health?.details?.error;

                return (
                  <div
                    key={server.id}
                    className="flex flex-col rounded-lg border border-border bg-bg-raised p-4 transition-colors hover:border-text-muted"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-semibold text-text-primary">
                            {server.name}
                          </h3>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-bg-active px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                            {server.type}
                          </span>
                          <StatusDot
                            status={healthStatus}
                            label={
                              server.name +
                              (latency !== undefined ? ` · ${latency}ms` : "")
                            }
                            showLabel
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => checkMcpServerHealth(server.id)}
                        className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary"
                        title="Re-check this server"
                      >
                        <RefreshCw
                          size={13}
                          className={
                            health?.status === "checking"
                              ? "animate-spin"
                              : ""
                          }
                        />
                      </button>
                    </div>

                    {server.description && (
                      <p className="mb-2 text-sm text-text-muted line-clamp-2">
                        {server.description}
                      </p>
                    )}

                    {server.type === "http" && server.url && (
                      <p className="mb-2 break-all font-mono text-xs text-text-secondary">
                        {server.url}
                      </p>
                    )}

                    {server.type === "stdio" && server.command && (
                      <div className="mb-2 text-xs text-text-secondary">
                        <p className="font-mono">
                          {server.command}
                          {server.args?.length > 0
                            ? " " + server.args.join(" ")
                            : ""}
                        </p>
                      </div>
                    )}

                    {server.active && errorMessage && (
                      <p className="mb-2 text-xs text-status-red">
                        {errorMessage}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <Toggle
                        checked={server.active}
                        onChange={() => handleToggleActive(server)}
                        label={server.active ? "Active" : "Inactive"}
                      />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenModal(server)}
                        >
                          <Edit2 size={13} />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDeleting(
                              deleting === server.id ? null : server.id,
                            )
                          }
                          className="text-status-red hover:bg-status-red/10"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>

                    {deleting === server.id && (
                      <div className="mt-2">
                        <ConfirmInline
                          message="Delete this server?"
                          onConfirm={() => handleDelete(server.id)}
                          onCancel={() => setDeleting(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingId ? "Edit MCP Server" : "Add MCP Server"}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
            placeholder="e.g. GitHub API"
          />

          <Select
            label="Type"
            value={formData.type}
            onChange={(e) =>
              setFormData({ ...formData, type: e.target.value })
            }
            options={[
              { label: "HTTP", value: "http" },
              { label: "STDIO", value: "stdio" },
            ]}
          />

          {formData.type === "http" && (
            <Input
              label="URL"
              value={formData.url}
              onChange={(e) =>
                setFormData({ ...formData, url: e.target.value })
              }
              placeholder="http://localhost:3000"
            />
          )}

          {formData.type === "stdio" && (
            <>
              <Input
                label="Command"
                value={formData.command}
                onChange={(e) =>
                  setFormData({ ...formData, command: e.target.value })
                }
                placeholder="node"
              />

              <Textarea
                label="Environment Variables"
                value={envInput}
                onChange={(e) => setEnvInput(e.target.value)}
                placeholder="KEY=VALUE&#10;KEY2=VALUE2"
                rows={4}
              />
            </>
          )}

          <Textarea
            label="Description"
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            placeholder="Optional description"
            rows={2}
          />

          <div>
            <Toggle
              checked={formData.active}
              onChange={(active) =>
                setFormData({ ...formData, active })
              }
              label="Active"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!formData.name}
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
