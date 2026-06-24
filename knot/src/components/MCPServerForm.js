"use client";

import { useState } from "react";
import { Button } from "./Button";
import { Input, Textarea, Select } from "./FormElements";
import { Toggle } from "./Toggle";
import { Modal } from "./Modal";
import { Loader2, Search } from "lucide-react";

const DEFAULT_AUTH = { type: "none" };

const AUTH_TYPES = [
  { label: "None", value: "none" },
  { label: "Bearer token", value: "bearer" },
  { label: "Custom header", value: "header" },
  { label: "OAuth 2.0 (PKCE)", value: "oauth" },
];

function envObjectToText(envObj) {
  return Object.entries(envObj || {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function envTextToObject(text) {
  const out = {};
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf("=");
      if (idx === -1) return;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) out[k] = v;
    });
  return out;
}

function normaliseAuth(auth) {
  if (!auth || !auth.type) return { ...DEFAULT_AUTH };
  return { ...auth };
}

function callbackUrl() {
  if (typeof window === "undefined") return "/oauth/callback";
  return `${window.location.origin}/oauth/callback`;
}

export function MCPServerForm({ isOpen, onClose, initial, onSave }) {
  const isEditing = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name || "");
  const [type, setType] = useState(initial?.type || "http");
  const [url, setUrl] = useState(initial?.url || "");
  const [transport, setTransport] = useState(
    initial?.transport || initial?.auth?.transport || "auto",
  );
  const [command, setCommand] = useState(initial?.command || "");
  const [argsText, setArgsText] = useState(
    Array.isArray(initial?.args) ? initial.args.join(" ") : "",
  );
  const [envText, setEnvText] = useState(envObjectToText(initial?.env));
  const [description, setDescription] = useState(initial?.description || "");
  const [active, setActive] = useState(
    initial?.active === undefined ? true : initial.active,
  );
  const [auth, setAuth] = useState(normaliseAuth(initial?.auth));
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [discoverResult, setDiscoverResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const setAuthField = (patch) => setAuth((prev) => ({ ...prev, ...patch }));

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Strip empty optional fields out of the auth blob so JSON stays clean.
      const cleanAuth = (() => {
        if (auth.type === "none") return { type: "none" };
        if (auth.type === "bearer") {
          return { type: "bearer", token: auth.token || "" };
        }
        if (auth.type === "header") {
          return {
            type: "header",
            name: auth.name || "",
            value: auth.value || "",
          };
        }
        if (auth.type === "oauth") {
          return {
            type: "oauth",
            authorizationUrl: auth.authorizationUrl || "",
            tokenUrl: auth.tokenUrl || "",
            clientId: auth.clientId || "",
            clientSecret: auth.clientSecret || "",
            scope: auth.scope || "",
            redirectUri: auth.redirectUri || "",
            // Preserve token material on edit
            accessToken: auth.accessToken || null,
            refreshToken: auth.refreshToken || null,
            tokenType: auth.tokenType || null,
            expiresAt: auth.expiresAt || null,
            obtainedAt: auth.obtainedAt || null,
          };
        }
        return auth;
      })();

      const payload = {
        name: name.trim(),
        type,
        url: type === "http" ? url.trim() : "",
        transport:
          type === "http" && transport !== "auto" ? transport : null,
        command: type === "stdio" ? command.trim() : "",
        args:
          type === "stdio"
            ? argsText.split(/\s+/).filter(Boolean)
            : [],
        env: type === "stdio" ? envTextToObject(envText) : {},
        description: description.trim(),
        active,
        auth: cleanAuth,
      };

      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDiscover = async () => {
    if (!url.trim()) {
      setDiscoverError("Set the server URL first.");
      return;
    }
    setDiscovering(true);
    setDiscoverError(null);
    setDiscoverResult(null);
    try {
      const res = await fetch("/api/mcp-servers/oauth/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDiscoverResult(data);
      setAuth((prev) => ({
        ...prev,
        type: "oauth",
        authorizationUrl:
          data.authorizationUrl || prev.authorizationUrl || "",
        tokenUrl: data.tokenUrl || prev.tokenUrl || "",
        scope:
          (Array.isArray(data.scopesSupported)
            ? data.scopesSupported.join(" ")
            : prev.scope) || prev.scope,
      }));
    } catch (e) {
      setDiscoverError(e.message);
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit MCP Server" : "Add MCP Server"}
      size="lg"
    >
      <div className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. GitHub API"
        />

        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { label: "HTTP", value: "http" },
            { label: "STDIO", value: "stdio" },
          ]}
        />

        {type === "http" && (
          <>
            <Input
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/mcp"
            />
            <div>
              <Select
                label="Transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                options={[
                  { label: "Auto (detect)", value: "auto" },
                  { label: "Streamable HTTP (/mcp)", value: "http" },
                  { label: "Legacy SSE (/sse)", value: "sse" },
                ]}
              />
              <p className="mt-1 text-[11px] text-text-muted">
                Most modern servers use Streamable HTTP. Older servers (e.g.{" "}
                <span className="font-mono">mcp.deepwiki.com/sse</span>) need
                Legacy SSE. Leave on Auto unless you see a transport mismatch.
              </p>
            </div>
          </>
        )}

        {type === "stdio" && (
          <>
            <Input
              label="Command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="node"
            />
            <Input
              label="Arguments (space-separated)"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="server.js --verbose"
            />
            <Textarea
              label="Environment Variables"
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder="KEY=VALUE&#10;KEY2=VALUE2"
              rows={4}
              className="font-mono text-xs"
            />
            <p className="-mt-2 text-[11px] text-text-muted">
              Use env vars for secrets like <code>API_TOKEN=...</code>.
            </p>
          </>
        )}

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          rows={2}
        />

        {/* Authentication */}
        {type === "http" && (
          <div className="space-y-3 rounded-md border border-border bg-bg-overlay p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                Authentication
              </h3>
              <span className="text-[11px] text-text-muted">
                Sent on every request
              </span>
            </div>

            <Select
              label="Method"
              value={auth.type || "none"}
              onChange={(e) =>
                setAuth({ ...DEFAULT_AUTH, type: e.target.value })
              }
              options={AUTH_TYPES}
            />

            {auth.type === "bearer" && (
              <Input
                label="Token"
                type="password"
                value={auth.token || ""}
                onChange={(e) => setAuthField({ token: e.target.value })}
                placeholder="ghp_..., sk-..., etc."
                autoComplete="off"
              />
            )}

            {auth.type === "header" && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Header name"
                  value={auth.name || ""}
                  onChange={(e) => setAuthField({ name: e.target.value })}
                  placeholder="X-API-Key"
                />
                <Input
                  label="Header value"
                  type="password"
                  value={auth.value || ""}
                  onChange={(e) => setAuthField({ value: e.target.value })}
                  placeholder="secret"
                  autoComplete="off"
                />
              </div>
            )}

            {auth.type === "oauth" && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 rounded border border-border bg-bg p-2">
                  <div className="text-[11px] text-text-muted">
                    Register{" "}
                    <code className="font-mono text-text-secondary">
                      {callbackUrl()}
                    </code>{" "}
                    as a redirect URI with your OAuth provider.
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDiscover}
                    disabled={discovering || !url.trim()}
                    title="Try to fetch OAuth metadata from the server"
                  >
                    {discovering ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Search size={13} />
                    )}
                    Discover
                  </Button>
                </div>

                {discoverError && (
                  <p className="text-xs text-status-red">{discoverError}</p>
                )}
                {discoverResult && !discoverError && (
                  <p className="text-xs text-text-muted">
                    {discoverResult.authorizationServer
                      ? `Found endpoints at ${discoverResult.authorizationServer}`
                      : "Could not auto-discover endpoints — fill them in manually."}
                  </p>
                )}

                <Input
                  label="Authorization URL"
                  value={auth.authorizationUrl || ""}
                  onChange={(e) =>
                    setAuthField({ authorizationUrl: e.target.value })
                  }
                  placeholder="https://provider.example.com/oauth/authorize"
                />
                <Input
                  label="Token URL"
                  value={auth.tokenUrl || ""}
                  onChange={(e) => setAuthField({ tokenUrl: e.target.value })}
                  placeholder="https://provider.example.com/oauth/token"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Client ID"
                    value={auth.clientId || ""}
                    onChange={(e) =>
                      setAuthField({ clientId: e.target.value })
                    }
                    placeholder="abc123"
                  />
                  <Input
                    label="Client Secret (optional)"
                    type="password"
                    value={auth.clientSecret || ""}
                    onChange={(e) =>
                      setAuthField({ clientSecret: e.target.value })
                    }
                    autoComplete="off"
                  />
                </div>
                <Input
                  label="Scope"
                  value={auth.scope || ""}
                  onChange={(e) => setAuthField({ scope: e.target.value })}
                  placeholder="read write"
                />
                <Input
                  label="Redirect URI override (optional)"
                  value={auth.redirectUri || ""}
                  onChange={(e) =>
                    setAuthField({ redirectUri: e.target.value })
                  }
                  placeholder={callbackUrl()}
                />
                {isEditing && auth.accessToken && (
                  <p className="rounded border border-status-green/30 bg-status-green/10 px-2 py-1 text-[11px] text-status-green">
                    Tokens stored. Use the “Authenticate” button on the card to
                    re-authorize.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Toggle
          checked={active}
          onChange={(v) => setActive(v)}
          label={active ? "Active" : "Inactive"}
        />

        <div className="flex gap-2 pt-2">
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1"
          >
            {isEditing ? "Update" : "Create"}
          </Button>
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
