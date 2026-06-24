"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  Plus,
  Trash2,
  MessageSquare,
  Server,
  Sparkles,
  Boxes,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useStore } from "@/store";
import { StatusDot } from "./StatusDot";
import { ConfirmInline } from "./ConfirmInline";

const NAV_ITEMS = [
  { href: "/", label: "Chat", icon: MessageSquare, match: (p) => p === "/" },
  {
    href: "/mcp-servers",
    label: "MCP Servers",
    icon: Server,
    match: (p) => p.startsWith("/mcp-servers"),
  },
  {
    href: "/system-prompts",
    label: "System Prompts",
    icon: Sparkles,
    match: (p) => p.startsWith("/system-prompts"),
  },
  {
    href: "/models",
    label: "Models",
    icon: Boxes,
    match: (p) => p.startsWith("/models"),
  },
];

export function Sidebar() {
  const {
    chats,
    activeChatId,
    setActiveChatId,
    deleteChat,
    sidebarOpen,
    setSidebarOpen,
    ollamaHealth,
    mcpServers,
    mcpHealth,
    checkOllamaHealth,
    streamingChatId,
  } = useStore();
  const pathname = usePathname() || "/";
  const [deleting, setDeleting] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const isChatPage = pathname === "/";

  const activeMcpCount = mcpServers.filter((s) => s.active).length;
  const onlineMcpCount = mcpServers.filter(
    (s) => s.active && mcpHealth[s.id]?.status === "online",
  ).length;

  const handleDelete = async (id) => {
    await deleteChat(id);
    setDeleting(null);
  };

  const handleRefreshHealth = async () => {
    setRefreshing(true);
    try {
      await checkOllamaHealth();
    } finally {
      setTimeout(() => setRefreshing(false), 300);
    }
  };

  return (
    <>
      {/* Mobile top nav */}
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between border-b border-border bg-bg-raised px-4 py-3 sm:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-text-secondary hover:text-text-primary"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <h1 className="font-semibold text-text-primary">MCP Studio</h1>
        </div>
        <StatusDot
          status={ollamaHealth.status}
          label="Ollama"
          title={`Ollama: ${ollamaHealth.status}${
            ollamaHealth.details?.host ? ` (${ollamaHealth.details.host})` : ""
          }`}
        />
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 bottom-0 z-30 w-64 border-r border-border bg-bg-raised flex flex-col transition-transform duration-200 sm:relative sm:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/15 text-accent">
              <Boxes size={16} />
            </div>
            <h1 className="text-base font-semibold text-text-primary tracking-tight">
              MCP Studio
            </h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`group flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-bg-active text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon
                    size={16}
                    className={isActive ? "text-accent" : "text-text-muted"}
                  />
                  {item.label}
                </span>
                {item.href === "/mcp-servers" && activeMcpCount > 0 && (
                  <span
                    className="rounded-full bg-bg-active px-1.5 text-[10px] text-text-secondary"
                    title={`${onlineMcpCount}/${activeMcpCount} reachable`}
                  >
                    {onlineMcpCount}/{activeMcpCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Chats section */}
        <div className="flex-1 flex flex-col border-t border-border min-h-0">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Chats
            </h2>
            <Link
              href="/?new=true"
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              title="New chat"
            >
              <Plus size={14} />
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {chats.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-text-muted">
                No chats yet. Start a new one.
              </p>
            ) : (
              <div className="space-y-0.5">
                {chats.map((chat) => {
                  const isActive = isChatPage && activeChatId === chat.id;
                  const isStreamingHere = streamingChatId === chat.id;
                  return (
                    <div key={chat.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm transition-colors cursor-pointer ${
                          isActive
                            ? "bg-bg-active text-text-primary"
                            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        }`}
                        onClick={() => {
                          setActiveChatId(chat.id);
                          setSidebarOpen(false);
                        }}
                      >
                        {isStreamingHere && (
                          <Loader2
                            size={12}
                            className="shrink-0 animate-spin text-accent"
                          />
                        )}
                        <span className="flex-1 truncate">{chat.title}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleting(
                              deleting === chat.id ? null : chat.id,
                            );
                          }}
                          className={`rounded p-1 text-text-muted hover:text-status-red ${
                            isActive
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          } transition-opacity`}
                          title="Delete chat"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      {deleting === chat.id && (
                        <div className="px-2 py-1">
                          <ConfirmInline
                            message="Delete chat?"
                            onConfirm={() => handleDelete(chat.id)}
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

        {/* Footer — status */}
        <div className="border-t border-border px-3 py-3 space-y-2">
          <div className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-bg-hover">
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <StatusDot status={ollamaHealth.status} />
              <span className="font-medium text-text-primary">Ollama</span>
              <span className="text-text-muted">
                {ollamaHealth.status === "online" &&
                  ollamaHealth.details?.modelCount !== undefined &&
                  `${ollamaHealth.details.modelCount} models`}
                {ollamaHealth.status === "offline" && "Unreachable"}
                {ollamaHealth.status === "checking" && "Checking…"}
                {ollamaHealth.status === "unknown" && "—"}
              </span>
            </span>
            <button
              onClick={handleRefreshHealth}
              className="rounded p-1 text-text-muted hover:text-text-primary"
              title="Re-check Ollama"
              disabled={refreshing}
            >
              <RefreshCw
                size={12}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
          {activeMcpCount > 0 && (
            <div className="flex items-center gap-2 px-2 text-[11px] text-text-muted">
              <StatusDot
                status={
                  onlineMcpCount === activeMcpCount
                    ? "online"
                    : onlineMcpCount === 0
                      ? "offline"
                      : "checking"
                }
              />
              <span>
                MCP: {onlineMcpCount}/{activeMcpCount} reachable
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </>
  );
}
