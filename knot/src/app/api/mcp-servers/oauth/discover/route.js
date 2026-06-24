/**
 * Try to auto-discover OAuth endpoints for an MCP HTTP server using the
 * RFC 9728 / RFC 8414 well-known metadata documents. Returns a partial OAuth
 * config that the user can review and save.
 *
 * Body: { url: string }   // the MCP server URL
 */

export const dynamic = "force-dynamic";

async function fetchJsonWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function originOf(urlString) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return Response.json({ error: "url is required" }, { status: 400 });
    }

    const origin = originOf(url);
    if (!origin) {
      return Response.json({ error: "Invalid url" }, { status: 400 });
    }

    // 1) Probe the MCP endpoint for a 401 + WWW-Authenticate hint.
    let wwwAuthenticate = null;
    try {
      const probe = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json, text/event-stream" },
        cache: "no-store",
      });
      if (probe.status === 401) {
        wwwAuthenticate = probe.headers.get("www-authenticate");
      }
    } catch {
      /* ignore network errors during probe */
    }

    // 2) Look up the protected-resource metadata (RFC 9728).
    const resourceMetadata = await fetchJsonWithTimeout(
      `${origin}/.well-known/oauth-protected-resource`,
    );

    const authorizationServers = Array.isArray(
      resourceMetadata?.authorization_servers,
    )
      ? resourceMetadata.authorization_servers
      : [];

    // 3) For each authorization server, fetch its metadata (RFC 8414).
    const candidates = authorizationServers.length
      ? authorizationServers
      : [origin];

    let authMetadata = null;
    let authIssuer = null;
    for (const issuer of candidates) {
      const issuerOrigin = originOf(issuer) || issuer;
      const meta =
        (await fetchJsonWithTimeout(
          `${issuerOrigin}/.well-known/oauth-authorization-server`,
        )) ||
        (await fetchJsonWithTimeout(
          `${issuerOrigin}/.well-known/openid-configuration`,
        ));
      if (meta) {
        authMetadata = meta;
        authIssuer = issuerOrigin;
        break;
      }
    }

    return Response.json({
      ok: true,
      wwwAuthenticate,
      resourceMetadata,
      authorizationServer: authIssuer,
      authorizationUrl: authMetadata?.authorization_endpoint || null,
      tokenUrl: authMetadata?.token_endpoint || null,
      registrationUrl: authMetadata?.registration_endpoint || null,
      scopesSupported: authMetadata?.scopes_supported || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
