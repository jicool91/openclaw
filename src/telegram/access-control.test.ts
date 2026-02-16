import { describe, expect, it } from "vitest";
import type { UserRecord } from "./user-store.types.js";
import {
  canSendMessage,
  formatAccessDeniedMessage,
  getRemainingMessages,
} from "./access-control.js";

describe("access-control", () => {
  const today = new Date().toISOString().split("T")[0];

  describe("canSendMessage", () => {
    it("allows owner to send unlimited messages", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 999,
        lastMessageDate: today,
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(true);
    });

    it("allows vip to send unlimited messages", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "vip",
        createdAt: Date.now(),
        messagesUsedToday: 999,
        lastMessageDate: today,
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(true);
    });

    it("blocks trial user when limit exceeded", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        trialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
        messagesUsedToday: 5,
        lastMessageDate: today,
        totalMessagesUsed: 5,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("limit_exceeded");
      }
    });

    it("allows trial user within limit", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        trialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
        messagesUsedToday: 3,
        lastMessageDate: today,
        totalMessagesUsed: 3,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(true);
    });

    it("blocks trial user when trial expired", () => {
      const pastDate = Date.now() - 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        trialExpiresAt: pastDate,
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: today,
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("trial_expired");
      }
    });

    it("blocks subscription when expired", () => {
      const pastDate = Date.now() - 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "subscriber",
        subscriptionExpiresAt: pastDate,
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: today,
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("subscription_expired");
      }
    });

    it("allows expired user within minimal limit", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "expired",
        createdAt: Date.now(),
        messagesUsedToday: 1,
        lastMessageDate: today,
        totalMessagesUsed: 1,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(true);
    });

    it("blocks expired user when minimal limit exceeded", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "expired",
        createdAt: Date.now(),
        messagesUsedToday: 2,
        lastMessageDate: today,
        totalMessagesUsed: 2,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("limit_exceeded");
      }
    });

    it("resets counter for new day", () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        trialExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        createdAt: Date.now(),
        messagesUsedToday: 5, // Hit limit yesterday
        lastMessageDate: yesterdayStr,
        totalMessagesUsed: 5,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      const result = canSendMessage(user);
      expect(result.allowed).toBe(true); // Should be allowed on new day
    });
  });

  describe("getRemainingMessages", () => {
    it("returns unlimited for owner", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: today,
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      expect(getRemainingMessages(user)).toBe("unlimited");
    });

    it("calculates remaining for trial user", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        messagesUsedToday: 3,
        lastMessageDate: today,
        totalMessagesUsed: 3,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      expect(getRemainingMessages(user)).toBe(2); // 5 - 3 = 2
    });

    it("returns 0 when limit reached", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "expired",
        createdAt: Date.now(),
        messagesUsedToday: 2,
        lastMessageDate: today,
        totalMessagesUsed: 2,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      expect(getRemainingMessages(user)).toBe(0);
    });

    it("resets remaining for new day", () => {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        messagesUsedToday: 5,
        lastMessageDate: yesterdayStr,
        totalMessagesUsed: 5,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };

      expect(getRemainingMessages(user)).toBe(5); // Full limit on new day
    });
  });

  describe("formatAccessDeniedMessage", () => {
    it("formats limit exceeded message", () => {
      const result = {
        allowed: false as const,
        reason: "limit_exceeded" as const,
        remaining: 0,
        resetsAt: new Date("2026-02-17T00:00:00Z").toISOString(),
      };

      const message = formatAccessDeniedMessage(result);
      expect(message).toContain("дневного лимита");
      expect(message).toContain("/subscribe");
    });

    it("formats trial expired message", () => {
      const result = {
        allowed: false as const,
        reason: "trial_expired" as const,
        expiresAt: new Date().toISOString(),
      };

      const message = formatAccessDeniedMessage(result);
      expect(message).toContain("пробный период истек");
      expect(message).toContain("/subscribe");
    });

    it("formats subscription expired message", () => {
      const result = {
        allowed: false as const,
        reason: "subscription_expired" as const,
        expiresAt: new Date().toISOString(),
      };

      const message = formatAccessDeniedMessage(result);
      expect(message).toContain("подписка истекла");
      expect(message).toContain("/subscribe");
    });

    it("returns empty string for allowed access", () => {
      const result = { allowed: true as const };
      expect(formatAccessDeniedMessage(result)).toBe("");
    });
  });
});
