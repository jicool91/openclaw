import type { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function loadNodeSqlite(): typeof import("node:sqlite") {
  return require("node:sqlite") as typeof import("node:sqlite");
}

const USERS_TABLE_SQL = `
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
  total_cost_usd REAL NOT NULL DEFAULT 0,
  google_email TEXT,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_scope TEXT,
  google_token_type TEXT,
  google_id_token TEXT,
  google_token_expires_at INTEGER,
  google_connected_at INTEGER
)
`;

const REQUIRED_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "google_email", definition: "TEXT" },
  { name: "google_access_token", definition: "TEXT" },
  { name: "google_refresh_token", definition: "TEXT" },
  { name: "google_scope", definition: "TEXT" },
  { name: "google_token_type", definition: "TEXT" },
  { name: "google_id_token", definition: "TEXT" },
  { name: "google_token_expires_at", definition: "INTEGER" },
  { name: "google_connected_at", definition: "INTEGER" },
];

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function ensureUserSchema(db: DatabaseSync): void {
  db.exec(USERS_TABLE_SQL);

  const rows = db.prepare("PRAGMA table_info(users)").all() as Array<{ name?: string }>;
  const existing = new Set(rows.map((row) => row.name ?? ""));

  for (const column of REQUIRED_COLUMNS) {
    if (existing.has(column.name)) {
      continue;
    }
    db.exec(`ALTER TABLE users ADD COLUMN ${column.name} ${column.definition}`);
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_users_subscription_expires_at ON users(subscription_expires_at)",
  );
}

export function parseAdminTelegramIds(envValue: string | undefined): number[] {
  if (!envValue || envValue.trim() === "") {
    return [];
  }
  return envValue
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id));
}

export type GoogleOAuthPersistInput = {
  telegramUserId: number;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  tokenType?: string;
  idToken?: string;
  tokenExpiresAt?: number;
  connectedAt?: number;
};

export class SubscriptionStore {
  private readonly dbPath: string;

  constructor(dataDir: string) {
    this.dbPath = join(dataDir, ".openclaw", "users.db");
  }

  async ensureSchema(): Promise<void> {
    await this.withDb(async () => undefined);
  }

  async ensureOwnerUsers(adminIds: number[]): Promise<number> {
    if (adminIds.length === 0) {
      return 0;
    }

    return await this.withDb(async (db) => {
      const now = Date.now();
      const today = getTodayDateString();
      const upsertOwner = db.prepare(`
        INSERT INTO users (
          telegram_user_id,
          role,
          created_at,
          updated_at,
          last_message_date
        ) VALUES (
          ?,
          'owner',
          ?,
          ?,
          ?
        )
        ON CONFLICT(telegram_user_id) DO UPDATE SET
          role = 'owner',
          trial_expires_at = NULL,
          updated_at = excluded.updated_at
      `);

      db.exec("BEGIN");
      try {
        for (const adminId of adminIds) {
          upsertOwner.run(adminId, now, now, today);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return adminIds.length;
    });
  }

  async upsertGoogleOAuth(input: GoogleOAuthPersistInput): Promise<void> {
    await this.withDb(async (db) => {
      const now = input.connectedAt ?? Date.now();
      const today = getTodayDateString();
      const trialExpiresAt = now + 7 * 24 * 60 * 60 * 1000;
      const exists = db
        .prepare("SELECT telegram_user_id FROM users WHERE telegram_user_id = ?")
        .get(input.telegramUserId) as { telegram_user_id: number } | undefined;

      if (!exists) {
        db.prepare(`
          INSERT INTO users (
            telegram_user_id,
            username,
            first_name,
            last_name,
            role,
            created_at,
            updated_at,
            trial_expires_at,
            subscription_plan,
            subscription_expires_at,
            subscription_charge_id,
            auto_renew,
            invited_by,
            invite_code,
            messages_used_today,
            last_message_date,
            total_messages_used,
            total_tokens_used,
            total_cost_usd,
            google_email,
            google_access_token,
            google_refresh_token,
            google_scope,
            google_token_type,
            google_id_token,
            google_token_expires_at,
            google_connected_at
          ) VALUES (
            @telegram_user_id,
            NULL,
            NULL,
            NULL,
            'trial',
            @created_at,
            @updated_at,
            @trial_expires_at,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            0,
            @last_message_date,
            0,
            0,
            0,
            @google_email,
            @google_access_token,
            @google_refresh_token,
            @google_scope,
            @google_token_type,
            @google_id_token,
            @google_token_expires_at,
            @google_connected_at
          )
        `).run({
          telegram_user_id: input.telegramUserId,
          created_at: now,
          updated_at: now,
          trial_expires_at: trialExpiresAt,
          last_message_date: today,
          google_email: input.email ?? null,
          google_access_token: input.accessToken,
          google_refresh_token: input.refreshToken ?? null,
          google_scope: input.scope ?? null,
          google_token_type: input.tokenType ?? null,
          google_id_token: input.idToken ?? null,
          google_token_expires_at: input.tokenExpiresAt ?? null,
          google_connected_at: now,
        });
        return;
      }

      db.prepare(`
        UPDATE users
        SET updated_at = @updated_at,
            google_email = @google_email,
            google_access_token = @google_access_token,
            google_refresh_token = @google_refresh_token,
            google_scope = @google_scope,
            google_token_type = @google_token_type,
            google_id_token = @google_id_token,
            google_token_expires_at = @google_token_expires_at,
            google_connected_at = @google_connected_at
        WHERE telegram_user_id = @telegram_user_id
      `).run({
        telegram_user_id: input.telegramUserId,
        updated_at: now,
        google_email: input.email ?? null,
        google_access_token: input.accessToken,
        google_refresh_token: input.refreshToken ?? null,
        google_scope: input.scope ?? null,
        google_token_type: input.tokenType ?? null,
        google_id_token: input.idToken ?? null,
        google_token_expires_at: input.tokenExpiresAt ?? null,
        google_connected_at: now,
      });
    });
  }

  private async withDb<T>(fn: (db: DatabaseSync) => Promise<T> | T): Promise<T> {
    await mkdir(dirname(this.dbPath), { recursive: true });

    const { DatabaseSync } = loadNodeSqlite();
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA foreign_keys = ON");
      db.exec("PRAGMA busy_timeout = 5000");
      ensureUserSchema(db);
      return await fn(db);
    } finally {
      db.close();
    }
  }
}
