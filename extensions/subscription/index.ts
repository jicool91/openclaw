import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadNodeSqlite(): typeof import("node:sqlite") {
  return require("node:sqlite") as typeof import("node:sqlite");
}

function parseAdminTelegramIds(envValue: string | undefined): number[] {
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

function getDataDir(): string {
  return process.env.DATA_DIR ?? process.env.HOME ?? "/tmp";
}

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

async function ensureOwnerUsers(api: OpenClawPluginApi): Promise<void> {
  const adminIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
  if (adminIds.length === 0) {
    return;
  }

  const baseDir = path.join(getDataDir(), ".openclaw");
  await mkdir(baseDir, { recursive: true });
  const dbPath = path.join(baseDir, "users.db");
  const { DatabaseSync } = loadNodeSqlite();
  const db = new DatabaseSync(dbPath);

  try {
    db.exec("PRAGMA journal_mode = WAL");
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

    api.logger.info(
      `subscription: initialized ${adminIds.length} owner${adminIds.length > 1 ? "s" : ""}`,
    );
  } finally {
    db.close();
  }
}

export default function register(api: OpenClawPluginApi) {
  const bootstrapService: OpenClawPluginService = {
    id: "subscription-bootstrap",
    start: async () => {
      await ensureOwnerUsers(api);
    },
  };

  api.registerService(bootstrapService);

  // Lifecycle hook kept intentionally lightweight as an extension seam.
  api.on("message_received", (_event, ctx) => {
    if (ctx.channelId !== "telegram") {
      return;
    }
  });
}
