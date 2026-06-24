/**
 * Server-side helpers for MCP server authentication.
 *
 * Auth shapes stored on each server:
 *
 *   none:      { type: "none" }
 *   bearer:    { type: "bearer", token: "..." }
 *   header:    { type: "header", name: "X-API-Key", value: "..." }
 *   oauth:     {
 *                type: "oauth",
 *                authorizationUrl: "...",
 *                tokenUrl: "...",
 *                clientId: "...",
 *                clientSecret: "...",     // optional (confidential clients)
 *                scope: "...",
 *                redirectUri: "...",      // optional override
 *                // Tokens populated after the flow:
 *                accessToken: "...",
 *                refreshToken: "...",
 *                tokenType: "Bearer",
 *                expiresAt: 1234567890,   // unix ms
 *                obtainedAt: 1234567890,
 *              }
 */

import { readStore, writeStore } from "@/lib/store";

const STORE_NAME = "mcp-servers";
const EXPIRY_SKEW_MS = 30_000; // refresh 30s before expiry

export function getAuthSummary(auth) {
  if (!auth || auth.type === "none") {
    return { configured: false, type: "none" };
  }
  if (auth.type === "bearer") {
    return { configured: Boolean(auth.token), type: "bearer" };
  }
  if (auth.type === "header") {
    return {
      configured: Boolean(auth.name && auth.value),
      type: "header",
    };
  }
  if (auth.type === "oauth") {
    const hasConfig = Boolean(auth.authorizationUrl && auth.tokenUrl && auth.clientId);
    const hasToken = Boolean(auth.accessToken);
    const expired = auth.expiresAt && Date.now() > auth.expiresAt;
    return {
      configured: hasConfig,
      type: "oauth",
      authenticated: hasToken && !expired,
      hasToken,
      expired: Boolean(expired),
      expiresAt: auth.expiresAt || null,
      scope: auth.scope || null,
    };
  }
  return { configured: false, type: auth.type || "unknown" };
}

export function buildAuthHeaders(auth) {
  if (!auth || auth.type === "none") return {};
  if (auth.type === "bearer" && auth.token) {
    return { Authorization: `Bearer ${auth.token}` };
  }
  if (auth.type === "header" && auth.name && auth.value) {
    return { [auth.name]: auth.value };
  }
  if (auth.type === "oauth" && auth.accessToken) {
    const tokenType = auth.tokenType || "Bearer";
    return { Authorization: `${tokenType} ${auth.accessToken}` };
  }
  return {};
}

export function isOauthExpired(auth) {
  if (!auth || auth.type !== "oauth" || !auth.expiresAt) return false;
  return Date.now() > auth.expiresAt - EXPIRY_SKEW_MS;
}

export function canRefreshOauth(auth) {
  return Boolean(
    auth &&
      auth.type === "oauth" &&
      auth.refreshToken &&
      auth.tokenUrl &&
      auth.clientId,
  );
}

/**
 * Performs an OAuth refresh_token grant and persists the new tokens back to
 * the server config. Returns the refreshed auth object on success.
 */
export async function refreshOauthToken(serverId) {
  const servers = readStore(STORE_NAME);
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx === -1) throw new Error("Server not found");

  const server = servers[idx];
  const auth = server.auth;
  if (!canRefreshOauth(auth)) {
    throw new Error("Cannot refresh: no refresh_token configured");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", auth.refreshToken);
  body.set("client_id", auth.clientId);
  if (auth.clientSecret) body.set("client_secret", auth.clientSecret);
  if (auth.scope) body.set("scope", auth.scope);

  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data.error) {
    throw new Error(
      data.error_description || data.error || `Refresh failed (${res.status})`,
    );
  }

  const now = Date.now();
  const updatedAuth = {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || auth.refreshToken,
    tokenType: data.token_type || auth.tokenType || "Bearer",
    expiresAt: data.expires_in
      ? now + data.expires_in * 1000
      : auth.expiresAt || null,
    obtainedAt: now,
    scope: data.scope || auth.scope,
  };

  servers[idx] = { ...server, auth: updatedAuth };
  writeStore(STORE_NAME, servers);
  return updatedAuth;
}

/**
 * Exchanges an authorization code for tokens (with PKCE) and persists them.
 */
export async function exchangeOauthCode(serverId, { code, codeVerifier, redirectUri }) {
  const servers = readStore(STORE_NAME);
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx === -1) throw new Error("Server not found");

  const server = servers[idx];
  const auth = server.auth || {};
  if (auth.type !== "oauth") throw new Error("Server is not configured for OAuth");
  if (!auth.tokenUrl) throw new Error("Missing tokenUrl in OAuth config");
  if (!auth.clientId) throw new Error("Missing clientId in OAuth config");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", auth.clientId);
  if (auth.clientSecret) body.set("client_secret", auth.clientSecret);
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const res = await fetch(auth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Some providers (e.g. legacy GitHub) return url-encoded
    data = Object.fromEntries(new URLSearchParams(text));
  }

  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      data.error_description ||
        data.error ||
        `Token exchange failed (${res.status})`,
    );
  }

  const now = Date.now();
  const updatedAuth = {
    ...auth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    tokenType: data.token_type || "Bearer",
    expiresAt: data.expires_in
      ? now + Number(data.expires_in) * 1000
      : null,
    obtainedAt: now,
    scope: data.scope || auth.scope,
  };

  servers[idx] = { ...server, auth: updatedAuth };
  writeStore(STORE_NAME, servers);
  return updatedAuth;
}

/**
 * Clears stored OAuth tokens but keeps the OAuth configuration intact.
 */
export function clearOauthTokens(serverId) {
  const servers = readStore(STORE_NAME);
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx === -1) throw new Error("Server not found");
  const server = servers[idx];
  if (server.auth?.type !== "oauth") return server;
  servers[idx] = {
    ...server,
    auth: {
      ...server.auth,
      accessToken: null,
      refreshToken: null,
      tokenType: null,
      expiresAt: null,
      obtainedAt: null,
    },
  };
  writeStore(STORE_NAME, servers);
  return servers[idx];
}
