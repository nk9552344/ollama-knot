"use client";

import { useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/Button";
import { Input } from "@/components/FormElements";
import { ConfirmInline } from "@/components/ConfirmInline";
import { StatusDot } from "@/components/StatusDot";
import { useStore } from "@/store";
import {
  AlertCircle,
  Boxes,
  Download,
  RefreshCw,
  Trash2,
} from "lucide-react";

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function ModelsPage() {
  const {
    models,
    deleteModel,
    fetchModels,
    ollamaHealth,
    checkOllamaHealth,
  } = useStore();

  const [deleting, setDeleting] = useState(null);
  const [pullName, setPullName] = useState("");
  const [pullStatus, setPullStatus] = useState(null); // { status, percent, error }
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const ollamaOnline = ollamaHealth.status === "online";

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchModels(), checkOllamaHealth()]);
    setTimeout(() => setRefreshing(false), 300);
  };

  const handlePull = async () => {
    const name = pullName.trim();
    if (!name || pulling) return;

    setPulling(true);
    setPullStatus({ status: "Starting…", percent: null });

    try {
      const response = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const line = event.replace(/^data:\s?/, "").trim();
          if (!line) continue;
          try {
            const json = JSON.parse(line);
            const percent =
              json.total && json.completed
                ? Math.round((json.completed / json.total) * 100)
                : null;
            setPullStatus({
              status: json.status || "Working…",
              percent,
              error: json.error,
            });
          } catch {
            setPullStatus({ status: line, percent: null });
          }
        }
      }

      setPullStatus({ status: "Done", percent: 100 });
      setPullName("");
      await fetchModels();
    } catch (error) {
      setPullStatus({ status: "Error", error: error.message });
    } finally {
      setPulling(false);
    }
  };

  const handleDelete = async (name) => {
    await deleteModel(name);
    setDeleting(null);
  };

  return (
    <Layout>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-bg-raised px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Models</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
              <StatusDot status={ollamaHealth.status} />
              <span>
                Ollama{" "}
                {ollamaHealth.details?.host && (
                  <span className="font-mono text-text-secondary">
                    {ollamaHealth.details.host}
                  </span>
                )}
                {" — "}
                {ollamaHealth.status === "online" &&
                  `${models.length} models installed`}
                {ollamaHealth.status === "offline" && "unreachable"}
                {ollamaHealth.status === "checking" && "checking…"}
                {ollamaHealth.status === "unknown" && "—"}
              </span>
            </div>
          </div>
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Pull section */}
          <div className="rounded-lg border border-border bg-bg-raised p-4">
            <div className="mb-3 flex items-center gap-2">
              <Download size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-primary">
                Pull a model
              </h2>
            </div>
            <div className="flex gap-2">
              <Input
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !pulling) handlePull();
                }}
                placeholder="e.g. llama3.2:3b"
                disabled={pulling || !ollamaOnline}
                className="flex-1"
              />
              <Button
                variant="primary"
                onClick={handlePull}
                disabled={pulling || !pullName.trim() || !ollamaOnline}
              >
                {pulling ? "Pulling…" : "Pull"}
              </Button>
            </div>

            {!ollamaOnline && (
              <p className="mt-2 text-xs text-status-red">
                Ollama is unreachable. Start the service to pull models.
              </p>
            )}

            {pullStatus && (
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={
                      pullStatus.error
                        ? "text-status-red"
                        : "text-text-secondary"
                    }
                  >
                    {pullStatus.error || pullStatus.status}
                  </span>
                  {pullStatus.percent !== null && (
                    <span className="font-mono text-text-muted">
                      {pullStatus.percent}%
                    </span>
                  )}
                </div>
                {pullStatus.percent !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-overlay">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${pullStatus.percent}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Models list */}
          {!ollamaOnline ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-status-red/30 bg-status-red/5 py-12 text-center">
              <AlertCircle size={28} className="text-status-red" />
              <p className="text-text-primary font-medium">
                Cannot reach Ollama
              </p>
              <p className="max-w-md text-xs text-text-muted">
                {ollamaHealth.details?.error ||
                  "Make sure the Ollama daemon is running and accessible at the configured host."}
              </p>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw
                  size={13}
                  className={refreshing ? "animate-spin" : ""}
                />
                Try again
              </Button>
            </div>
          ) : models.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-bg-raised py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-overlay text-text-muted">
                <Boxes size={22} />
              </div>
              <p className="text-text-primary font-medium">No models yet</p>
              <p className="text-xs text-text-muted">
                Pull one above to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-bg-raised">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Size</th>
                    <th className="px-4 py-2 font-medium">Modified</th>
                    <th className="px-4 py-2 font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <tr
                      key={model.name}
                      className="border-b border-border last:border-b-0 hover:bg-bg-hover"
                    >
                      <td className="px-4 py-3 font-mono text-sm text-text-primary">
                        {model.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {model.sizeFormatted}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {formatDate(model.modifiedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {deleting === model.name ? (
                          <div className="flex justify-end">
                            <ConfirmInline
                              message={`Delete ${model.name}?`}
                              onConfirm={() => handleDelete(model.name)}
                              onCancel={() => setDeleting(null)}
                            />
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleting(model.name)}
                            className="rounded p-1 text-text-muted hover:bg-status-red/10 hover:text-status-red"
                            title="Delete model"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
