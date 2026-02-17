import { describe, expect, it } from "vitest";
import type { UserRecord } from "./user-store.types.js";
import {
  formatExpirationDate,
  getDaysUntilExpiration,
  getRoleLimits,
  getRoleMessageLimit,
  getUserDisplayStatus,
  hasActiveTrial,
  hasActiveSubscription,
  hasUnlimitedAccess,
  isOwner,
} from "./user-roles.js";

describe("user-roles", () => {
  describe("getRoleMessageLimit", () => {
    it("returns unlimited for owner", () => {
      expect(getRoleMessageLimit("owner")).toBe("unlimited");
    });

    it("returns unlimited for vip", () => {
      expect(getRoleMessageLimit("vip")).toBe("unlimited");
    });

    it("returns unlimited for subscriber", () => {
      expect(getRoleMessageLimit("subscriber")).toBe("unlimited");
    });

    it("returns 30 for trial", () => {
      expect(getRoleMessageLimit("trial")).toBe(30);
    });

    it("returns 2 for expired", () => {
      expect(getRoleMessageLimit("expired")).toBe(2);
    });
  });

  describe("getRoleLimits", () => {
    it("returns full limits for owner", () => {
      const limits = getRoleLimits("owner");
      expect(limits).toEqual({
        messagesPerDay: "unlimited",
        canUseTools: true,
        canUseWebSearch: true,
        modelTier: "best",
      });
    });

    it("returns limited access for trial", () => {
      const limits = getRoleLimits("trial");
      expect(limits).toEqual({
        messagesPerDay: 30,
        canUseTools: false,
        canUseWebSearch: true,
        modelTier: "medium",
      });
    });

    it("returns minimal access for expired", () => {
      const limits = getRoleLimits("expired");
      expect(limits).toEqual({
        messagesPerDay: 2,
        canUseTools: false,
        canUseWebSearch: false,
        modelTier: "basic",
      });
    });
  });

  describe("hasUnlimitedAccess", () => {
    it("returns true for owner", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasUnlimitedAccess(user)).toBe(true);
    });

    it("returns true for vip", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "vip",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasUnlimitedAccess(user)).toBe(true);
    });

    it("returns false for trial", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasUnlimitedAccess(user)).toBe(false);
    });
  });

  describe("isOwner", () => {
    it("returns true for owner role", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(isOwner(user)).toBe(true);
    });

    it("returns false for non-owner roles", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(isOwner(user)).toBe(false);
    });
  });

  describe("hasActiveTrial", () => {
    it("returns true for active trial", () => {
      const futureDate = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        trialExpiresAt: futureDate,
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasActiveTrial(user)).toBe(true);
    });

    it("returns false for expired trial", () => {
      const pastDate = Date.now() - 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        createdAt: Date.now(),
        trialExpiresAt: pastDate,
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasActiveTrial(user)).toBe(false);
    });

    it("returns false for non-trial role", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasActiveTrial(user)).toBe(false);
    });
  });

  describe("hasActiveSubscription", () => {
    it("returns true for active subscription", () => {
      const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "subscriber",
        createdAt: Date.now(),
        subscriptionExpiresAt: futureDate,
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasActiveSubscription(user)).toBe(true);
    });

    it("returns false for expired subscription", () => {
      const pastDate = Date.now() - 1000;
      const user: UserRecord = {
        telegramUserId: 123,
        role: "subscriber",
        createdAt: Date.now(),
        subscriptionExpiresAt: pastDate,
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(hasActiveSubscription(user)).toBe(false);
    });
  });

  describe("getUserDisplayStatus", () => {
    it("returns Owner for owner role", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "owner",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(getUserDisplayStatus(user)).toBe("Owner");
    });

    it("returns Premium Subscriber for premium plan", () => {
      const user: UserRecord = {
        telegramUserId: 123,
        role: "subscriber",
        subscriptionPlan: "premium",
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(getUserDisplayStatus(user)).toBe("Premium Subscriber");
    });

    it("shows remaining days for active trial", () => {
      const futureDate = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days
      const user: UserRecord = {
        telegramUserId: 123,
        role: "trial",
        trialExpiresAt: futureDate,
        createdAt: Date.now(),
        messagesUsedToday: 0,
        lastMessageDate: "2026-02-16",
        totalMessagesUsed: 0,
        totalTokensUsed: 0,
        totalCostUsd: 0,
      };
      expect(getUserDisplayStatus(user)).toMatch(/Trial \(\d days left\)/);
    });
  });

  describe("formatExpirationDate", () => {
    it("formats timestamp to YYYY-MM-DD", () => {
      const timestamp = new Date("2026-03-15T12:00:00Z").getTime();
      expect(formatExpirationDate(timestamp)).toBe("2026-03-15");
    });

    it("returns null for undefined", () => {
      expect(formatExpirationDate(undefined)).toBeNull();
    });

    it("returns null for null", () => {
      expect(formatExpirationDate(null)).toBeNull();
    });
  });

  describe("getDaysUntilExpiration", () => {
    it("calculates days until expiration", () => {
      const futureDate = Date.now() + 5 * 24 * 60 * 60 * 1000;
      const days = getDaysUntilExpiration(futureDate);
      expect(days).toBe(5);
    });

    it("returns 0 for past dates", () => {
      const pastDate = Date.now() - 1000;
      expect(getDaysUntilExpiration(pastDate)).toBe(0);
    });

    it("returns null for undefined", () => {
      expect(getDaysUntilExpiration(undefined)).toBeNull();
    });
  });
});
