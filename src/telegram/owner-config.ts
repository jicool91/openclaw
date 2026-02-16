import type { UserStore } from "./user-store.js";

/**
 * Parse admin Telegram IDs from environment variable
 * Format: comma-separated list of Telegram IDs
 * Example: "123456789,987654321"
 */
export function parseAdminTelegramIds(envValue: string | undefined): number[] {
  if (!envValue || envValue.trim() === "") {
    return [];
  }

  return envValue
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));
}

/**
 * Initialize owner users from ADMIN_TELEGRAM_IDS environment variable
 */
export async function initializeOwners(userStore: UserStore, adminIds: number[]): Promise<void> {
  if (adminIds.length === 0) {
    return;
  }

  for (const telegramUserId of adminIds) {
    const existingUser = await userStore.getUser(telegramUserId);

    if (existingUser !== null) {
      // Update existing user to owner if not already
      if (existingUser.role !== "owner") {
        await userStore.updateUser(telegramUserId, {
          role: "owner",
        });
      }
    } else {
      // Create new owner user
      await userStore.createUser({
        telegramUserId,
        role: "owner",
      });
    }
  }
}

/**
 * Check if Telegram ID is an admin
 */
export function isAdmin(telegramUserId: number, adminIds: number[]): boolean {
  return adminIds.includes(telegramUserId);
}
