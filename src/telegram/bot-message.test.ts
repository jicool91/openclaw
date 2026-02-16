import { beforeEach, describe, expect, it, vi } from "vitest";

const buildTelegramMessageContext = vi.hoisted(() => vi.fn());
const dispatchTelegramMessage = vi.hoisted(() => vi.fn());

vi.mock("./bot-message-context.js", () => ({
  buildTelegramMessageContext,
}));

vi.mock("./bot-message-dispatch.js", () => ({
  dispatchTelegramMessage,
}));

import { createTelegramMessageProcessor } from "./bot-message.js";

describe("telegram bot message processor", () => {
  beforeEach(() => {
    buildTelegramMessageContext.mockReset();
    dispatchTelegramMessage.mockReset();
  });

  const buildUserStoreStub = () => ({
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
  });

  const baseDeps = {
    bot: { api: { sendMessage: vi.fn().mockResolvedValue(undefined) } },
    cfg: {},
    account: {},
    telegramCfg: {},
    historyLimit: 0,
    groupHistories: {},
    dmPolicy: {},
    allowFrom: [],
    groupAllowFrom: [],
    ackReactionScope: "none",
    logger: {},
    resolveGroupActivation: () => true,
    resolveGroupRequireMention: () => false,
    resolveTelegramGroupConfig: () => ({}),
    runtime: {},
    replyToMode: "auto",
    streamMode: "auto",
    textLimit: 4096,
    opts: {},
    resolveBotTopicsEnabled: () => false,
    userStore: buildUserStoreStub(),
  };

  it("dispatches when context is available", async () => {
    buildTelegramMessageContext.mockResolvedValue({ route: { sessionKey: "agent:main:main" } });

    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processMessage({ message: { chat: { id: 123 }, message_id: 456 } }, [], [], {});

    expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("skips dispatch when no context is produced", async () => {
    buildTelegramMessageContext.mockResolvedValue(null);
    const processMessage = createTelegramMessageProcessor(baseDeps);
    await processMessage({ message: { chat: { id: 123 }, message_id: 456 } }, [], [], {});
    expect(dispatchTelegramMessage).not.toHaveBeenCalled();
  });

  it("creates owner role for admin user on first private message", async () => {
    const previousAdminIds = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = "8521810561";
    try {
      buildTelegramMessageContext.mockResolvedValue({ route: { sessionKey: "agent:main:main" } });
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
      userStore.createUser = createUser;
      const processMessage = createTelegramMessageProcessor({
        ...baseDeps,
        userStore,
      });

      await processMessage(
        {
          message: {
            chat: { id: 8521810561, type: "private" },
            from: { id: 8521810561, first_name: "Dmitriy", username: "jicool" },
            message_id: 1,
          },
        },
        [],
        [],
        {},
      );

      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          telegramUserId: 8521810561,
          role: "owner",
        }),
      );
      expect(userStore.incrementUsage).toHaveBeenCalledWith(8521810561, 0, 0);
      expect(dispatchTelegramMessage).toHaveBeenCalledTimes(1);
    } finally {
      if (typeof previousAdminIds === "undefined") {
        delete process.env.ADMIN_TELEGRAM_IDS;
      } else {
        process.env.ADMIN_TELEGRAM_IDS = previousAdminIds;
      }
    }
  });
});
