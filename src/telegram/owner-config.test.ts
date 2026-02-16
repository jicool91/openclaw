import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initializeOwners, isAdmin, parseAdminTelegramIds } from "./owner-config.js";
import { UserStore } from "./user-store.js";

describe("owner-config", () => {
  describe("parseAdminTelegramIds", () => {
    it("parses comma-separated IDs", () => {
      const result = parseAdminTelegramIds("123456789,987654321");
      expect(result).toEqual([123456789, 987654321]);
    });

    it("handles whitespace", () => {
      const result = parseAdminTelegramIds(" 123456789 , 987654321 ");
      expect(result).toEqual([123456789, 987654321]);
    });

    it("filters out invalid IDs", () => {
      const result = parseAdminTelegramIds("123456789,invalid,987654321");
      expect(result).toEqual([123456789, 987654321]);
    });

    it("returns empty array for empty string", () => {
      const result = parseAdminTelegramIds("");
      expect(result).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      const result = parseAdminTelegramIds(undefined);
      expect(result).toEqual([]);
    });

    it("handles single ID", () => {
      const result = parseAdminTelegramIds("123456789");
      expect(result).toEqual([123456789]);
    });

    it("filters out empty elements", () => {
      const result = parseAdminTelegramIds("123456789,,987654321");
      expect(result).toEqual([123456789, 987654321]);
    });
  });

  describe("isAdmin", () => {
    it("returns true for admin ID", () => {
      const adminIds = [123456789, 987654321];
      expect(isAdmin(123456789, adminIds)).toBe(true);
    });

    it("returns false for non-admin ID", () => {
      const adminIds = [123456789, 987654321];
      expect(isAdmin(111111111, adminIds)).toBe(false);
    });

    it("returns false for empty admin list", () => {
      expect(isAdmin(123456789, [])).toBe(false);
    });
  });

  describe("initializeOwners", () => {
    const testDataDir = join(process.cwd(), "test-data", "owner-config");
    let store: UserStore;

    beforeEach(async () => {
      if (existsSync(testDataDir)) {
        await rm(testDataDir, { recursive: true, force: true });
      }
      await mkdir(testDataDir, { recursive: true });

      store = new UserStore(testDataDir);

      return async () => {
        if (existsSync(testDataDir)) {
          await rm(testDataDir, { recursive: true, force: true });
        }
      };
    });

    it("creates owner users for new admin IDs", async () => {
      const adminIds = [123456789, 987654321];
      await initializeOwners(store, adminIds);

      const user1 = await store.getUser(123456789);
      const user2 = await store.getUser(987654321);

      expect(user1).not.toBeNull();
      expect(user1?.role).toBe("owner");

      expect(user2).not.toBeNull();
      expect(user2?.role).toBe("owner");
    });

    it("upgrades existing trial user to owner", async () => {
      // Create trial user first
      await store.createUser({
        telegramUserId: 123456789,
        firstName: "John",
        role: "trial",
      });

      // Initialize as owner
      const adminIds = [123456789];
      await initializeOwners(store, adminIds);

      const user = await store.getUser(123456789);
      expect(user).not.toBeNull();
      expect(user?.role).toBe("owner");
    });

    it("does not modify existing owner", async () => {
      // Create owner first
      const created = await store.createUser({
        telegramUserId: 123456789,
        firstName: "John",
        role: "owner",
      });

      // Initialize again
      const adminIds = [123456789];
      await initializeOwners(store, adminIds);

      const user = await store.getUser(123456789);
      expect(user).not.toBeNull();
      expect(user?.role).toBe("owner");
      expect(user?.createdAt).toBe(created.createdAt); // Not recreated
    });

    it("does nothing for empty admin IDs", async () => {
      await initializeOwners(store, []);

      const count = await store.getUserCount();
      expect(count).toBe(0);
    });

    it("handles multiple admins at once", async () => {
      const adminIds = [111, 222, 333, 444];
      await initializeOwners(store, adminIds);

      const count = await store.getUserCount();
      expect(count).toBe(4);

      for (const id of adminIds) {
        const user = await store.getUser(id);
        expect(user?.role).toBe("owner");
      }
    });

    it("preserves user metadata when upgrading to owner", async () => {
      await store.createUser({
        telegramUserId: 123456789,
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        role: "trial",
      });

      const adminIds = [123456789];
      await initializeOwners(store, adminIds);

      const user = await store.getUser(123456789);
      expect(user?.role).toBe("owner");
      expect(user?.firstName).toBe("John");
      expect(user?.lastName).toBe("Doe");
      expect(user?.username).toBe("johndoe");
    });
  });
});
