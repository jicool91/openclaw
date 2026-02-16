import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleStateToken,
  parseOptionalLoginHint,
  resolveGoogleOAuthPaths,
  resolveGoogleOAuthRuntimeConfig,
  verifyGoogleStateToken,
  DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH,
  DEFAULT_GOOGLE_OAUTH_START_PATH,
} from "./google-oauth.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("subscription google oauth helpers", () => {
  it("resolves default start/callback paths", () => {
    const paths = resolveGoogleOAuthPaths({});
    expect(paths.startPath).toBe(DEFAULT_GOOGLE_OAUTH_START_PATH);
    expect(paths.callbackPath).toBe(DEFAULT_GOOGLE_OAUTH_CALLBACK_PATH);
  });

  it("resolves oauth config from env and railway domain", () => {
    vi.stubEnv("OPENCLAW_GOOGLE_OAUTH_CLIENT_ID", "client-id");
    vi.stubEnv("OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "openclaw-test.up.railway.app");

    const resolved = resolveGoogleOAuthRuntimeConfig({
      pluginConfig: {},
      gatewayToken: "gateway-token",
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }

    expect(resolved.value.startPath).toBe("/oauth/google/start");
    expect(resolved.value.callbackPath).toBe("/oauth/google/callback");
    expect(resolved.value.callbackUrl).toBe(
      "https://openclaw-test.up.railway.app/oauth/google/callback",
    );
    expect(resolved.value.stateSecret).toBe("gateway-token");
    expect(resolved.value.scopes).toEqual(["openid", "email", "profile"]);
  });

  it("creates and verifies signed state payload", () => {
    const nowMs = 1_700_000_000_000;
    const token = createGoogleStateToken({
      secret: "test-secret",
      telegramUserId: 12345,
      accountId: "default",
      loginHint: "user@example.com",
      nowMs,
    });

    const verified = verifyGoogleStateToken({
      state: token,
      secret: "test-secret",
      nowMs: nowMs + 30_000,
    });

    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    expect(verified.payload.uid).toBe(12345);
    expect(verified.payload.aid).toBe("default");
    expect(verified.payload.hint).toBe("user@example.com");
  });

  it("rejects expired state payload", () => {
    const nowMs = 1_700_000_000_000;
    const token = createGoogleStateToken({
      secret: "test-secret",
      telegramUserId: 12345,
      nowMs,
    });

    const verified = verifyGoogleStateToken({
      state: token,
      secret: "test-secret",
      nowMs: nowMs + 16 * 60 * 1000,
      maxAgeMs: 15 * 60 * 1000,
    });

    expect(verified).toEqual({ ok: false, error: "expired" });
  });

  it("parses optional login hint", () => {
    expect(parseOptionalLoginHint(undefined)).toBeUndefined();
    expect(parseOptionalLoginHint("")).toBeUndefined();
    expect(parseOptionalLoginHint("not-an-email")).toBeUndefined();
    expect(parseOptionalLoginHint("user@example.com")).toBe("user@example.com");
  });
});
