"use client";

import { create } from "zustand";

const HEALTH_INITIAL = { status: "unknown", checkedAt: null, details: null };

export const useStore = create((set, get) => ({
  // Chat state
  chats: [],
  activeChatId: null,
  isStreaming: false,
  streamAbortController: null,

  // Data state
  mcpServers: [],
  systemPrompts: [],
  models: [],

  // Health state
  ollamaHealth: HEALTH_INITIAL, // { status: 'online'|'offline'|'checking'|'unknown', checkedAt, details }
  mcpHealth: {}, // { [serverId]: { status, checkedAt, details } }

  // UI state
  sidebarOpen: true,

  // Chat actions
  fetchChats: async () => {
    try {
      const res = await fetch("/api/chats");
      const data = await res.json();
      set({ chats: data.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) });
    } catch (error) {
      console.error("Error fetching chats:", error);
    }
  },

  createChat: async (chat) => {
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chat),
      });
      const newChat = await res.json();
      const chats = [newChat, ...get().chats];
      set({ chats, activeChatId: newChat.id });
      return newChat;
    } catch (error) {
      console.error("Error creating chat:", error);
    }
  },

  updateChat: async (id, updates) => {
    try {
      const res = await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updated = await res.json();
      const chats = get().chats.map((c) => (c.id === id ? updated : c));
      set({ chats });
      return updated;
    } catch (error) {
      console.error("Error updating chat:", error);
    }
  },

  deleteChat: async (id) => {
    try {
      await fetch(`/api/chats/${id}`, { method: "DELETE" });
      const chats = get().chats.filter((c) => c.id !== id);
      set({
        chats,
        activeChatId: get().activeChatId === id ? null : get().activeChatId,
      });
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  },

  appendMessage: async (chatId, message) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;

    const messages = [...chat.messages, message];

    // Auto-title on first user message
    let title = chat.title;
    if (chat.title === "New Chat" && message.role === "user") {
      title = message.content.slice(0, 50);
    }

    const updated = {
      ...chat,
      messages,
      title,
      updatedAt: new Date().toISOString(),
    };

    const chats = get().chats.map((c) => (c.id === chatId ? updated : c));
    set({ chats });

    // Persist to API
    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
    } catch (error) {
      console.error("Error persisting message:", error);
    }
  },

  updateLastAssistantMessage: (chatId, content) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;

    const messages = [...chat.messages];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant") {
      lastMsg.content =
        typeof content === "function" ? content(lastMsg.content) : content;
    } else {
      const nextContent =
        typeof content === "function" ? content("") : content;
      messages.push({ role: "assistant", content: nextContent });
    }

    const updated = {
      ...chat,
      messages,
      updatedAt: new Date().toISOString(),
    };

    const chats = get().chats.map((c) => (c.id === chatId ? updated : c));
    set({ chats });
  },

  persistMessages: async (chatId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;

    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chat),
      });
    } catch (error) {
      console.error("Error persisting messages:", error);
    }
  },

  setStreamAbortController: (controller) =>
    set({ streamAbortController: controller }),

  cancelStreaming: () => {
    const controller = get().streamAbortController;
    if (controller) {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    }
    set({ isStreaming: false, streamAbortController: null });
  },

  // MCP Server actions
  fetchMcpServers: async () => {
    try {
      const res = await fetch("/api/mcp-servers");
      const data = await res.json();
      set({ mcpServers: data });
    } catch (error) {
      console.error("Error fetching MCP servers:", error);
    }
  },

  createMcpServer: async (server) => {
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(server),
      });
      const newServer = await res.json();
      set({ mcpServers: [...get().mcpServers, newServer] });
      return newServer;
    } catch (error) {
      console.error("Error creating MCP server:", error);
    }
  },

  updateMcpServer: async (id, updates) => {
    try {
      const res = await fetch(`/api/mcp-servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updated = await res.json();
      const mcpServers = get().mcpServers.map((s) =>
        s.id === id ? updated : s
      );
      set({ mcpServers });
      return updated;
    } catch (error) {
      console.error("Error updating MCP server:", error);
    }
  },

  deleteMcpServer: async (id) => {
    try {
      await fetch(`/api/mcp-servers/${id}`, { method: "DELETE" });
      const mcpServers = get().mcpServers.filter((s) => s.id !== id);
      const mcpHealth = { ...get().mcpHealth };
      delete mcpHealth[id];
      set({ mcpServers, mcpHealth });
    } catch (error) {
      console.error("Error deleting MCP server:", error);
    }
  },

  // System Prompt actions
  fetchSystemPrompts: async () => {
    try {
      const res = await fetch("/api/system-prompts");
      const data = await res.json();
      set({ systemPrompts: data });
    } catch (error) {
      console.error("Error fetching system prompts:", error);
    }
  },

  createSystemPrompt: async (prompt) => {
    try {
      const res = await fetch("/api/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt),
      });
      const newPrompt = await res.json();
      set({ systemPrompts: [...get().systemPrompts, newPrompt] });
      return newPrompt;
    } catch (error) {
      console.error("Error creating system prompt:", error);
    }
  },

  updateSystemPrompt: async (id, updates) => {
    try {
      const res = await fetch(`/api/system-prompts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updated = await res.json();
      const systemPrompts = get().systemPrompts.map((p) =>
        p.id === id ? updated : p
      );
      set({ systemPrompts });
      return updated;
    } catch (error) {
      console.error("Error updating system prompt:", error);
    }
  },

  deleteSystemPrompt: async (id) => {
    try {
      await fetch(`/api/system-prompts/${id}`, { method: "DELETE" });
      const systemPrompts = get().systemPrompts.filter((p) => p.id !== id);
      set({ systemPrompts });
    } catch (error) {
      console.error("Error deleting system prompt:", error);
    }
  },

  // Models actions
  fetchModels: async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) {
        set({ models: [] });
        return;
      }
      const data = await res.json();
      set({ models: Array.isArray(data) ? data : [] });
    } catch (error) {
      console.error("Error fetching models:", error);
      set({ models: [] });
    }
  },

  deleteModel: async (name) => {
    try {
      await fetch("/api/models", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const models = get().models.filter((m) => m.name !== name);
      set({ models });
    } catch (error) {
      console.error("Error deleting model:", error);
    }
  },

  // Health actions
  checkOllamaHealth: async () => {
    const prev = get().ollamaHealth;
    set({ ollamaHealth: { ...prev, status: "checking" } });
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const data = await res.json();
      set({
        ollamaHealth: {
          status: data.online ? "online" : "offline",
          checkedAt: new Date().toISOString(),
          details: data,
        },
      });
      if (data.online && get().models.length === 0) {
        get().fetchModels();
      }
    } catch (error) {
      set({
        ollamaHealth: {
          status: "offline",
          checkedAt: new Date().toISOString(),
          details: { error: error.message },
        },
      });
    }
  },

  checkMcpServerHealth: async (id) => {
    const current = get().mcpHealth[id] || {};
    set({
      mcpHealth: {
        ...get().mcpHealth,
        [id]: { ...current, status: "checking" },
      },
    });
    try {
      const res = await fetch(`/api/mcp-servers/${id}/health`, {
        cache: "no-store",
      });
      const data = await res.json();
      const status = data.reachable
        ? "online"
        : data.disabled
          ? "disabled"
          : "offline";
      set({
        mcpHealth: {
          ...get().mcpHealth,
          [id]: {
            status,
            checkedAt: new Date().toISOString(),
            details: data,
          },
        },
      });
    } catch (error) {
      set({
        mcpHealth: {
          ...get().mcpHealth,
          [id]: {
            status: "offline",
            checkedAt: new Date().toISOString(),
            details: { error: error.message },
          },
        },
      });
    }
  },

  checkAllMcpServerHealth: async () => {
    const servers = get().mcpServers;
    await Promise.all(servers.map((s) => get().checkMcpServerHealth(s.id)));
  },

  // UI actions
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setActiveChatId: (activeChatId) => set({ activeChatId }),
}));
