import { exchangeOauthCode } from "@/lib/mcpAuth";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { code, codeVerifier, redirectUri } = body || {};

    if (!code || !redirectUri) {
      return Response.json(
        { error: "Missing code or redirectUri" },
        { status: 400 },
      );
    }

    const auth = await exchangeOauthCode(id, {
      code,
      codeVerifier,
      redirectUri,
    });

    // Never return tokens to the browser — just return a public summary.
    return Response.json({
      ok: true,
      tokenType: auth.tokenType,
      scope: auth.scope || null,
      expiresAt: auth.expiresAt || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
}
