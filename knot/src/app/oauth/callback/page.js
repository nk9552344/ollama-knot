"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function CallbackInner() {
  const search = useSearchParams();
  const [phase, setPhase] = useState("posting"); // posting | done | error
  const [message, setMessage] = useState("Finishing sign in…");

  useEffect(() => {
    const code = search.get("code");
    const state = search.get("state");
    const error = search.get("error");
    const errorDescription = search.get("error_description");

    if (!window.opener) {
      setPhase("error");
      setMessage(
        "This window was opened directly. Authentication windows must be launched from MCP Studio.",
      );
      return;
    }

    try {
      window.opener.postMessage(
        {
          type: "mcp-oauth-callback",
          code,
          state,
          error,
          errorDescription,
        },
        window.location.origin,
      );
      setPhase(error ? "error" : "done");
      setMessage(
        error
          ? `Authentication failed: ${errorDescription || error}`
          : "Authentication complete. You can close this window.",
      );
    } catch (e) {
      setPhase("error");
      setMessage(`Could not post message to opener: ${e.message}`);
      return;
    }

    const t = setTimeout(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    }, 800);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full ${
          phase === "error"
            ? "bg-status-red/10 text-status-red"
            : "bg-accent/15 text-accent"
        }`}
      >
        <span className="text-xl">{phase === "error" ? "!" : "✓"}</span>
      </div>
      <p className="text-sm text-text-primary">{message}</p>
      {phase !== "error" && (
        <p className="text-xs text-text-muted">
          You can close this window if it doesn&apos;t close automatically.
        </p>
      )}
    </main>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
