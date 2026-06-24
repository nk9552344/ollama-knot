/**
 * Browser-side helpers for the OAuth Authorization Code + PKCE flow used to
 * authenticate MCP servers.
 */

const STORAGE_PREFIX = "mcp-oauth-";

function bytesToBase64Url(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBytes(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

export function generateState() {
  return bytesToBase64Url(randomBytes(16));
}

export function generateCodeVerifier() {
  return bytesToBase64Url(randomBytes(32));
}

export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(hash));
}

export function defaultRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/oauth/callback`;
}

export function buildAuthorizationUrl({
  authorizationUrl,
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
  extraParams,
}) {
  const url = new URL(authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  if (scope) url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

function storeFlowState(state, payload) {
  sessionStorage.setItem(STORAGE_PREFIX + state, JSON.stringify(payload));
}

function consumeFlowState(state) {
  const key = STORAGE_PREFIX + state;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Open a popup window centered on screen.
 */
function openCenteredPopup(url, name, width = 540, height = 720) {
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "resizable=yes",
    "scrollbars=yes",
    "status=no",
    "menubar=no",
    "toolbar=no",
    "location=yes",
  ].join(",");
  return window.open(url, name, features);
}

/**
 * Drives the popup-based OAuth flow end-to-end. Returns a promise that
 * resolves with the exchange API response.
 *
 * NOTE: this function MUST be invoked from a user gesture (e.g. an onClick
 * handler) — we open the popup synchronously to bypass browser popup blockers
 * and only navigate it to the authorization URL once PKCE is computed.
 */
export async function runOauthPopupFlow({ server }) {
  const auth = server.auth || {};
  if (!auth.authorizationUrl || !auth.tokenUrl || !auth.clientId) {
    throw new Error(
      "OAuth config is incomplete (need authorizationUrl, tokenUrl, clientId).",
    );
  }

  // Open the popup IMMEDIATELY in the user-gesture frame.
  // Browsers will block window.open() called after an async barrier (await),
  // so we open about:blank now and navigate it later.
  const popup = openCenteredPopup("about:blank", `mcp-oauth-${server.id}`);
  if (!popup || popup.closed || typeof popup.closed === "undefined") {
    throw new Error(
      "Popup blocked. Allow popups for this site and try again.",
    );
  }

  // Show a tiny loading screen inside the popup while PKCE is computed.
  try {
    popup.document.write(
      `<!doctype html><meta charset="utf-8"><title>Authenticating…</title>` +
        `<style>html,body{height:100%;margin:0;background:#0a0a0a;color:#ececec;font:14px system-ui;display:flex;align-items:center;justify-content:center}</style>` +
        `<div>Redirecting to provider…</div>`,
    );
  } catch {
    /* cross-origin already; ignore */
  }

  let state, codeVerifier, redirectUri, authUrl;
  try {
    redirectUri = auth.redirectUri || defaultRedirectUri();
    state = generateState();
    codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    storeFlowState(state, {
      serverId: server.id,
      codeVerifier,
      redirectUri,
      startedAt: Date.now(),
    });

    authUrl = buildAuthorizationUrl({
      authorizationUrl: auth.authorizationUrl,
      clientId: auth.clientId,
      redirectUri,
      scope: auth.scope,
      state,
      codeChallenge,
    });

    // Navigate the already-opened popup to the real authorization URL.
    popup.location.href = authUrl;
  } catch (err) {
    try {
      popup.close();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(pollInterval);
    };

    const finish = (handler) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };

    const pollInterval = setInterval(() => {
      if (popup.closed) {
        consumeFlowState(state);
        finish(() => reject(new Error("Authentication window was closed.")));
      }
    }, 600);

    const onMessage = async (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "mcp-oauth-callback") return;
      if (data.state !== state) return;

      const flow = consumeFlowState(state);
      if (!flow) {
        finish(() =>
          reject(new Error("Session expired. Please try again.")),
        );
        return;
      }

      try {
        if (!popup.closed) popup.close();
      } catch {
        /* ignore */
      }

      if (data.error) {
        finish(() =>
          reject(
            new Error(
              data.errorDescription || data.error || "Authorization failed.",
            ),
          ),
        );
        return;
      }
      if (!data.code) {
        finish(() => reject(new Error("Authorization code missing.")));
        return;
      }

      try {
        const res = await fetch(
          `/api/mcp-servers/${flow.serverId}/oauth/exchange`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: data.code,
              codeVerifier: flow.codeVerifier,
              redirectUri: flow.redirectUri,
            }),
          },
        );
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body.error || `Exchange failed (${res.status})`);
        }
        finish(() => resolve(body));
      } catch (err) {
        finish(() => reject(err));
      }
    };

    window.addEventListener("message", onMessage);
  });
}
