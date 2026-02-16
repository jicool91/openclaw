import type { ReplyToMode } from "../config/config.js";
import type { TelegramAccountConfig } from "../config/types.telegram.js";
import type { RuntimeEnv } from "../runtime.js";
import type { TelegramBotOptions } from "./bot.js";
import type { TelegramContext, TelegramStreamMode } from "./bot/types.js";
import type { UserStore } from "./user-store.js";
import { canSendMessage, formatAccessDeniedMessage } from "./access-control.js";
import {
  buildTelegramMessageContext,
  type BuildTelegramMessageContextParams,
  type TelegramMediaRef,
} from "./bot-message-context.js";
import { dispatchTelegramMessage } from "./bot-message-dispatch.js";
import { isAdmin, parseAdminTelegramIds } from "./owner-config.js";

/** Dependencies injected once when creating the message processor. */
type TelegramMessageProcessorDeps = Omit<
  BuildTelegramMessageContextParams,
  "primaryCtx" | "allMedia" | "storeAllowFrom" | "options"
> & {
  telegramCfg: TelegramAccountConfig;
  runtime: RuntimeEnv;
  replyToMode: ReplyToMode;
  streamMode: TelegramStreamMode;
  textLimit: number;
  opts: Pick<TelegramBotOptions, "token">;
  resolveBotTopicsEnabled: (ctx: TelegramContext) => boolean | Promise<boolean>;
  userStore: UserStore;
};

export const createTelegramMessageProcessor = (deps: TelegramMessageProcessorDeps) => {
  const {
    bot,
    cfg,
    account,
    telegramCfg,
    historyLimit,
    groupHistories,
    dmPolicy,
    allowFrom,
    groupAllowFrom,
    ackReactionScope,
    logger,
    resolveGroupActivation,
    resolveGroupRequireMention,
    resolveTelegramGroupConfig,
    runtime,
    replyToMode,
    streamMode,
    textLimit,
    opts,
    resolveBotTopicsEnabled,
    userStore,
  } = deps;
  const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);

  return async (
    primaryCtx: TelegramContext,
    allMedia: TelegramMediaRef[],
    storeAllowFrom: string[],
    options?: { messageIdOverride?: string; forceWasMentioned?: boolean },
  ) => {
    const context = await buildTelegramMessageContext({
      primaryCtx,
      allMedia,
      storeAllowFrom,
      options,
      bot,
      cfg,
      account,
      historyLimit,
      groupHistories,
      dmPolicy,
      allowFrom,
      groupAllowFrom,
      ackReactionScope,
      logger,
      resolveGroupActivation,
      resolveGroupRequireMention,
      resolveTelegramGroupConfig,
    });
    if (!context) {
      return;
    }

    // Check access control (subscription/trial/limits)
    const userId = primaryCtx.message.from?.id;
    const chatType = primaryCtx.message.chat?.type;
    const enforceAccessControl = chatType === "private";
    if (userId && enforceAccessControl) {
      try {
        const adminUser = isAdmin(userId, adminIds);
        // Get or create user
        let user = await userStore.getUser(userId);
        if (!user) {
          // New user - create with owner role for admins, trial for others.
          user = await userStore.createUser({
            telegramUserId: userId,
            firstName: primaryCtx.message.from?.first_name,
            lastName: primaryCtx.message.from?.last_name,
            username: primaryCtx.message.from?.username,
            role: adminUser ? "owner" : "trial",
          });
        } else if (adminUser && user.role !== "owner") {
          // Repair role drift: ADMIN_TELEGRAM_IDS must always stay owner.
          user = await userStore.updateUser(userId, {
            role: "owner",
            trialExpiresAt: null,
          });
        }

        // Check if user can send message
        const accessCheck = canSendMessage(user);
        if (!accessCheck.allowed) {
          const deniedMessage = formatAccessDeniedMessage(accessCheck);
          if (deniedMessage) {
            await bot.api.sendMessage(userId, deniedMessage);
          }
          return; // Block message
        }

        // Increment message counter before processing (0 tokens/cost for now)
        await userStore.incrementUsage(userId, 0, 0);
      } catch (err) {
        runtime.error?.(`telegram: access control check failed for user ${userId}: ${String(err)}`);
        // Continue processing on error to avoid blocking users
      }
    }

    await dispatchTelegramMessage({
      context,
      bot,
      cfg,
      runtime,
      replyToMode,
      streamMode,
      textLimit,
      telegramCfg,
      opts,
      resolveBotTopicsEnabled,
    });
  };
};
