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

  it("drops messages from non-admin users when ADMIN_TELEGRAM_IDS is set", async () => {
    const previousAdminIds = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = "8521810561,123456789";
    try {
      buildTelegramMessageContext.mockResolvedValue({ route: { sessionKey: "agent:main:main" } });
      const processMessage = createTelegramMessageProcessor(baseDeps);

      await processMessage(
        {
          message: {
            chat: { id: 200, type: "private" },
            from: { id: 999999, first_name: "Other" },
            message_id: 7,
          },
        },
        [],
        [],
        {},
      );

      expect(buildTelegramMessageContext).not.toHaveBeenCalled();
      expect(dispatchTelegramMessage).not.toHaveBeenCalled();
    } finally {
      if (typeof previousAdminIds === "undefined") {
        delete process.env.ADMIN_TELEGRAM_IDS;
      } else {
        process.env.ADMIN_TELEGRAM_IDS = previousAdminIds;
      }
    }
  });

  it("allows messages from admin users when ADMIN_TELEGRAM_IDS is set", async () => {
    const previousAdminIds = process.env.ADMIN_TELEGRAM_IDS;
    process.env.ADMIN_TELEGRAM_IDS = "8521810561,123456789";
    try {
      buildTelegramMessageContext.mockResolvedValue({ route: { sessionKey: "agent:main:main" } });
      const processMessage = createTelegramMessageProcessor(baseDeps);

      await processMessage(
        {
          message: {
            chat: { id: 8521810561, type: "private" },
            from: { id: 8521810561, first_name: "Dmitriy", username: "jicool" },
            message_id: 8,
          },
        },
        [],
        [],
        {},
      );

      expect(buildTelegramMessageContext).toHaveBeenCalledTimes(1);
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
