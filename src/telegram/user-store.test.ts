import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { UserStore } from "./user-store.js";

describe("UserStore", () => {
  const testDataDir = join(process.cwd(), "test-data", "user-store");
  let store: UserStore;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testDataDir)) {
      await rm(testDataDir, { recursive: true, force: true });
    }
    await mkdir(testDataDir, { recursive: true });

    store = new UserStore(testDataDir);

    // Return cleanup function (best practice from Vitest docs)
    return async () => {
      if (existsSync(testDataDir)) {
        await rm(testDataDir, { recursive: true, force: true });
      }
    };
  });

  describe("createUser", () => {
    it("creates a new trial user with default settings", async () => {
      const user = await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
        username: "johndoe",
      });

      expect(user.telegramUserId).toBe(123456);
      expect(user.firstName).toBe("John");
      expect(user.username).toBe("johndoe");
      expect(user.role).toBe("trial");
      expect(user.messagesUsedToday).toBe(0);
      expect(user.totalMessagesUsed).toBe(0);
      expect(user.trialExpiresAt).toBeDefined();
      expect(user.createdAt).toBeDefined();
    });

    it("creates an owner user", async () => {
      const user = await store.createUser({
        telegramUserId: 999999,
        firstName: "Admin",
        role: "owner",
      });

      expect(user.role).toBe("owner");
      expect(user.trialExpiresAt).toBeUndefined();
    });

    it("throws error if user already exists", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      await expect(
        store.createUser({
          telegramUserId: 123456,
          firstName: "John",
        }),
      ).rejects.toThrow("already exists");
    });

    it("sets trial expiration 7 days in future by default", async () => {
      const before = Date.now();
      const user = await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });
      const after = Date.now();

      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(user.trialExpiresAt).toBeGreaterThanOrEqual(before + sevenDays);
      expect(user.trialExpiresAt).toBeLessThanOrEqual(after + sevenDays);
    });

    it("respects custom trial days", async () => {
      const before = Date.now();
      const user = await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
        trialDays: 14,
      });
      const after = Date.now();

      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      expect(user.trialExpiresAt).toBeGreaterThanOrEqual(before + fourteenDays);
      expect(user.trialExpiresAt).toBeLessThanOrEqual(after + fourteenDays);
    });
  });

  describe("getUser", () => {
    it("returns null for non-existent user", async () => {
      const user = await store.getUser(999999);
      expect(user).toBeNull();
    });

    it("returns existing user", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      const user = await store.getUser(123456);
      expect(user).not.toBeNull();
      expect(user?.telegramUserId).toBe(123456);
      expect(user?.firstName).toBe("John");
    });
  });

  describe("getOrCreateUser", () => {
    it("creates user if doesn't exist", async () => {
      const user = await store.getOrCreateUser(123456, {
        firstName: "John",
      });

      expect(user.telegramUserId).toBe(123456);
      expect(user.firstName).toBe("John");
    });

    it("returns existing user without creating duplicate", async () => {
      const created = await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      const fetched = await store.getOrCreateUser(123456, {
        firstName: "Jane", // Different name should be ignored
      });

      expect(fetched.telegramUserId).toBe(123456);
      expect(fetched.firstName).toBe("John"); // Original name preserved
      expect(fetched.createdAt).toBe(created.createdAt);

      // Verify only one user was created
      const count = await store.getUserCount();
      expect(count).toBe(1);
    });
  });

  describe("updateUser", () => {
    it("updates user fields", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      const updated = await store.updateUser(123456, {
        firstName: "Jane",
        lastName: "Doe",
      });

      expect(updated.firstName).toBe("Jane");
      expect(updated.lastName).toBe("Doe");
      expect(updated.updatedAt).toBeDefined();
    });

    it("throws error for non-existent user", async () => {
      await expect(store.updateUser(999999, { firstName: "Jane" })).rejects.toThrow("not found");
    });

    it("can change user role", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      const updated = await store.updateUser(123456, {
        role: "vip",
      });

      expect(updated.role).toBe("vip");
    });
  });

  describe("deleteUser", () => {
    it("deletes existing user", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      const deleted = await store.deleteUser(123456);
      expect(deleted).toBe(true);

      const user = await store.getUser(123456);
      expect(user).toBeNull();
    });

    it("returns false for non-existent user", async () => {
      const deleted = await store.deleteUser(999999);
      expect(deleted).toBe(false);
    });
  });

  describe("getAllUsers", () => {
    it("returns empty array when no users", async () => {
      const users = await store.getAllUsers();
      expect(users).toEqual([]);
    });

    it("returns all users", async () => {
      await store.createUser({ telegramUserId: 111, firstName: "User1" });
      await store.createUser({ telegramUserId: 222, firstName: "User2" });
      await store.createUser({ telegramUserId: 333, firstName: "User3" });

      const users = await store.getAllUsers();
      expect(users).toHaveLength(3);
      expect(users.map((u) => u.telegramUserId)).toEqual(expect.arrayContaining([111, 222, 333]));
    });
  });

  describe("getUsersByRole", () => {
    it("filters users by role", async () => {
      await store.createUser({
        telegramUserId: 111,
        firstName: "Trial1",
        role: "trial",
      });
      await store.createUser({
        telegramUserId: 222,
        firstName: "Owner",
        role: "owner",
      });
      await store.createUser({
        telegramUserId: 333,
        firstName: "Trial2",
        role: "trial",
      });

      const trials = await store.getUsersByRole("trial");
      expect(trials).toHaveLength(2);
      expect(trials.map((u) => u.telegramUserId)).toEqual(expect.arrayContaining([111, 333]));

      const owners = await store.getUsersByRole("owner");
      expect(owners).toHaveLength(1);
      expect(owners[0].telegramUserId).toBe(222);
    });
  });

  describe("incrementUsage", () => {
    it("increments message and token counters", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      await store.incrementUsage(123456, 1000, 0.002);

      const user = await store.getUser(123456);
      expect(user?.messagesUsedToday).toBe(1);
      expect(user?.totalMessagesUsed).toBe(1);
      expect(user?.totalTokensUsed).toBe(1000);
      expect(user?.totalCostUsd).toBe(0.002);
    });

    it("accumulates multiple increments", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      await store.incrementUsage(123456, 1000, 0.002);
      await store.incrementUsage(123456, 500, 0.001);
      await store.incrementUsage(123456, 2000, 0.004);

      const user = await store.getUser(123456);
      expect(user?.messagesUsedToday).toBe(3);
      expect(user?.totalMessagesUsed).toBe(3);
      expect(user?.totalTokensUsed).toBe(3500);
      expect(user?.totalCostUsd).toBeCloseTo(0.007);
    });

    it("throws error for non-existent user", async () => {
      await expect(store.incrementUsage(999999, 1000, 0.002)).rejects.toThrow("not found");
    });
  });

  describe("checkExpiredTrials", () => {
    it("expires trial users past expiration date", async () => {
      const pastDate = Date.now() - 1000; // 1 second ago

      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
        role: "trial",
      });

      // Manually set expired trial date
      await store.updateUser(123456, {
        trialExpiresAt: pastDate,
      });

      const expiredCount = await store.checkExpiredTrials();
      expect(expiredCount).toBe(1);

      const user = await store.getUser(123456);
      expect(user?.role).toBe("expired");
    });

    it("does not expire future trials", async () => {
      const futureDate = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
        role: "trial",
      });

      await store.updateUser(123456, {
        trialExpiresAt: futureDate,
      });

      const expiredCount = await store.checkExpiredTrials();
      expect(expiredCount).toBe(0);

      const user = await store.getUser(123456);
      expect(user?.role).toBe("trial");
    });

    it("does not expire non-trial users", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "Owner",
        role: "owner",
      });

      const expiredCount = await store.checkExpiredTrials();
      expect(expiredCount).toBe(0);

      const user = await store.getUser(123456);
      expect(user?.role).toBe("owner");
    });
  });

  describe("persistence", () => {
    it("saves and loads users from file", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      // Create new store instance (should load from file)
      const newStore = new UserStore(testDataDir);
      const user = await newStore.getUser(123456);

      expect(user).not.toBeNull();
      if (user !== null) {
        expect(user.firstName).toBe("John");
      }
    });

    it("creates directory if doesn't exist", async () => {
      const newDataDir = join(testDataDir, "nested", "path");
      const newStore = new UserStore(newDataDir);

      await newStore.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      expect(existsSync(join(newDataDir, ".openclaw", "users.json"))).toBe(true);

      // Clean up
      await rm(join(testDataDir, "nested"), { recursive: true, force: true });
    });

    it("preserves all user data across save/load", async () => {
      const originalUser = await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        role: "trial",
      });

      await store.incrementUsage(123456, 5000, 0.01);

      // Load from new instance
      const newStore = new UserStore(testDataDir);
      const loadedUser = await newStore.getUser(123456);

      expect(loadedUser).not.toBeNull();
      if (loadedUser !== null) {
        expect(loadedUser).toMatchObject({
          telegramUserId: originalUser.telegramUserId,
          firstName: originalUser.firstName,
          lastName: originalUser.lastName,
          username: originalUser.username,
          role: originalUser.role,
          messagesUsedToday: 1,
          totalMessagesUsed: 1,
          totalTokensUsed: 5000,
          totalCostUsd: 0.01,
        });
      }
    });

    it("uses atomic write to prevent corruption", async () => {
      await store.createUser({
        telegramUserId: 123456,
        firstName: "John",
      });

      // Verify no temporary file remains after successful write
      const tmpPath = join(testDataDir, ".openclaw", "users.json.tmp");
      expect(existsSync(tmpPath)).toBe(false);
    });
  });

  describe("getUserCount", () => {
    it("returns 0 for empty store", async () => {
      const count = await store.getUserCount();
      expect(count).toBe(0);
    });

    it("returns correct count", async () => {
      await store.createUser({ telegramUserId: 111, firstName: "User1" });
      await store.createUser({ telegramUserId: 222, firstName: "User2" });
      await store.createUser({ telegramUserId: 333, firstName: "User3" });

      const count = await store.getUserCount();
      expect(count).toBe(3);
    });
  });
});
