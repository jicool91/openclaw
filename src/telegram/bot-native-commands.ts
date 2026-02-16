import type { Bot, Context } from "grammy";
import type { CommandArgs } from "../auto-reply/commands-registry.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ChannelGroupPolicy } from "../config/group-policy.js";
import type {
  ReplyToMode,
  TelegramAccountConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "../config/types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { TelegramContext } from "./bot/types.js";
import type { UserStore } from "./user-store.js";
import { resolveChunkMode } from "../auto-reply/chunk.js";
import {
  buildCommandTextFromArgs,
  findCommandByNativeName,
  listNativeCommandSpecs,
  listNativeCommandSpecsForConfig,
  parseCommandArgs,
  resolveCommandArgMenu,
} from "../auto-reply/commands-registry.js";
import { finalizeInboundContext } from "../auto-reply/reply/inbound-context.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../auto-reply/reply/provider-dispatcher.js";
import { listSkillCommandsForAgents } from "../auto-reply/skill-commands.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../channels/command-gating.js";
import { createReplyPrefixOptions } from "../channels/reply-prefix.js";
import { resolveMarkdownTableMode } from "../config/markdown-tables.js";
import { resolveTelegramCustomCommands } from "../config/telegram-custom-commands.js";
import {
  normalizeTelegramCommandName,
  TELEGRAM_COMMAND_NAME_PATTERN,
} from "../config/telegram-custom-commands.js";
import { danger, logVerbose } from "../globals.js";
import { getChildLogger } from "../logging.js";
import { readChannelAllowFromStore } from "../pairing/pairing-store.js";
import {
  executePluginCommand,
  getPluginCommandSpecs,
  matchPluginCommand,
} from "../plugins/commands.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import { resolveThreadSessionKeys } from "../routing/session-key.js";
import { getRemainingMessages } from "./access-control.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { firstDefined, isSenderAllowed, normalizeAllowFromWithStore } from "./bot-access.js";
import { TelegramUpdateKeyContext } from "./bot-updates.js";
import { TelegramBotOptions } from "./bot.js";
import { deliverReplies } from "./bot/delivery.js";
import {
  buildTelegramThreadParams,
  buildSenderName,
  buildTelegramGroupFrom,
  buildTelegramGroupPeerId,
  buildTelegramParentPeer,
  resolveTelegramForumThreadId,
  resolveTelegramThreadSpec,
} from "./bot/helpers.js";
import { isAdmin, parseAdminTelegramIds } from "./owner-config.js";
import { buildInlineKeyboard } from "./send.js";

const EMPTY_RESPONSE_FALLBACK = "No response generated. Please try again.";

type TelegramNativeCommandContext = Context & { match?: string };

type TelegramCommandAuthResult = {
  chatId: number;
  isGroup: boolean;
  isForum: boolean;
  resolvedThreadId?: number;
  senderId: string;
  senderUsername: string;
  groupConfig?: TelegramGroupConfig;
  topicConfig?: TelegramTopicConfig;
  commandAuthorized: boolean;
};

type SubscriptionPlan = "starter" | "premium";

type SubscriptionInvoicePayload = {
  v: 1;
  kind: "subscription";
  userId: number;
  plan: SubscriptionPlan;
  accountId: string;
};

const SUBSCRIPTION_PERIOD_DAYS = 30;
const SUBSCRIPTION_PERIOD_MS = SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000;
const SUBSCRIPTION_PRICING: Record<
  SubscriptionPlan,
  {
    title: string;
    description: string;
    label: string;
    stars: number;
  }
> = {
  starter: {
    title: "OpenClaw Starter",
    description: "30 сообщений в день и базовые модели на 30 дней.",
    label: "Starter",
    stars: 100,
  },
  premium: {
    title: "OpenClaw Premium",
    description: "Безлимит и продвинутые модели на 30 дней.",
    label: "Premium",
    stars: 300,
  },
};

function buildSubscriptionInvoicePayload(params: {
  accountId: string;
  userId: number;
  plan: SubscriptionPlan;
}): string {
  const payload: SubscriptionInvoicePayload = {
    v: 1,
    kind: "subscription",
    accountId: params.accountId,
    userId: params.userId,
    plan: params.plan,
  };
  return JSON.stringify(payload);
}

function parseSubscriptionInvoicePayload(raw: string): SubscriptionInvoicePayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SubscriptionInvoicePayload>;
    if (
      parsed?.v !== 1 ||
      parsed.kind !== "subscription" ||
      typeof parsed.userId !== "number" ||
      (parsed.plan !== "starter" && parsed.plan !== "premium") ||
      typeof parsed.accountId !== "string" ||
      parsed.accountId.trim() === ""
    ) {
      return null;
    }
    return parsed as SubscriptionInvoicePayload;
  } catch {
    return null;
  }
}

export type RegisterTelegramHandlerParams = {
  cfg: OpenClawConfig;
  accountId: string;
  bot: Bot;
  mediaMaxBytes: number;
  opts: TelegramBotOptions;
  runtime: RuntimeEnv;
  telegramCfg: TelegramAccountConfig;
  groupAllowFrom?: Array<string | number>;
  resolveGroupPolicy: (chatId: string | number) => ChannelGroupPolicy;
  resolveTelegramGroupConfig: (
    chatId: string | number,
    messageThreadId?: number,
  ) => { groupConfig?: TelegramGroupConfig; topicConfig?: TelegramTopicConfig };
  shouldSkipUpdate: (ctx: TelegramUpdateKeyContext) => boolean;
  processMessage: (
    ctx: TelegramContext,
    allMedia: Array<{ path: string; contentType?: string }>,
    storeAllowFrom: string[],
    options?: {
      messageIdOverride?: string;
      forceWasMentioned?: boolean;
    },
  ) => Promise<void>;
  logger: ReturnType<typeof getChildLogger>;
};

type RegisterTelegramNativeCommandsParams = {
  bot: Bot;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  accountId: string;
  telegramCfg: TelegramAccountConfig;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  replyToMode: ReplyToMode;
  textLimit: number;
  useAccessGroups: boolean;
  nativeEnabled: boolean;
  nativeSkillsEnabled: boolean;
  nativeDisabledExplicit: boolean;
  resolveGroupPolicy: (chatId: string | number) => ChannelGroupPolicy;
  resolveTelegramGroupConfig: (
    chatId: string | number,
    messageThreadId?: number,
  ) => { groupConfig?: TelegramGroupConfig; topicConfig?: TelegramTopicConfig };
  shouldSkipUpdate: (ctx: TelegramUpdateKeyContext) => boolean;
  opts: { token: string };
  userStore: UserStore;
};

async function resolveTelegramCommandAuth(params: {
  msg: NonNullable<TelegramNativeCommandContext["message"]>;
  bot: Bot;
  cfg: OpenClawConfig;
  telegramCfg: TelegramAccountConfig;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  useAccessGroups: boolean;
  resolveGroupPolicy: (chatId: string | number) => ChannelGroupPolicy;
  resolveTelegramGroupConfig: (
    chatId: string | number,
    messageThreadId?: number,
  ) => { groupConfig?: TelegramGroupConfig; topicConfig?: TelegramTopicConfig };
  requireAuth: boolean;
}): Promise<TelegramCommandAuthResult | null> {
  const {
    msg,
    bot,
    cfg,
    telegramCfg,
    allowFrom,
    groupAllowFrom,
    useAccessGroups,
    resolveGroupPolicy,
    resolveTelegramGroupConfig,
    requireAuth,
  } = params;
  const chatId = msg.chat.id;
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
  const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
  const isForum = (msg.chat as { is_forum?: boolean }).is_forum === true;
  const resolvedThreadId = resolveTelegramForumThreadId({
    isForum,
    messageThreadId,
  });
  const storeAllowFrom = await readChannelAllowFromStore("telegram").catch(() => []);
  const { groupConfig, topicConfig } = resolveTelegramGroupConfig(chatId, resolvedThreadId);
  const groupAllowOverride = firstDefined(topicConfig?.allowFrom, groupConfig?.allowFrom);
  const effectiveGroupAllow = normalizeAllowFromWithStore({
    allowFrom: groupAllowOverride ?? groupAllowFrom,
    storeAllowFrom,
  });
  const hasGroupAllowOverride = typeof groupAllowOverride !== "undefined";
  const senderIdRaw = msg.from?.id;
  const senderId = senderIdRaw ? String(senderIdRaw) : "";
  const senderUsername = msg.from?.username ?? "";

  if (isGroup && groupConfig?.enabled === false) {
    await withTelegramApiErrorLogging({
      operation: "sendMessage",
      fn: () => bot.api.sendMessage(chatId, "This group is disabled."),
    });
    return null;
  }
  if (isGroup && topicConfig?.enabled === false) {
    await withTelegramApiErrorLogging({
      operation: "sendMessage",
      fn: () => bot.api.sendMessage(chatId, "This topic is disabled."),
    });
    return null;
  }
  if (requireAuth && isGroup && hasGroupAllowOverride) {
    if (
      senderIdRaw == null ||
      !isSenderAllowed({
        allow: effectiveGroupAllow,
        senderId: String(senderIdRaw),
        senderUsername,
      })
    ) {
      await withTelegramApiErrorLogging({
        operation: "sendMessage",
        fn: () => bot.api.sendMessage(chatId, "You are not authorized to use this command."),
      });
      return null;
    }
  }

  if (isGroup && useAccessGroups) {
    const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
    const groupPolicy = telegramCfg.groupPolicy ?? defaultGroupPolicy ?? "open";
    if (groupPolicy === "disabled") {
      await withTelegramApiErrorLogging({
        operation: "sendMessage",
        fn: () => bot.api.sendMessage(chatId, "Telegram group commands are disabled."),
      });
      return null;
    }
    if (groupPolicy === "allowlist" && requireAuth) {
      if (
        senderIdRaw == null ||
        !isSenderAllowed({
          allow: effectiveGroupAllow,
          senderId: String(senderIdRaw),
          senderUsername,
        })
      ) {
        await withTelegramApiErrorLogging({
          operation: "sendMessage",
          fn: () => bot.api.sendMessage(chatId, "You are not authorized to use this command."),
        });
        return null;
      }
    }
    const groupAllowlist = resolveGroupPolicy(chatId);
    if (groupAllowlist.allowlistEnabled && !groupAllowlist.allowed) {
      await withTelegramApiErrorLogging({
        operation: "sendMessage",
        fn: () => bot.api.sendMessage(chatId, "This group is not allowed."),
      });
      return null;
    }
  }

  const dmAllow = normalizeAllowFromWithStore({
    allowFrom: allowFrom,
    storeAllowFrom,
  });
  const senderAllowed = isSenderAllowed({
    allow: dmAllow,
    senderId,
    senderUsername,
  });
  const commandAuthorized = resolveCommandAuthorizedFromAuthorizers({
    useAccessGroups,
    authorizers: [{ configured: dmAllow.hasEntries, allowed: senderAllowed }],
    modeWhenAccessGroupsOff: "configured",
  });
  if (requireAuth && !commandAuthorized) {
    await withTelegramApiErrorLogging({
      operation: "sendMessage",
      fn: () => bot.api.sendMessage(chatId, "You are not authorized to use this command."),
    });
    return null;
  }

  return {
    chatId,
    isGroup,
    isForum,
    resolvedThreadId,
    senderId,
    senderUsername,
    groupConfig,
    topicConfig,
    commandAuthorized,
  };
}

export const registerTelegramNativeCommands = ({
  bot,
  cfg,
  runtime,
  accountId,
  telegramCfg,
  allowFrom,
  groupAllowFrom,
  replyToMode,
  textLimit,
  useAccessGroups,
  nativeEnabled,
  nativeSkillsEnabled,
  nativeDisabledExplicit,
  resolveGroupPolicy,
  resolveTelegramGroupConfig,
  shouldSkipUpdate,
  opts,
  userStore,
}: RegisterTelegramNativeCommandsParams) => {
  const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);

  const boundRoute =
    nativeEnabled && nativeSkillsEnabled
      ? resolveAgentRoute({ cfg, channel: "telegram", accountId })
      : null;
  const boundAgentIds =
    boundRoute && boundRoute.matchedBy.startsWith("binding.") ? [boundRoute.agentId] : null;
  const skillCommands =
    nativeEnabled && nativeSkillsEnabled
      ? listSkillCommandsForAgents(boundAgentIds ? { cfg, agentIds: boundAgentIds } : { cfg })
      : [];
  const nativeCommands = nativeEnabled
    ? listNativeCommandSpecsForConfig(cfg, {
        skillCommands,
        provider: "telegram",
      })
    : [];
  const reservedCommands = new Set(
    listNativeCommandSpecs().map((command) => command.name.toLowerCase()),
  );
  for (const command of skillCommands) {
    reservedCommands.add(command.name.toLowerCase());
  }
  const customResolution = resolveTelegramCustomCommands({
    commands: telegramCfg.customCommands,
    reservedCommands,
  });
  for (const issue of customResolution.issues) {
    runtime.error?.(danger(issue.message));
  }
  const customCommands = customResolution.commands;
  const pluginCommandSpecs = getPluginCommandSpecs();
  const pluginCommands: Array<{ command: string; description: string }> = [];
  const existingCommands = new Set(
    [
      ...nativeCommands.map((command) => command.name),
      ...customCommands.map((command) => command.command),
    ].map((command) => command.toLowerCase()),
  );
  const pluginCommandNames = new Set<string>();
  for (const spec of pluginCommandSpecs) {
    const normalized = normalizeTelegramCommandName(spec.name);
    if (!normalized || !TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      runtime.error?.(
        danger(
          `Plugin command "/${spec.name}" is invalid for Telegram (use a-z, 0-9, underscore; max 32 chars).`,
        ),
      );
      continue;
    }
    const description = spec.description.trim();
    if (!description) {
      runtime.error?.(danger(`Plugin command "/${normalized}" is missing a description.`));
      continue;
    }
    if (existingCommands.has(normalized)) {
      runtime.error?.(
        danger(`Plugin command "/${normalized}" conflicts with an existing Telegram command.`),
      );
      continue;
    }
    if (pluginCommandNames.has(normalized)) {
      runtime.error?.(danger(`Plugin command "/${normalized}" is duplicated.`));
      continue;
    }
    pluginCommandNames.add(normalized);
    existingCommands.add(normalized);
    pluginCommands.push({ command: normalized, description });
  }
  // Subscription management commands
  const subscriptionCommands = [
    { command: "start", description: "Начать работу с ботом" },
    { command: "plan", description: "Показать текущий план и статистику" },
    { command: "subscribe", description: "Оформить подписку" },
  ];

  const allCommandsFull: Array<{ command: string; description: string }> = [
    ...subscriptionCommands,
    ...nativeCommands.map((command) => ({
      command: command.name,
      description: command.description,
    })),
    ...pluginCommands,
    ...customCommands,
  ];
  // Telegram Bot API limits commands to 100 per scope.
  // Truncate with a warning rather than failing with BOT_COMMANDS_TOO_MUCH.
  const TELEGRAM_MAX_COMMANDS = 100;
  if (allCommandsFull.length > TELEGRAM_MAX_COMMANDS) {
    runtime.log?.(
      `telegram: truncating ${allCommandsFull.length} commands to ${TELEGRAM_MAX_COMMANDS} (Telegram Bot API limit)`,
    );
  }
  const allCommands = allCommandsFull.slice(0, TELEGRAM_MAX_COMMANDS);

  // Clear stale commands before registering new ones to prevent
  // leftover commands from deleted skills persisting across restarts (#5717).
  // Chain delete → set so a late-resolving delete cannot wipe newly registered commands.
  const registerCommands = () => {
    if (allCommands.length > 0) {
      withTelegramApiErrorLogging({
        operation: "setMyCommands",
        runtime,
        fn: () => bot.api.setMyCommands(allCommands),
      }).catch(() => {});
    }
  };
  if (typeof bot.api.deleteMyCommands === "function") {
    const commandScopes: Array<
      undefined | { type: "all_private_chats" | "all_group_chats" | "all_chat_administrators" }
    > = [
      undefined,
      { type: "all_private_chats" },
      { type: "all_group_chats" },
      { type: "all_chat_administrators" },
    ];
    Promise.resolve()
      .then(async () => {
        for (const scope of commandScopes) {
          await withTelegramApiErrorLogging({
            operation: "deleteMyCommands",
            runtime,
            fn: () => (scope ? bot.api.deleteMyCommands({ scope }) : bot.api.deleteMyCommands()),
          }).catch(() => undefined);
        }
      })
      .then(registerCommands)
      .catch(() => {});
  } else {
    registerCommands();
  }

  if (allCommands.length > 0) {
    if (typeof (bot as unknown as { command?: unknown }).command !== "function") {
      logVerbose("telegram: bot.command unavailable; skipping native handlers");
    } else {
      for (const command of nativeCommands) {
        bot.command(command.name, async (ctx: TelegramNativeCommandContext) => {
          const msg = ctx.message;
          if (!msg) {
            return;
          }
          if (shouldSkipUpdate(ctx)) {
            return;
          }
          const auth = await resolveTelegramCommandAuth({
            msg,
            bot,
            cfg,
            telegramCfg,
            allowFrom,
            groupAllowFrom,
            useAccessGroups,
            resolveGroupPolicy,
            resolveTelegramGroupConfig,
            requireAuth: true,
          });
          if (!auth) {
            return;
          }
          const {
            chatId,
            isGroup,
            isForum,
            resolvedThreadId,
            senderId,
            senderUsername,
            groupConfig,
            topicConfig,
            commandAuthorized,
          } = auth;
          const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
          const threadSpec = resolveTelegramThreadSpec({
            isGroup,
            isForum,
            messageThreadId,
          });
          const threadParams = buildTelegramThreadParams(threadSpec) ?? {};

          const commandDefinition = findCommandByNativeName(command.name, "telegram");
          const rawText = ctx.match?.trim() ?? "";
          const commandArgs = commandDefinition
            ? parseCommandArgs(commandDefinition, rawText)
            : rawText
              ? ({ raw: rawText } satisfies CommandArgs)
              : undefined;
          const prompt = commandDefinition
            ? buildCommandTextFromArgs(commandDefinition, commandArgs)
            : rawText
              ? `/${command.name} ${rawText}`
              : `/${command.name}`;
          const menu = commandDefinition
            ? resolveCommandArgMenu({
                command: commandDefinition,
                args: commandArgs,
                cfg,
              })
            : null;
          if (menu && commandDefinition) {
            const title =
              menu.title ??
              `Choose ${menu.arg.description || menu.arg.name} for /${commandDefinition.nativeName ?? commandDefinition.key}.`;
            const rows: Array<Array<{ text: string; callback_data: string }>> = [];
            for (let i = 0; i < menu.choices.length; i += 2) {
              const slice = menu.choices.slice(i, i + 2);
              rows.push(
                slice.map((choice) => {
                  const args: CommandArgs = {
                    values: { [menu.arg.name]: choice.value },
                  };
                  return {
                    text: choice.label,
                    callback_data: buildCommandTextFromArgs(commandDefinition, args),
                  };
                }),
              );
            }
            const replyMarkup = buildInlineKeyboard(rows);
            await withTelegramApiErrorLogging({
              operation: "sendMessage",
              runtime,
              fn: () =>
                bot.api.sendMessage(chatId, title, {
                  ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                  ...threadParams,
                }),
            });
            return;
          }
          const parentPeer = buildTelegramParentPeer({ isGroup, resolvedThreadId, chatId });
          const route = resolveAgentRoute({
            cfg,
            channel: "telegram",
            accountId,
            peer: {
              kind: isGroup ? "group" : "direct",
              id: isGroup ? buildTelegramGroupPeerId(chatId, resolvedThreadId) : String(chatId),
            },
            parentPeer,
          });
          const baseSessionKey = route.sessionKey;
          // DMs: use raw messageThreadId for thread sessions (not resolvedThreadId which is for forums)
          const dmThreadId = threadSpec.scope === "dm" ? threadSpec.id : undefined;
          const threadKeys =
            dmThreadId != null
              ? resolveThreadSessionKeys({
                  baseSessionKey,
                  threadId: String(dmThreadId),
                })
              : null;
          const sessionKey = threadKeys?.sessionKey ?? baseSessionKey;
          const tableMode = resolveMarkdownTableMode({
            cfg,
            channel: "telegram",
            accountId: route.accountId,
          });
          const skillFilter = firstDefined(topicConfig?.skills, groupConfig?.skills);
          const systemPromptParts = [
            groupConfig?.systemPrompt?.trim() || null,
            topicConfig?.systemPrompt?.trim() || null,
          ].filter((entry): entry is string => Boolean(entry));
          const groupSystemPrompt =
            systemPromptParts.length > 0 ? systemPromptParts.join("\n\n") : undefined;
          const conversationLabel = isGroup
            ? msg.chat.title
              ? `${msg.chat.title} id:${chatId}`
              : `group:${chatId}`
            : (buildSenderName(msg) ?? String(senderId || chatId));
          const ctxPayload = finalizeInboundContext({
            Body: prompt,
            BodyForAgent: prompt,
            RawBody: prompt,
            CommandBody: prompt,
            CommandArgs: commandArgs,
            From: isGroup ? buildTelegramGroupFrom(chatId, resolvedThreadId) : `telegram:${chatId}`,
            To: `slash:${senderId || chatId}`,
            ChatType: isGroup ? "group" : "direct",
            ConversationLabel: conversationLabel,
            GroupSubject: isGroup ? (msg.chat.title ?? undefined) : undefined,
            GroupSystemPrompt: isGroup ? groupSystemPrompt : undefined,
            SenderName: buildSenderName(msg),
            SenderId: senderId || undefined,
            SenderUsername: senderUsername || undefined,
            Surface: "telegram",
            MessageSid: String(msg.message_id),
            Timestamp: msg.date ? msg.date * 1000 : undefined,
            WasMentioned: true,
            CommandAuthorized: commandAuthorized,
            CommandSource: "native" as const,
            SessionKey: `telegram:slash:${senderId || chatId}`,
            AccountId: route.accountId,
            CommandTargetSessionKey: sessionKey,
            MessageThreadId: threadSpec.id,
            IsForum: isForum,
            // Originating context for sub-agent announce routing
            OriginatingChannel: "telegram" as const,
            OriginatingTo: `telegram:${chatId}`,
          });

          const disableBlockStreaming =
            typeof telegramCfg.blockStreaming === "boolean"
              ? !telegramCfg.blockStreaming
              : undefined;
          const chunkMode = resolveChunkMode(cfg, "telegram", route.accountId);

          const deliveryState = {
            delivered: false,
            skippedNonSilent: 0,
          };

          const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
            cfg,
            agentId: route.agentId,
            channel: "telegram",
            accountId: route.accountId,
          });

          await dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
              ...prefixOptions,
              deliver: async (payload, _info) => {
                const result = await deliverReplies({
                  replies: [payload],
                  chatId: String(chatId),
                  token: opts.token,
                  runtime,
                  bot,
                  replyToMode,
                  textLimit,
                  thread: threadSpec,
                  tableMode,
                  chunkMode,
                  linkPreview: telegramCfg.linkPreview,
                });
                if (result.delivered) {
                  deliveryState.delivered = true;
                }
              },
              onSkip: (_payload, info) => {
                if (info.reason !== "silent") {
                  deliveryState.skippedNonSilent += 1;
                }
              },
              onError: (err, info) => {
                runtime.error?.(danger(`telegram slash ${info.kind} reply failed: ${String(err)}`));
              },
            },
            replyOptions: {
              skillFilter,
              disableBlockStreaming,
              onModelSelected,
            },
          });
          if (!deliveryState.delivered && deliveryState.skippedNonSilent > 0) {
            await deliverReplies({
              replies: [{ text: EMPTY_RESPONSE_FALLBACK }],
              chatId: String(chatId),
              token: opts.token,
              runtime,
              bot,
              replyToMode,
              textLimit,
              thread: threadSpec,
              tableMode,
              chunkMode,
              linkPreview: telegramCfg.linkPreview,
            });
          }
        });
      }

      for (const pluginCommand of pluginCommands) {
        bot.command(pluginCommand.command, async (ctx: TelegramNativeCommandContext) => {
          const msg = ctx.message;
          if (!msg) {
            return;
          }
          if (shouldSkipUpdate(ctx)) {
            return;
          }
          const chatId = msg.chat.id;
          const rawText = ctx.match?.trim() ?? "";
          const commandBody = `/${pluginCommand.command}${rawText ? ` ${rawText}` : ""}`;
          const match = matchPluginCommand(commandBody);
          if (!match) {
            await withTelegramApiErrorLogging({
              operation: "sendMessage",
              runtime,
              fn: () => bot.api.sendMessage(chatId, "Command not found."),
            });
            return;
          }
          const auth = await resolveTelegramCommandAuth({
            msg,
            bot,
            cfg,
            telegramCfg,
            allowFrom,
            groupAllowFrom,
            useAccessGroups,
            resolveGroupPolicy,
            resolveTelegramGroupConfig,
            requireAuth: match.command.requireAuth !== false,
          });
          if (!auth) {
            return;
          }
          const { senderId, commandAuthorized, isGroup, isForum } = auth;
          const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
          const threadSpec = resolveTelegramThreadSpec({
            isGroup,
            isForum,
            messageThreadId,
          });
          const from = isGroup
            ? buildTelegramGroupFrom(chatId, threadSpec.id)
            : `telegram:${chatId}`;
          const to = `telegram:${chatId}`;

          const result = await executePluginCommand({
            command: match.command,
            args: match.args,
            senderId,
            channel: "telegram",
            isAuthorizedSender: commandAuthorized,
            commandBody,
            config: cfg,
            from,
            to,
            accountId,
            messageThreadId: threadSpec.id,
          });
          const tableMode = resolveMarkdownTableMode({
            cfg,
            channel: "telegram",
            accountId,
          });
          const chunkMode = resolveChunkMode(cfg, "telegram", accountId);

          await deliverReplies({
            replies: [result],
            chatId: String(chatId),
            token: opts.token,
            runtime,
            bot,
            replyToMode,
            textLimit,
            thread: threadSpec,
            tableMode,
            chunkMode,
            linkPreview: telegramCfg.linkPreview,
          });
        });
      }
    }
  } else if (nativeDisabledExplicit) {
    withTelegramApiErrorLogging({
      operation: "setMyCommands",
      runtime,
      fn: () => bot.api.setMyCommands([]),
    }).catch(() => {});
  }

  // Register subscription management commands
  const ensureSubscriptionUser = async (ctx: Context, userId: number) => {
    const adminUser = isAdmin(userId, adminIds);
    const existing = await userStore.getUser(userId);
    if (existing) {
      if (adminUser && (existing.role !== "owner" || existing.trialExpiresAt != null)) {
        return await userStore.updateUser(userId, {
          role: "owner",
          trialExpiresAt: null,
        });
      }
      return existing;
    }
    return await userStore.createUser({
      telegramUserId: userId,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      username: ctx.from?.username,
      role: adminUser ? "owner" : "trial",
    });
  };

  // /start command
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    try {
      const user = await ensureSubscriptionUser(ctx, userId);

      const remaining = getRemainingMessages(user);
      const remainingText =
        remaining === "unlimited" ? "безлимит" : `${remaining} сообщений в день`;

      let message = "✅ Добро пожаловать в OpenClaw!\n\n";

      if (user.role === "trial") {
        const expiresDate = user.trialExpiresAt
          ? new Date(user.trialExpiresAt).toLocaleDateString("ru-RU")
          : "н/д";
        message += `Вам доступен бесплатный trial на 7 дней:\n📨 ${remainingText}\n⏱ До ${expiresDate}\n\nПопробуйте: напишите мне любой вопрос!`;
      } else if (user.role === "owner") {
        message += `📊 Ваш план: Owner\n\n⏱ Срок действия: бессрочно\n📨 Лимит: безлимит\n🤖 Модель: лучшая доступная`;
      } else if (user.role === "vip" || user.role === "subscriber") {
        message += `📊 Ваш план: ${user.role === "vip" ? "VIP" : "Подписка"}\n\n⏱ Срок действия: активна\n📨 Лимит: ${remainingText}\n🤖 Модель: продвинутая`;
      } else {
        message += `📊 Ваш план: ${user.role}\n\n📨 Доступно: ${remainingText}`;
      }

      await ctx.reply(message);
    } catch (err) {
      runtime.error?.(`telegram /start command failed: ${String(err)}`);
      await ctx.reply("Произошла ошибка. Попробуйте позже.");
    }
  });

  // /plan command
  bot.command("plan", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    try {
      const user = await ensureSubscriptionUser(ctx, userId);

      const remaining = getRemainingMessages(user);
      const remainingText =
        remaining === "unlimited" ? "безлимит" : `${remaining} сообщений сегодня`;

      let message = `📊 Ваш текущий план\n\n`;

      if (user.role === "owner") {
        message += `🎯 План: Owner\n⏱ Срок действия: бессрочно\n📨 Лимит: безлимит\n🤖 Модель: лучшая доступная`;
      } else if (user.role === "vip") {
        message += `🎯 План: VIP\n📨 Осталось: ${remainingText}\n🤖 Модель: продвинутая`;
      } else if (user.role === "subscriber") {
        const expiresDate = user.subscriptionExpiresAt
          ? new Date(user.subscriptionExpiresAt).toLocaleDateString("ru-RU")
          : "активна";
        message += `🎯 План: Подписка\n⏱ До: ${expiresDate}\n📨 Осталось: ${remainingText}\n🤖 Модель: продвинутая`;
      } else if (user.role === "trial") {
        const expiresDate = user.trialExpiresAt
          ? new Date(user.trialExpiresAt).toLocaleDateString("ru-RU")
          : "н/д";
        message += `🎯 План: Trial (пробный)\n⏱ До: ${expiresDate}\n📨 Осталось: ${remainingText}`;
      } else {
        message += `🎯 План: ${user.role}\n📨 Осталось: ${remainingText}`;
      }

      message += `\n\n📈 Статистика:\n📨 Всего сообщений: ${user.totalMessagesUsed}`;

      await ctx.reply(message);
    } catch (err) {
      runtime.error?.(`telegram /plan command failed: ${String(err)}`);
      await ctx.reply("Произошла ошибка. Попробуйте позже.");
    }
  });

  // /subscribe command
  bot.command("subscribe", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    try {
      const user = await ensureSubscriptionUser(ctx, userId);
      if (user.role === "owner") {
        await ctx.reply("У вас уже план Owner. Подписка не требуется.");
        return;
      }

      const starter = SUBSCRIPTION_PRICING.starter;
      const premium = SUBSCRIPTION_PRICING.premium;
      const message =
        "💳 Подписка на OpenClaw\n\n" +
        `Выберите тариф (${SUBSCRIPTION_PERIOD_DAYS} дней):\n` +
        `🌟 Starter — ${starter.stars} XTR\n` +
        "  • 30 сообщений в день\n" +
        "  • Базовые модели\n\n" +
        `💎 Premium — ${premium.stars} XTR\n` +
        "  • Безлимитные сообщения\n" +
        "  • Продвинутые модели\n\n" +
        "Нажмите кнопку тарифа ниже, чтобы получить инвойс в Telegram Stars.";

      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [{ text: `Starter — ${starter.stars} XTR`, callback_data: "subscribe_starter" }],
            [{ text: `Premium — ${premium.stars} XTR`, callback_data: "subscribe_premium" }],
          ],
        },
      });
    } catch (err) {
      runtime.error?.(`telegram /subscribe command failed: ${String(err)}`);
      await ctx.reply("Произошла ошибка. Попробуйте позже.");
    }
  });

  if (typeof (bot as unknown as { callbackQuery?: unknown }).callbackQuery === "function") {
    bot.callbackQuery(/^subscribe_(starter|premium)$/, async (ctx) => {
      if (shouldSkipUpdate(ctx)) {
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.answerCallbackQuery({
          text: "Не удалось определить пользователя.",
          show_alert: true,
        });
        return;
      }

      const data = ctx.callbackQuery?.data ?? "";
      const suffix = data.replace("subscribe_", "");
      const plan: SubscriptionPlan | null =
        suffix === "starter" || suffix === "premium" ? suffix : null;
      if (!plan) {
        await ctx.answerCallbackQuery({ text: "Неверный тариф.", show_alert: true });
        return;
      }

      try {
        await ensureSubscriptionUser(ctx, userId);
        const pricing = SUBSCRIPTION_PRICING[plan];
        const payload = buildSubscriptionInvoicePayload({
          accountId,
          userId,
          plan,
        });

        await ctx.answerCallbackQuery();
        await withTelegramApiErrorLogging({
          operation: "sendInvoice",
          runtime,
          fn: () =>
            bot.api.sendInvoice(userId, pricing.title, pricing.description, payload, "XTR", [
              { label: pricing.label, amount: pricing.stars },
            ]),
        });
      } catch (err) {
        runtime.error?.(`telegram subscribe callback failed: ${String(err)}`);
        await ctx.answerCallbackQuery({
          text: "Не удалось создать инвойс. Попробуйте позже.",
          show_alert: true,
        });
      }
    });
  }

  if (typeof (bot as unknown as { on?: unknown }).on === "function") {
    bot.on("pre_checkout_query", async (ctx) => {
      if (shouldSkipUpdate(ctx)) {
        return;
      }

      const query = ctx.preCheckoutQuery;
      const payload = parseSubscriptionInvoicePayload(query.invoice_payload);
      if (!payload) {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "Некорректные данные платежа.",
        });
        return;
      }

      if (query.currency !== "XTR") {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "Поддерживается только оплата в Telegram Stars (XTR).",
        });
        return;
      }

      if (payload.accountId !== accountId) {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "Инвойс создан для другого аккаунта бота.",
        });
        return;
      }

      if (payload.userId !== query.from.id) {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "Платеж может оплатить только получатель инвойса.",
        });
        return;
      }

      const pricing = SUBSCRIPTION_PRICING[payload.plan];
      if (query.total_amount !== pricing.stars) {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: "Сумма платежа не совпадает с выбранным тарифом.",
        });
        return;
      }

      await ctx.answerPreCheckoutQuery(true);
    });

    bot.on("message:successful_payment", async (ctx) => {
      if (shouldSkipUpdate(ctx)) {
        return;
      }

      const userId = ctx.from?.id;
      if (!userId) {
        return;
      }

      const payment = ctx.message.successful_payment;
      const payload = parseSubscriptionInvoicePayload(payment.invoice_payload);
      if (!payload) {
        runtime.error?.("telegram successful_payment: invalid invoice payload");
        await ctx.reply("✅ Платеж получен. Обратитесь к администратору для проверки активации.");
        return;
      }

      const pricing = SUBSCRIPTION_PRICING[payload.plan];
      if (payment.currency !== "XTR" || payment.total_amount !== pricing.stars) {
        runtime.error?.(
          `telegram successful_payment mismatch: currency=${payment.currency} amount=${payment.total_amount} plan=${payload.plan}`,
        );
        await ctx.reply("✅ Платеж получен. Обратитесь к администратору для проверки активации.");
        return;
      }

      try {
        const user = await ensureSubscriptionUser(ctx, payload.userId);
        const now = Date.now();
        const currentExpiry =
          typeof user.subscriptionExpiresAt === "number" ? user.subscriptionExpiresAt : null;
        const baseTs = currentExpiry && currentExpiry > now ? currentExpiry : now;
        const nextExpiry = baseTs + SUBSCRIPTION_PERIOD_MS;

        await userStore.updateUser(payload.userId, {
          role: "subscriber",
          subscriptionPlan: payload.plan,
          subscriptionExpiresAt: nextExpiry,
          subscriptionChargeId: payment.telegram_payment_charge_id,
          autoRenew: true,
        });

        await ctx.reply(
          `✅ Подписка активирована!\n\n` +
            `🎯 Тариф: ${payload.plan === "premium" ? "Premium" : "Starter"}\n` +
            `⏱ До: ${new Date(nextExpiry).toLocaleDateString("ru-RU")}\n` +
            `🔄 Автопродление: включено`,
        );
      } catch (err) {
        runtime.error?.(`telegram successful_payment failed: ${String(err)}`);
        await ctx.reply("✅ Платеж получен. Подписка будет активирована в ближайшее время.");
      }
    });
  }
};
