import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CreateUserOptions,
  SubscriptionPlan,
  UpdateUserOptions,
  UserRecord,
  UserRole,
} from "./user-store.types.js";
import { requireNodeSqlite } from "../memory/sqlite.js";

type UserRow = {
  telegram_user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  created_at: number;
  updated_at: number | null;
  trial_expires_at: number | null;
  subscription_plan: SubscriptionPlan | null;
  subscription_expires_at: number | null;
  subscription_charge_id: string | null;
  auto_renew: number | null;
  invited_by: number | null;
  invite_code: string | null;
  messages_used_today: number;
  last_message_date: string;
  total_messages_used: number;
  total_tokens_used: number;
  total_cost_usd: number;
};

const USER_COLUMNS = [
  "telegram_user_id",
  "username",
  "first_name",
  "last_name",
  "role",
  "created_at",
  "updated_at",
  "trial_expires_at",
  "subscription_plan",
  "subscription_expires_at",
  "subscription_charge_id",
  "auto_renew",
  "invited_by",
  "invite_code",
  "messages_used_today",
  "last_message_date",
  "total_messages_used",
  "total_tokens_used",
  "total_cost_usd",
] as const;

const USER_COLUMNS_SQL = USER_COLUMNS.join(", ");
const INSERT_USER_SQL = `
INSERT INTO users (${USER_COLUMNS_SQL})
VALUES (@telegram_user_id, @username, @first_name, @last_name, @role, @created_at, @updated_at, @trial_expires_at, @subscription_plan, @subscription_expires_at, @subscription_charge_id, @auto_renew, @invited_by, @invite_code, @messages_used_today, @last_message_date, @total_messages_used, @total_tokens_used, @total_cost_usd)
`;

/**
 * SQLite-backed user store.
 * Uses `node:sqlite` to avoid external runtime dependencies.
 */
export class UserStore {
  private readonly dbPath: string;
  private readonly legacyJsonPath: string;
  private loaded = false;
  private db: DatabaseSync | null = null;

  constructor(dataDir: string) {
    const baseDir = join(dataDir, ".openclaw");
    this.dbPath = join(baseDir, "users.db");
    this.legacyJsonPath = join(baseDir, "users.json");
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      await mkdir(dirname(this.dbPath), { recursive: true });

      const { DatabaseSync } = requireNodeSqlite();
      const db = new DatabaseSync(this.dbPath);
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          telegram_user_id INTEGER PRIMARY KEY,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER,
          trial_expires_at INTEGER,
          subscription_plan TEXT,
          subscription_expires_at INTEGER,
          subscription_charge_id TEXT,
          auto_renew INTEGER,
          invited_by INTEGER,
          invite_code TEXT,
          messages_used_today INTEGER NOT NULL DEFAULT 0,
          last_message_date TEXT NOT NULL,
          total_messages_used INTEGER NOT NULL DEFAULT 0,
          total_tokens_used INTEGER NOT NULL DEFAULT 0,
          total_cost_usd REAL NOT NULL DEFAULT 0
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_users_subscription_expires_at ON users(subscription_expires_at)",
      );

      this.db = db;
      await this.migrateLegacyJsonIfNeeded();
      this.loaded = true;
    } catch (error) {
      throw new Error(
        `Failed to load user store: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async save(): Promise<void> {
    await this.load();
  }

  async createUser(options: CreateUserOptions): Promise<UserRecord> {
    await this.load();
    const db = this.requireDb();

    const now = Date.now();
    const trialDays = options.trialDays ?? 7;
    const role = options.role ?? "trial";
    const row = this.recordToRow({
      telegramUserId: options.telegramUserId,
      username: options.username ?? null,
      firstName: options.firstName ?? null,
      lastName: options.lastName ?? null,
      role,
      createdAt: now,
      trialExpiresAt: role === "trial" ? now + trialDays * 24 * 60 * 60 * 1000 : null,
      messagesUsedToday: 0,
      lastMessageDate: this.getTodayDateString(),
      totalMessagesUsed: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
    });

    try {
      db.prepare(INSERT_USER_SQL).run(row);
    } catch (error) {
      if (this.isSqliteUniqueError(error)) {
        throw new Error(`User ${options.telegramUserId} already exists`, { cause: error });
      }
      throw new Error(
        `Failed to create user: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    return this.rowToRecord(row);
  }

  async getUser(telegramUserId: number): Promise<UserRecord | null> {
    await this.load();
    const db = this.requireDb();
    const row = db
      .prepare(`SELECT ${USER_COLUMNS_SQL} FROM users WHERE telegram_user_id = ?`)
      .get(telegramUserId) as UserRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  async getOrCreateUser(
    telegramUserId: number,
    options?: Omit<CreateUserOptions, "telegramUserId">,
  ): Promise<UserRecord> {
    const existing = await this.getUser(telegramUserId);
    if (existing) {
      return existing;
    }
    return await this.createUser({
      telegramUserId,
      ...options,
    });
  }

  async updateUser(telegramUserId: number, updates: UpdateUserOptions): Promise<UserRecord> {
    await this.load();
    const db = this.requireDb();
    const existing = await this.getUser(telegramUserId);
    if (!existing) {
      throw new Error(`User ${telegramUserId} not found`);
    }

    const merged: UserRecord = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    const row = this.recordToRow(merged);

    db.prepare(`
      UPDATE users
      SET username = @username,
          first_name = @first_name,
          last_name = @last_name,
          role = @role,
          created_at = @created_at,
          updated_at = @updated_at,
          trial_expires_at = @trial_expires_at,
          subscription_plan = @subscription_plan,
          subscription_expires_at = @subscription_expires_at,
          subscription_charge_id = @subscription_charge_id,
          auto_renew = @auto_renew,
          invited_by = @invited_by,
          invite_code = @invite_code,
          messages_used_today = @messages_used_today,
          last_message_date = @last_message_date,
          total_messages_used = @total_messages_used,
          total_tokens_used = @total_tokens_used,
          total_cost_usd = @total_cost_usd
      WHERE telegram_user_id = @telegram_user_id
    `).run(row);

    return this.rowToRecord(row);
  }

  async deleteUser(telegramUserId: number): Promise<boolean> {
    await this.load();
    const db = this.requireDb();
    const res = db.prepare("DELETE FROM users WHERE telegram_user_id = ?").run(telegramUserId);
    return Number(res.changes ?? 0) > 0;
  }

  async getAllUsers(): Promise<UserRecord[]> {
    await this.load();
    const db = this.requireDb();
    const rows = db.prepare(`SELECT ${USER_COLUMNS_SQL} FROM users`).all() as UserRow[];
    return rows.map((row) => this.rowToRecord(row));
  }

  async getUsersByRole(role: UserRole): Promise<UserRecord[]> {
    await this.load();
    const db = this.requireDb();
    const rows = db
      .prepare(`SELECT ${USER_COLUMNS_SQL} FROM users WHERE role = ?`)
      .all(role) as UserRow[];
    return rows.map((row) => this.rowToRecord(row));
  }

  async getUserCount(): Promise<number> {
    await this.load();
    const db = this.requireDb();
    const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    return row.count;
  }

  async incrementUsage(telegramUserId: number, tokensUsed: number, costUsd: number): Promise<void> {
    const user = await this.getUser(telegramUserId);
    if (!user) {
      throw new Error(`User ${telegramUserId} not found`);
    }

    const today = this.getTodayDateString();
    const isSameDay = user.lastMessageDate === today;
    const messagesUsedToday = isSameDay ? user.messagesUsedToday : 0;

    await this.updateUser(telegramUserId, {
      messagesUsedToday: messagesUsedToday + 1,
      totalMessagesUsed: user.totalMessagesUsed + 1,
      totalTokensUsed: user.totalTokensUsed + tokensUsed,
      totalCostUsd: user.totalCostUsd + costUsd,
      lastMessageDate: today,
    });
  }

  async checkExpiredTrials(): Promise<number> {
    await this.load();
    const db = this.requireDb();
    const now = Date.now();
    const result = db
      .prepare(
        "UPDATE users SET role = 'expired', updated_at = ? WHERE role = 'trial' AND trial_expires_at IS NOT NULL AND trial_expires_at < ?",
      )
      .run(now, now);
    return Number(result.changes ?? 0);
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("User store is not loaded");
    }
    return this.db;
  }

  private async migrateLegacyJsonIfNeeded(): Promise<void> {
    const db = this.requireDb();
    const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    if (row.count > 0 || !existsSync(this.legacyJsonPath)) {
      return;
    }

    const raw = await readFile(this.legacyJsonPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep startup resilient when legacy JSON is corrupted.
      return;
    }

    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? Object.values(parsed as Record<string, unknown>)
        : [];
    if (candidates.length === 0) {
      return;
    }

    const records = candidates
      .map((candidate) => this.normalizeLegacyRecord(candidate))
      .filter((record): record is UserRecord => record !== null);
    if (records.length === 0) {
      return;
    }

    db.exec("BEGIN");
    try {
      const stmt = db.prepare(INSERT_USER_SQL);
      for (const record of records) {
        stmt.run(this.recordToRow(record));
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private normalizeLegacyRecord(candidate: unknown): UserRecord | null {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    const record = candidate as Partial<UserRecord> & { telegramUserId?: unknown; role?: unknown };

    const telegramUserId =
      typeof record.telegramUserId === "number"
        ? record.telegramUserId
        : Number(record.telegramUserId);
    if (!Number.isFinite(telegramUserId)) {
      return null;
    }

    const role =
      record.role === "owner" ||
      record.role === "vip" ||
      record.role === "subscriber" ||
      record.role === "trial" ||
      record.role === "expired"
        ? record.role
        : "trial";

    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
    const lastMessageDate =
      typeof record.lastMessageDate === "string" && record.lastMessageDate.trim() !== ""
        ? record.lastMessageDate
        : this.getTodayDateString();

    return {
      telegramUserId,
      username: typeof record.username === "string" ? record.username : undefined,
      firstName: typeof record.firstName === "string" ? record.firstName : undefined,
      lastName: typeof record.lastName === "string" ? record.lastName : undefined,
      role,
      createdAt,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined,
      trialExpiresAt: typeof record.trialExpiresAt === "number" ? record.trialExpiresAt : undefined,
      subscriptionPlan:
        record.subscriptionPlan === "starter" || record.subscriptionPlan === "premium"
          ? record.subscriptionPlan
          : undefined,
      subscriptionExpiresAt:
        typeof record.subscriptionExpiresAt === "number" ? record.subscriptionExpiresAt : undefined,
      subscriptionChargeId:
        typeof record.subscriptionChargeId === "string" ? record.subscriptionChargeId : undefined,
      autoRenew: typeof record.autoRenew === "boolean" ? record.autoRenew : undefined,
      invitedBy: typeof record.invitedBy === "number" ? record.invitedBy : undefined,
      inviteCode: typeof record.inviteCode === "string" ? record.inviteCode : undefined,
      messagesUsedToday:
        typeof record.messagesUsedToday === "number" ? Math.max(0, record.messagesUsedToday) : 0,
      lastMessageDate,
      totalMessagesUsed:
        typeof record.totalMessagesUsed === "number" ? Math.max(0, record.totalMessagesUsed) : 0,
      totalTokensUsed:
        typeof record.totalTokensUsed === "number" ? Math.max(0, record.totalTokensUsed) : 0,
      totalCostUsd: typeof record.totalCostUsd === "number" ? record.totalCostUsd : 0,
    };
  }

  private rowToRecord(row: UserRow): UserRecord {
    return {
      telegramUserId: row.telegram_user_id,
      username: row.username ?? undefined,
      firstName: row.first_name ?? undefined,
      lastName: row.last_name ?? undefined,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
      trialExpiresAt: row.trial_expires_at ?? undefined,
      subscriptionPlan: row.subscription_plan ?? undefined,
      subscriptionExpiresAt: row.subscription_expires_at ?? undefined,
      subscriptionChargeId: row.subscription_charge_id ?? undefined,
      autoRenew:
        row.auto_renew === null ? undefined : row.auto_renew === 0 ? false : row.auto_renew === 1,
      invitedBy: row.invited_by ?? undefined,
      inviteCode: row.invite_code ?? undefined,
      messagesUsedToday: row.messages_used_today,
      lastMessageDate: row.last_message_date,
      totalMessagesUsed: row.total_messages_used,
      totalTokensUsed: row.total_tokens_used,
      totalCostUsd: row.total_cost_usd,
    };
  }

  private recordToRow(record: UserRecord): UserRow {
    return {
      telegram_user_id: record.telegramUserId,
      username: record.username ?? null,
      first_name: record.firstName ?? null,
      last_name: record.lastName ?? null,
      role: record.role,
      created_at: record.createdAt,
      updated_at: record.updatedAt ?? null,
      trial_expires_at: record.trialExpiresAt ?? null,
      subscription_plan: record.subscriptionPlan ?? null,
      subscription_expires_at: record.subscriptionExpiresAt ?? null,
      subscription_charge_id: record.subscriptionChargeId ?? null,
      auto_renew:
        record.autoRenew === undefined || record.autoRenew === null
          ? null
          : record.autoRenew
            ? 1
            : 0,
      invited_by: record.invitedBy ?? null,
      invite_code: record.inviteCode ?? null,
      messages_used_today: record.messagesUsedToday,
      last_message_date: record.lastMessageDate,
      total_messages_used: record.totalMessagesUsed,
      total_tokens_used: record.totalTokensUsed,
      total_cost_usd: record.totalCostUsd,
    };
  }

  private isSqliteUniqueError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("UNIQUE constraint failed") || message.includes("constraint failed");
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split("T")[0];
  }
}

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
