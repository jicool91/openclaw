import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import {
  buildGoogleAuthUrl,
  buildGoogleOauthStartUrl,
  createGoogleStateToken,
  extractEmailFromIdToken,
  fetchGoogleAccountEmail,
  parseOptionalLoginHint,
  resolveGoogleOAuthPaths,
  resolveGoogleOAuthRuntimeConfig,
  sendHtmlPage,
  type SubscriptionPluginConfig,
  verifyGoogleStateToken,
  exchangeGoogleAuthorizationCode,
} from "./google-oauth.js";
import { parseAdminTelegramIds, SubscriptionStore } from "./store.js";

function getDataDir(): string {
  return process.env.DATA_DIR ?? process.env.HOME ?? "/tmp";
}

function mapStateErrorToMessage(error: "missing" | "invalid" | "signature" | "expired"): string {
  switch (error) {
    case "missing":
      return "Missing OAuth state.";
    case "expired":
      return "OAuth session expired. Please restart with /google.";
    case "signature":
      return "Invalid OAuth state signature.";
    case "invalid":
    default:
      return "Invalid OAuth state payload.";
  }
}

async function sendTelegramNotice(params: {
  api: OpenClawPluginApi;
  userId: number;
  message: string;
  accountId?: string;
}): Promise<void> {
  try {
    await params.api.runtime.channel.telegram.sendMessageTelegram(
      String(params.userId),
      params.message,
      params.accountId ? { accountId: params.accountId } : undefined,
    );
  } catch (error) {
    params.api.logger.warn(`subscription: failed to send telegram notice: ${String(error)}`);
  }
}

export default function register(api: OpenClawPluginApi) {
  const pluginConfig = (api.pluginConfig ?? {}) as SubscriptionPluginConfig;
  const oauthPaths = resolveGoogleOAuthPaths(pluginConfig);
  const store = new SubscriptionStore(getDataDir());

  const bootstrapService: OpenClawPluginService = {
    id: "subscription-bootstrap",
    start: async () => {
      await store.ensureSchema();

      const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
      const owners = await store.ensureOwnerUsers(adminIds);
      if (owners > 0) {
        api.logger.info(`subscription: initialized ${owners} owner${owners > 1 ? "s" : ""}`);
      }

      const oauthConfig = resolveGoogleOAuthRuntimeConfig({
        pluginConfig,
        gatewayToken: api.config.gateway?.auth?.token,
      });
      if (oauthConfig.ok) {
        api.logger.info(`subscription: google oauth callback ${oauthConfig.value.callbackUrl}`);
      } else {
        api.logger.warn(`subscription: google oauth disabled (${oauthConfig.error})`);
      }
    },
  };

  api.registerService(bootstrapService);

  api.registerCommand({
    name: "google",
    description: "Connect your Google account via OAuth.",
    acceptsArgs: true,
    requireAuth: false,
    handler: async (ctx) => {
      if (ctx.channel !== "telegram") {
        return { text: "Google OAuth is currently available only in Telegram." };
      }

      const senderId = Number.parseInt(ctx.senderId ?? "", 10);
      if (!Number.isFinite(senderId) || senderId <= 0) {
        return { text: "Unable to determine your Telegram user id." };
      }

      const rawArgs = ctx.args?.trim();
      const loginHint = parseOptionalLoginHint(rawArgs);
      if (rawArgs && !loginHint) {
        return {
          text: "Invalid email format. Use /google or /google you@example.com",
        };
      }

      const oauthConfig = resolveGoogleOAuthRuntimeConfig({
        pluginConfig,
        gatewayToken: api.config.gateway?.auth?.token,
      });
      if (!oauthConfig.ok) {
        return {
          text:
            `Google OAuth is not configured: ${oauthConfig.error}\n` +
            "Required env: OPENCLAW_GOOGLE_OAUTH_CLIENT_ID, OPENCLAW_GOOGLE_OAUTH_CLIENT_SECRET, and public URL.",
        };
      }

      const state = createGoogleStateToken({
        secret: oauthConfig.value.stateSecret,
        telegramUserId: senderId,
        accountId: ctx.accountId,
        loginHint,
      });

      const startUrl = buildGoogleOauthStartUrl({
        config: oauthConfig.value,
        state,
      });

      return {
        text:
          "Open this URL to connect your Google account:\n" +
          `${startUrl}\n\n` +
          "After completion, return to Telegram.",
      };
    },
  });

  api.registerHttpRoute({
    path: oauthPaths.startPath,
    handler: (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Method Not Allowed");
        return;
      }

      const oauthConfig = resolveGoogleOAuthRuntimeConfig({
        pluginConfig,
        gatewayToken: api.config.gateway?.auth?.token,
      });
      if (!oauthConfig.ok) {
        sendHtmlPage({
          res,
          status: 500,
          title: "Google OAuth Not Configured",
          message: oauthConfig.error,
        });
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const state = url.searchParams.get("state")?.trim() ?? "";
      const verified = verifyGoogleStateToken({
        state,
        secret: oauthConfig.value.stateSecret,
      });
      if (!verified.ok) {
        sendHtmlPage({
          res,
          status: 400,
          title: "Invalid OAuth Session",
          message: mapStateErrorToMessage(verified.error),
        });
        return;
      }

      const authUrl = buildGoogleAuthUrl({
        config: oauthConfig.value,
        state,
        loginHint: verified.payload.hint,
      });
      res.statusCode = 302;
      res.setHeader("Location", authUrl);
      res.end();
    },
  });

  api.registerHttpRoute({
    path: oauthPaths.callbackPath,
    handler: async (req, res) => {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Method Not Allowed");
        return;
      }

      const oauthConfig = resolveGoogleOAuthRuntimeConfig({
        pluginConfig,
        gatewayToken: api.config.gateway?.auth?.token,
      });
      if (!oauthConfig.ok) {
        sendHtmlPage({
          res,
          status: 500,
          title: "Google OAuth Not Configured",
          message: oauthConfig.error,
        });
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const stateRaw = url.searchParams.get("state")?.trim() ?? "";
      const verified = verifyGoogleStateToken({
        state: stateRaw,
        secret: oauthConfig.value.stateSecret,
      });
      if (!verified.ok) {
        sendHtmlPage({
          res,
          status: 400,
          title: "Invalid OAuth Session",
          message: mapStateErrorToMessage(verified.error),
        });
        return;
      }

      const oauthError = url.searchParams.get("error")?.trim();
      if (oauthError) {
        const detail = url.searchParams.get("error_description")?.trim();
        const message = detail ? `${oauthError}: ${detail}` : oauthError;
        await sendTelegramNotice({
          api,
          userId: verified.payload.uid,
          accountId: verified.payload.aid,
          message: `Google OAuth failed: ${message}`,
        });
        sendHtmlPage({
          res,
          status: 400,
          title: "Google OAuth Failed",
          message,
        });
        return;
      }

      const code = url.searchParams.get("code")?.trim();
      if (!code) {
        sendHtmlPage({
          res,
          status: 400,
          title: "Google OAuth Failed",
          message: "Missing authorization code.",
        });
        return;
      }

      try {
        const tokens = await exchangeGoogleAuthorizationCode({
          config: oauthConfig.value,
          code,
        });

        const emailFromUserInfo = await fetchGoogleAccountEmail(tokens.accessToken);
        const email = emailFromUserInfo ?? extractEmailFromIdToken(tokens.idToken);

        await store.upsertGoogleOAuth({
          telegramUserId: verified.payload.uid,
          email,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          scope: tokens.scope,
          tokenType: tokens.tokenType,
          idToken: tokens.idToken,
          tokenExpiresAt: tokens.expiresAt,
        });

        await sendTelegramNotice({
          api,
          userId: verified.payload.uid,
          accountId: verified.payload.aid,
          message: `Google account connected${email ? `: ${email}` : "."}`,
        });

        sendHtmlPage({
          res,
          status: 200,
          title: "Google Connected",
          message: email
            ? `Google account ${email} is now connected. You can return to Telegram.`
            : "Google account connected. You can return to Telegram.",
        });
      } catch (error) {
        api.logger.error(`subscription: google oauth callback failed: ${String(error)}`);
        await sendTelegramNotice({
          api,
          userId: verified.payload.uid,
          accountId: verified.payload.aid,
          message: "Google OAuth failed on callback processing. Please run /google again.",
        });
        sendHtmlPage({
          res,
          status: 500,
          title: "Google OAuth Failed",
          message: "OAuth callback processing failed. Please run /google again.",
        });
      }
    },
  });

  // Lifecycle hook kept intentionally lightweight as an extension seam.
  api.on("message_received", (_event, ctx) => {
    if (ctx.channelId !== "telegram") {
      return;
    }
  });
}
