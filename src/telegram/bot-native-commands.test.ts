import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { TelegramAccountConfig } from "../config/types.js";
import type { RuntimeEnv } from "../runtime.js";
import { registerTelegramNativeCommands } from "./bot-native-commands.js";

const { listSkillCommandsForAgents } = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));

vi.mock("../auto-reply/skill-commands.js", () => ({
  listSkillCommandsForAgents,
}));

describe("registerTelegramNativeCommands", () => {
  beforeEach(() => {
    listSkillCommandsForAgents.mockReset();
  });

  const buildUserStoreStub = () =>
    ({
      getUser: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue({
        telegramUserId: 1,
        role: "trial",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      }),
      updateUser: vi.fn(),
      incrementUsage: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Parameters<typeof registerTelegramNativeCommands>[0]["userStore"];

  const buildParams = (cfg: OpenClawConfig, accountId = "default") => ({
    bot: {
      api: {
        setMyCommands: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      command: vi.fn(),
    } as unknown as Parameters<typeof registerTelegramNativeCommands>[0]["bot"],
    cfg,
    runtime: {} as RuntimeEnv,
    accountId,
    telegramCfg: {} as TelegramAccountConfig,
    allowFrom: [],
    groupAllowFrom: [],
    replyToMode: "off" as const,
    textLimit: 4096,
    useAccessGroups: false,
    nativeEnabled: true,
    nativeSkillsEnabled: true,
    nativeDisabledExplicit: false,
    resolveGroupPolicy: () => ({ allowlistEnabled: false, allowed: true }),
    resolveTelegramGroupConfig: () => ({
      groupConfig: undefined,
      topicConfig: undefined,
    }),
    shouldSkipUpdate: () => false,
    opts: { token: "token" },
    userStore: buildUserStoreStub(),
  });

  it("scopes skill commands when account binding exists", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true }, { id: "butler" }],
      },
      bindings: [
        {
          agentId: "butler",
          match: { channel: "telegram", accountId: "bot-a" },
        },
      ],
    };

    registerTelegramNativeCommands(buildParams(cfg, "bot-a"));

    expect(listSkillCommandsForAgents).toHaveBeenCalledWith({
      cfg,
      agentIds: ["butler"],
    });
  });

  it("keeps skill commands unscoped without a matching binding", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true }, { id: "butler" }],
      },
    };

    registerTelegramNativeCommands(buildParams(cfg, "bot-a"));

    expect(listSkillCommandsForAgents).toHaveBeenCalledWith({ cfg });
  });

  it("truncates Telegram command registration to 100 commands", () => {
    const cfg: OpenClawConfig = {
      commands: { native: false },
    };
    const customCommands = Array.from({ length: 120 }, (_, index) => ({
      command: `cmd_${index}`,
      description: `Command ${index}`,
    }));
    const setMyCommands = vi.fn().mockResolvedValue(undefined);
    const runtimeLog = vi.fn();

    registerTelegramNativeCommands({
      ...buildParams(cfg),
      bot: {
        api: {
          setMyCommands,
          sendMessage: vi.fn().mockResolvedValue(undefined),
        },
        command: vi.fn(),
      } as unknown as Parameters<typeof registerTelegramNativeCommands>[0]["bot"],
      runtime: { log: runtimeLog } as RuntimeEnv,
      telegramCfg: { customCommands } as TelegramAccountConfig,
      nativeEnabled: false,
      nativeSkillsEnabled: false,
    });

    const registeredCommands = setMyCommands.mock.calls[0]?.[0] as Array<{
      command: string;
      description: string;
    }>;
    expect(registeredCommands).toHaveLength(100);
    expect(registeredCommands).toEqual([
      { command: "start", description: "Начать работу с ботом" },
      { command: "plan", description: "Показать текущий план и статистику" },
      { command: "subscribe", description: "Оформить подписку" },
      ...customCommands.slice(0, 97),
    ]);
    expect(runtimeLog).toHaveBeenCalledWith(
      "telegram: truncating 123 commands to 100 (Telegram Bot API limit)",
    );
  });

  it("creates owner role for ADMIN_TELEGRAM_IDS user on /start", async () => {
    const previousAdminIds = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = "8521810561";
    try {
      const handlers: Record<string, (ctx: unknown) => Promise<void>> = {};
      const userStore = buildUserStoreStub();
      const createUser = vi.fn().mockResolvedValue({
        telegramUserId: 8521810561,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      });
      userStore.createUser = createUser as never;

      registerTelegramNativeCommands({
        ...buildParams({}, "default"),
        nativeEnabled: false,
        nativeSkillsEnabled: false,
        bot: {
          api: {
            setMyCommands: vi.fn().mockResolvedValue(undefined),
            sendMessage: vi.fn().mockResolvedValue(undefined),
          },
          command: vi.fn((name: string, handler: (ctx: unknown) => Promise<void>) => {
            handlers[name] = handler;
          }),
        } as unknown as Parameters<typeof registerTelegramNativeCommands>[0]["bot"],
        userStore,
      });

      const reply = vi.fn().mockResolvedValue(undefined);
      await handlers.start?.({
        from: {
          id: 8521810561,
          first_name: "Dmitriy",
          username: "jicool",
        },
        reply,
      });

      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramUserId: 8521810561,
          role: "owner",
        }),
      );
      expect(reply).toHaveBeenCalledWith(expect.stringContaining("план: Owner"));
    } finally {
      if (typeof previousAdminIds === "undefined") {
        delete process.env.ADMIN_TELEGRAM_IDS;
      } else {
        process.env.ADMIN_TELEGRAM_IDS = previousAdminIds;
      }
    }
  });
});
