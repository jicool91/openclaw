import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SubscriptionPluginConfig = {
  publicUrl?: string;
  googleOauthStartPath?: string;
  googleOauthCallbackPath?: string;
  googleOauthScopes?: string[];
};

export type GoogleOAuthPaths = {
  startPath: string;
  callbackPath: string;
};

export type GoogleOAuthRuntimeConfig = {
  publicBaseUrl: string;
  startPath: string;
  callbackPath: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  stateSecret: string;
  scopes: string[];
};

export type GoogleStatePayload = {
  v: 1;
  uid: number;
  ts: number;
  n: string;
  aid?: string;
  hint?: string;
};

export type GoogleTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
  idToken?: string;
  expiresAt?: number;
};

export const DEFAULT_GOOGLE_OAUTH_START_PATH = "/oauth/google/start";
export const DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH = "/oauth/google/callback";
export const DEFAULT_GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"];
export const GOOGLE_STATE_MAX_AGE_MS = 15 * 60 * 1000;

function normalizePath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "") || fallback;
}

function normalizeBaseUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function splitScopes(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") {
    return [];
  }
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}

function signatureForPayload(payloadEncoded: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadEncoded).digest("base64url");
}

function safeEqualStrings(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseStatePayload(payloadEncoded: string): GoogleStatePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8")) as
      | Partial<GoogleStatePayload>
      | undefined;
    if (!parsed) {
      return null;
    }
    if (parsed.v !== 1 || typeof parsed.uid !== "number" || !Number.isFinite(parsed.uid)) {
      return null;
    }
    if (typeof parsed.ts !== "number" || !Number.isFinite(parsed.ts)) {
      return null;
    }
    if (typeof parsed.n !== "string" || parsed.n.trim() === "") {
      return null;
    }

    const normalized: GoogleStatePayload = {
      v: 1,
      uid: Math.trunc(parsed.uid),
      ts: Math.trunc(parsed.ts),
      n: parsed.n,
    };
    if (typeof parsed.aid === "string" && parsed.aid.trim() !== "") {
      normalized.aid = parsed.aid.trim();
    }
    if (typeof parsed.hint === "string" && parsed.hint.trim() !== "") {
      normalized.hint = parsed.hint.trim();
    }
    return normalized;
  } catch {
    return null;
  }
}

export function resolveGoogleOAuthPaths(pluginConfig: SubscriptionPluginConfig): GoogleOAuthPaths {
  return {
    startPath: normalizePath(pluginConfig.googleOauthStartPath, DEFAULT_GOOGLE_OAUTH_START_PATH),
    callbackPath: normalizePath(
      pluginConfig.googleOauthCallbackPath,
      DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH,
    ),
  };
}

export function resolveGoogleOAuthRuntimeConfig(params: {
  pluginConfig: SubscriptionPluginConfig;
  gatewayToken?: string;
  env?: NodeJS.ProcessEnv;
}): { ok: true; value: GoogleOAuthRuntimeConfig } | { ok: false; error: string } {
  const env = params.env ?? process.env;
  const clientId = env.OPENCLAW_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error:
        "missing OPENCLAW_GOOGLE_OAUTH_CLIENT_ID/OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET environment variables",
    };
  }

  const paths = resolveGoogleOAuthPaths(params.pluginConfig);
  const publicBaseUrl =
    normalizeBaseUrl(params.pluginConfig.publicUrl) ??
    normalizeBaseUrl(env.OPENCLAW_PUBLIC_URL) ??
    normalizeBaseUrl(env.RAILWAY_STATIC_URL) ??
    normalizeBaseUrl(env.RAILWAY_PUBLIC_DOMAIN);
  if (!publicBaseUrl) {
    return {
      ok: false,
      error:
        "missing public URL (set subscription.publicUrl, OPENCLAW_PUBLIC_URL, RAILWAY_STATIC_URL, or RAILWAY_PUBLIC_DOMAIN)",
    };
  }

  const callbackUrlRaw =
    env.OPENCLAW_GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${publicBaseUrl}${paths.callbackPath}`;
  const callbackUrl = normalizeBaseUrl(callbackUrlRaw);
  if (!callbackUrl) {
    return {
      ok: false,
      error: "invalid redirect URI (OPENCLAW_GOOGLE_OAUTH_REDIRECT_URI)",
    };
  }

  const scopesFromPlugin = (params.pluginConfig.googleOauthScopes ?? []).map((scope) =>
    scope.trim(),
  );
  const scopesFromEnv = splitScopes(env.OPENCLAW_GOOGLE_OAUTH_SCOPES);
  const scopes = Array.from(
    new Set([
      ...(scopesFromPlugin.filter((scope) => scope.length > 0) ?? []),
      ...(scopesFromEnv ?? []),
      ...DEFAULT_GOOGLE_OAUTH_SCOPES,
    ]),
  );

  const stateSecret =
    env.OPENCLAW_GOOGLE_OAUTH_STATE_SECRET?.trim() || params.gatewayToken?.trim() || clientSecret;

  return {
    ok: true,
    value: {
      publicBaseUrl,
      startPath: paths.startPath,
      callbackPath: paths.callbackPath,
      callbackUrl,
      clientId,
      clientSecret,
      stateSecret,
      scopes,
    },
  };
}

export function parseOptionalLoginHint(rawArgs: string | undefined): string | undefined {
  const value = rawArgs?.trim() ?? "";
  if (!value) {
    return undefined;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return undefined;
  }
  return value;
}

export function createGoogleStateToken(params: {
  secret: string;
  telegramUserId: number;
  accountId?: string;
  loginHint?: string;
  nowMs?: number;
}): string {
  const payload: GoogleStatePayload = {
    v: 1,
    uid: Math.trunc(params.telegramUserId),
    ts: Math.trunc(params.nowMs ?? Date.now()),
    n: randomBytes(12).toString("hex"),
  };
  if (params.accountId?.trim()) {
    payload.aid = params.accountId.trim();
  }
  if (params.loginHint?.trim()) {
    payload.hint = params.loginHint.trim();
  }

  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signatureForPayload(payloadEncoded, params.secret);
  return `${payloadEncoded}.${signature}`;
}

export function verifyGoogleStateToken(params: {
  state: string;
  secret: string;
  nowMs?: number;
  maxAgeMs?: number;
}):
  | { ok: true; payload: GoogleStatePayload }
  | { ok: false; error: "missing" | "invalid" | "signature" | "expired" } {
  const raw = params.state.trim();
  if (!raw) {
    return { ok: false, error: "missing" };
  }

  const sep = raw.lastIndexOf(".");
  if (sep <= 0 || sep === raw.length - 1) {
    return { ok: false, error: "invalid" };
  }

  const payloadEncoded = raw.slice(0, sep);
  const signature = raw.slice(sep + 1);
  const expectedSignature = signatureForPayload(payloadEncoded, params.secret);
  if (!safeEqualStrings(signature, expectedSignature)) {
    return { ok: false, error: "signature" };
  }

  const payload = parseStatePayload(payloadEncoded);
  if (!payload) {
    return { ok: false, error: "invalid" };
  }

  const nowMs = Math.trunc(params.nowMs ?? Date.now());
  const maxAgeMs = Math.max(60_000, Math.trunc(params.maxAgeMs ?? GOOGLE_STATE_MAX_AGE_MS));
  if (payload.ts > nowMs + 60_000 || nowMs - payload.ts > maxAgeMs) {
    return { ok: false, error: "expired" };
  }

  return { ok: true, payload };
}

export function buildGoogleOauthStartUrl(params: {
  config: GoogleOAuthRuntimeConfig;
  state: string;
}): string {
  const url = new URL(params.config.startPath, params.config.publicBaseUrl);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export function buildGoogleAuthUrl(params: {
  config: GoogleOAuthRuntimeConfig;
  state: string;
  loginHint?: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.config.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.config.scopes.join(" "));
  // Per Google OAuth docs, offline access is required for refresh_token.
  // `prompt=consent` forces the consent screen so refresh_token can be re-issued.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  if (params.loginHint?.trim()) {
    url.searchParams.set("login_hint", params.loginHint.trim());
  }
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(params: {
  config: GoogleOAuthRuntimeConfig;
  code: string;
}): Promise<GoogleTokenExchangeResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: params.config.clientId,
      client_secret: params.config.clientSecret,
      code: params.code,
      grant_type: "authorization_code",
      redirect_uri: params.config.callbackUrl,
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`google token exchange failed (${response.status}): ${rawBody.slice(0, 500)}`);
  }

  let parsed: {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
    id_token?: string;
    expires_in?: number;
  };
  try {
    parsed = JSON.parse(rawBody) as typeof parsed;
  } catch {
    throw new Error("google token exchange returned non-JSON payload");
  }

  const accessToken = parsed.access_token?.trim() ?? "";
  if (!accessToken) {
    throw new Error("google token exchange returned no access_token");
  }

  const expiresIn =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : undefined;

  return {
    accessToken,
    refreshToken: parsed.refresh_token?.trim() || undefined,
    scope: parsed.scope?.trim() || undefined,
    tokenType: parsed.token_type?.trim() || undefined,
    idToken: parsed.id_token?.trim() || undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
  };
}

export async function fetchGoogleAccountEmail(accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return undefined;
    }
    const parsed = (await response.json()) as { email?: string };
    return parsed.email?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function extractEmailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) {
    return undefined;
  }
  const parts = idToken.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      email?: string;
    };
    return payload.email?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sendHtmlPage(params: {
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  };
  status: number;
  title: string;
  message: string;
}): void {
  const title = escapeHtml(params.title);
  const message = escapeHtml(params.message);
  params.res.statusCode = params.status;
  params.res.setHeader("Content-Type", "text/html; charset=utf-8");
  params.res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 2rem; background: #0b1220; color: #f8fafc; }
      main { max-width: 640px; margin: 0 auto; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 1.25rem 1.5rem; }
      h1 { margin: 0 0 0.75rem 0; font-size: 1.25rem; }
      p { margin: 0; line-height: 1.5; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`);
}
