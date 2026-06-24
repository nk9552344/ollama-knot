"use client";

import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { useStore } from "@/store";

export function Layout({ children }) {
  const fetchChats = useStore((s) => s.fetchChats);
  const fetchMcpServers = useStore((s) => s.fetchMcpServers);
  const fetchSystemPrompts = useStore((s) => s.fetchSystemPrompts);
  const fetchModels = useStore((s) => s.fetchModels);
  const checkOllamaHealth = useStore((s) => s.checkOllamaHealth);
  const checkAllMcpServerHealth = useStore((s) => s.checkAllMcpServerHealth);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const mcpServerCount = useStore((s) => s.mcpServers.length);

  useEffect(() => {
    // Initialize data on mount
    fetchChats();
    fetchMcpServers();
    fetchSystemPrompts();
    fetchModels();
    checkOllamaHealth();

    // Default to collapsed sidebar on small screens.
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      setSidebarOpen(false);
    }

    // Poll Ollama health every 15 seconds.
    const ollamaInterval = setInterval(() => {
      checkOllamaHealth();
    }, 15_000);

    return () => clearInterval(ollamaInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check MCP server health whenever the server list changes.
  useEffect(() => {
    if (mcpServerCount === 0) return;
    checkAllMcpServerHealth();
    const interval = setInterval(() => {
      checkAllMcpServerHealth();
    }, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpServerCount]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top nav spacer */}
        <div className="h-14 shrink-0 sm:hidden" />
        {children}
      </main>
    </div>
  );
}
