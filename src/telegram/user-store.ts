import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CreateUserOptions,
  UpdateUserOptions,
  UserRecord,
  UserRole,
} from "./user-store.types.js";

/**
 * JSON-based user store
 * Manages user records in a JSON file
 */
export class UserStore {
  private users: Map<number, UserRecord> = new Map();
  private filePath: string;
  private loaded = false;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, ".openclaw", "users.json");
  }

  /**
   * Load users from JSON file
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      if (existsSync(this.filePath)) {
        const data = await readFile(this.filePath, "utf-8");
        const records = JSON.parse(data) as UserRecord[];

        this.users.clear();
        for (const record of records) {
          this.users.set(record.telegramUserId, record);
        }
      } else {
        // Create directory if it doesn't exist
        await mkdir(dirname(this.filePath), { recursive: true });
      }

      this.loaded = true;
    } catch (error) {
      throw new Error(
        `Failed to load user store: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Save users to JSON file with atomic write
   */
  async save(): Promise<void> {
    try {
      const records = Array.from(this.users.values());
      const data = JSON.stringify(records, null, 2);
      const tmpPath = `${this.filePath}.tmp`;

      // Atomic write: write to temp file first, then rename
      await writeFile(tmpPath, data, "utf-8");
      await rename(tmpPath, this.filePath);
    } catch (error) {
      throw new Error(
        `Failed to save user store: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Create a new user
   */
  async createUser(options: CreateUserOptions): Promise<UserRecord> {
    await this.load();

    if (this.users.has(options.telegramUserId)) {
      throw new Error(`User ${options.telegramUserId} already exists`);
    }

    const now = Date.now();
    const trialDays = options.trialDays ?? 7;
    const role = options.role ?? "trial";

    const user: UserRecord = {
      telegramUserId: options.telegramUserId,
      username: options.username,
      firstName: options.firstName,
      lastName: options.lastName,
      role,
      createdAt: now,
      trialExpiresAt: role === "trial" ? now + trialDays * 24 * 60 * 60 * 1000 : undefined,
      messagesUsedToday: 0,
      lastMessageDate: this.getTodayDateString(),
      totalMessagesUsed: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
    };

    this.users.set(user.telegramUserId, user);
    await this.save();

    return user;
  }

  /**
   * Get user by Telegram ID
   */
  async getUser(telegramUserId: number): Promise<UserRecord | null> {
    await this.load();
    return this.users.get(telegramUserId) ?? null;
  }

  /**
   * Get user or create if doesn't exist
   */
  async getOrCreateUser(
    telegramUserId: number,
    options?: Omit<CreateUserOptions, "telegramUserId">,
  ): Promise<UserRecord> {
    const user = await this.getUser(telegramUserId);
    if (user !== null) {
      return user;
    }

    return await this.createUser({
      telegramUserId,
      ...options,
    });
  }

  /**
   * Update user record
   */
  async updateUser(telegramUserId: number, updates: UpdateUserOptions): Promise<UserRecord> {
    await this.load();

    const user = this.users.get(telegramUserId);
    if (!user) {
      throw new Error(`User ${telegramUserId} not found`);
    }

    const updated: UserRecord = {
      ...user,
      ...updates,
      updatedAt: Date.now(),
    };

    this.users.set(telegramUserId, updated);
    await this.save();

    return updated;
  }

  /**
   * Delete user
   */
  async deleteUser(telegramUserId: number): Promise<boolean> {
    await this.load();

    const deleted = this.users.delete(telegramUserId);
    if (deleted) {
      await this.save();
    }

    return deleted;
  }

  /**
   * Get all users
   */
  async getAllUsers(): Promise<UserRecord[]> {
    await this.load();
    return Array.from(this.users.values());
  }

  /**
   * Get users by role
   */
  async getUsersByRole(role: UserRole): Promise<UserRecord[]> {
    await this.load();
    return Array.from(this.users.values()).filter((u) => u.role === role);
  }

  /**
   * Get total user count
   */
  async getUserCount(): Promise<number> {
    await this.load();
    return this.users.size;
  }

  /**
   * Increment message usage for user
   */
  async incrementUsage(telegramUserId: number, tokensUsed: number, costUsd: number): Promise<void> {
    const user = await this.getUser(telegramUserId);
    if (!user) {
      throw new Error(`User ${telegramUserId} not found`);
    }

    const today = this.getTodayDateString();

    // Reset daily counter if new day
    if (user.lastMessageDate !== today) {
      user.messagesUsedToday = 0;
      user.lastMessageDate = today;
    }

    await this.updateUser(telegramUserId, {
      messagesUsedToday: user.messagesUsedToday + 1,
      totalMessagesUsed: user.totalMessagesUsed + 1,
      totalTokensUsed: user.totalTokensUsed + tokensUsed,
      totalCostUsd: user.totalCostUsd + costUsd,
      lastMessageDate: today,
    });
  }

  /**
   * Check and update expired trials
   */
  async checkExpiredTrials(): Promise<number> {
    await this.load();

    const now = Date.now();
    let expiredCount = 0;

    for (const user of this.users.values()) {
      if (user.role === "trial" && user.trialExpiresAt && now > user.trialExpiresAt) {
        await this.updateUser(user.telegramUserId, {
          role: "expired",
        });
        expiredCount++;
      }
    }

    return expiredCount;
  }

  /**
   * Get today's date string in YYYY-MM-DD format (UTC)
   */
  private getTodayDateString(): string {
    return new Date().toISOString().split("T")[0];
  }
}

/**
 * Create a singleton user store instance
 */
let userStoreInstance: UserStore | null = null;

export function createUserStore(dataDir: string): UserStore {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore(dataDir);
  }
  return userStoreInstance;
}

export function getUserStore(): UserStore {
  if (!userStoreInstance) {
    throw new Error("User store not initialized. Call createUserStore first.");
  }
  return userStoreInstance;
}
