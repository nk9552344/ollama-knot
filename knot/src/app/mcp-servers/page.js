"use client";

import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/Button";
import { Toggle } from "@/components/Toggle";
import { StatusDot } from "@/components/StatusDot";
import { ConfirmInline } from "@/components/ConfirmInline";
import { MCPServerForm } from "@/components/MCPServerForm";
import { useStore } from "@/store";
import { runOauthPopupFlow } from "@/lib/oauthClient";
import { v4 as uuidv4 } from "uuid";
import {
  Edit2,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";

function authBadge(server, healthDetails) {
  const auth = server.auth || { type: "none" };
  const summary = healthDetails?.auth;

  if (auth.type === "none") {
    return { label: "No auth", tone: "muted", icon: null };
  }
  if (auth.type === "bearer") {
    return {
      label: auth.token ? "Bearer token set" : "Bearer token missing",
      tone: auth.token ? "ok" : "warn",
      icon: KeyRound,
    };
  }
  if (auth.type === "header") {
    const configured = auth.name && auth.value;
    return {
      label: configured
        ? `Header: ${auth.name}`
        : "Header not configured",
      tone: configured ? "ok" : "warn",
      icon: KeyRound,
    };
  }
  if (auth.type === "oauth") {
    const hasConfig = Boolean(
      auth.authorizationUrl && auth.tokenUrl && auth.clientId,
    );
    if (!hasConfig) {
      return {
        label: "OAuth: incomplete config",
        tone: "warn",
        icon: Lock,
      };
    }
    if (!auth.accessToken) {
      return { label: "OAuth: not authenticated", tone: "warn", icon: Lock };
    }
    if (summary?.expired) {
      return { label: "OAuth: token expired", tone: "warn", icon: Lock };
    }
    return {
      label: "OAuth: authenticated",
      tone: "ok",
      icon: ShieldCheck,
    };
  }
  return { label: auth.type, tone: "muted", icon: null };
}

export default function MCPServersPage() {
  const {
    mcpServers,
    mcpHealth,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
    checkMcpServerHealth,
    checkAllMcpServerHealth,
    refreshMcpServerById,
    clearMcpOauthTokens,
    refreshMcpOauthToken,
  } = useStore();

  const [showModal, setShowModal] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authBusyId, setAuthBusyId] = useState(null);
  const [authError, setAuthError] = useState({}); // { [id]: string }

  const handleOpenModal = (server = null) => {
    setEditingServer(server);
    setShowModal(true);
  };

  const handleSave = async (payload) => {
    if (editingServer) {
      await updateMcpServer(editingServer.id, payload);
    } else {
      await createMcpServer({
        id: uuidv4(),
        ...payload,
        createdAt: new Date().toISOString(),
      });
    }
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

  const handleAuthenticate = async (server) => {
    setAuthError((prev) => ({ ...prev, [server.id]: null }));
    setAuthBusyId(server.id);
    try {
      await runOauthPopupFlow({ server });
      await refreshMcpServerById(server.id);
      await checkMcpServerHealth(server.id);
    } catch (e) {
      setAuthError((prev) => ({ ...prev, [server.id]: e.message }));
    } finally {
      setAuthBusyId(null);
    }
  };

  const handleDisconnect = async (server) => {
    setAuthBusyId(server.id);
    try {
      await clearMcpOauthTokens(server.id);
    } catch (e) {
      setAuthError((prev) => ({ ...prev, [server.id]: e.message }));
    } finally {
      setAuthBusyId(null);
    }
  };

  const handleManualRefresh = async (server) => {
    setAuthBusyId(server.id);
    setAuthError((prev) => ({ ...prev, [server.id]: null }));
    try {
      await refreshMcpOauthToken(server.id);
    } catch (e) {
      setAuthError((prev) => ({ ...prev, [server.id]: e.message }));
    } finally {
      setAuthBusyId(null);
    }
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

                    {/* Auth row */}
                    {(() => {
                      const badge = authBadge(server, health?.details);
                      const Icon = badge.icon;
                      const toneClass =
                        badge.tone === "ok"
                          ? "text-status-green"
                          : badge.tone === "warn"
                            ? "text-accent"
                            : "text-text-muted";
                      const isOauth = server.auth?.type === "oauth";
                      const hasOauthConfig =
                        isOauth &&
                        server.auth?.authorizationUrl &&
                        server.auth?.tokenUrl &&
                        server.auth?.clientId;
                      const hasToken = isOauth && server.auth?.accessToken;
                      const canRefreshToken =
                        isOauth && server.auth?.refreshToken;
                      const busy = authBusyId === server.id;

                      return (
                        <div className="mb-2 space-y-1 rounded border border-border bg-bg-overlay p-2">
                          <div
                            className={`flex items-center gap-1.5 text-[11px] ${toneClass}`}
                          >
                            {Icon ? <Icon size={12} /> : null}
                            <span>{badge.label}</span>
                          </div>
                          {health?.details?.authRequired && (
                            <p className="text-[11px] text-status-red">
                              Server returned 401 — credentials are wrong or
                              missing.
                            </p>
                          )}
                          {authError[server.id] && (
                            <p className="text-[11px] text-status-red">
                              {authError[server.id]}
                            </p>
                          )}
                          {isOauth && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {!hasToken && hasOauthConfig && (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleAuthenticate(server)}
                                  disabled={busy}
                                >
                                  <Lock size={12} />
                                  {busy ? "Opening…" : "Authenticate"}
                                </Button>
                              )}
                              {hasToken && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAuthenticate(server)}
                                    disabled={busy}
                                    title="Run the OAuth flow again"
                                  >
                                    <RefreshCw
                                      size={12}
                                      className={busy ? "animate-spin" : ""}
                                    />
                                    Re-auth
                                  </Button>
                                  {canRefreshToken && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleManualRefresh(server)}
                                      disabled={busy}
                                      title="Use refresh_token to get a new access_token"
                                    >
                                      Refresh token
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDisconnect(server)}
                                    disabled={busy}
                                    className="text-status-red hover:bg-status-red/10"
                                  >
                                    <LogOut size={12} />
                                    Disconnect
                                  </Button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

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

      <MCPServerForm
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        initial={editingServer}
        onSave={handleSave}
      />
    </Layout>
  );
}
