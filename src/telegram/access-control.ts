import type { UserRecord } from "./user-store.types.js";
import { getRoleMessageLimit, hasUnlimitedAccess } from "./user-roles.js";

/**
 * Access check result
 */
export type AccessCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "limit_exceeded"; remaining: number; resetsAt: string }
  | { allowed: false; reason: "trial_expired"; expiresAt: string }
  | { allowed: false; reason: "subscription_expired"; expiresAt: string };

/**
 * Check if user can send a message
 */
export function canSendMessage(user: UserRecord): AccessCheckResult {
  // Check trial expiration FIRST (before unlimited check)
  if (user.role === "trial" && user.trialExpiresAt) {
    if (Date.now() > user.trialExpiresAt) {
      return {
        allowed: false,
        reason: "trial_expired",
        expiresAt: new Date(user.trialExpiresAt).toISOString(),
      };
    }
  }

  // Check subscription expiration FIRST (before unlimited check)
  if (user.role === "subscriber" && user.subscriptionExpiresAt) {
    if (Date.now() > user.subscriptionExpiresAt) {
      return {
        allowed: false,
        reason: "subscription_expired",
        expiresAt: new Date(user.subscriptionExpiresAt).toISOString(),
      };
    }
  }

  // Owner, VIP, and Subscriber (with active subscription) have unlimited access
  if (hasUnlimitedAccess(user)) {
    return { allowed: true };
  }

  // Check daily message limit
  const limit = getRoleMessageLimit(user.role);
  if (limit === "unlimited") {
    return { allowed: true };
  }

  // Reset counter if new day
  const today = getTodayDateString();
  const lastMessageDate = user.lastMessageDate;
  const messagesUsedToday = lastMessageDate === today ? user.messagesUsedToday : 0;

  if (messagesUsedToday >= limit) {
    const remaining = 0;
    const resetsAt = getTomorrowDateString();

    return {
      allowed: false,
      reason: "limit_exceeded",
      remaining,
      resetsAt,
    };
  }

  return { allowed: true };
}

/**
 * Get remaining messages for today
 */
export function getRemainingMessages(user: UserRecord): number | "unlimited" {
  if (hasUnlimitedAccess(user)) {
    return "unlimited";
  }

  const limit = getRoleMessageLimit(user.role);
  if (limit === "unlimited") {
    return "unlimited";
  }

  // Reset counter if new day
  const today = getTodayDateString();
  const lastMessageDate = user.lastMessageDate;
  const messagesUsedToday = lastMessageDate === today ? user.messagesUsedToday : 0;

  return Math.max(0, limit - messagesUsedToday);
}

/**
 * Get today's date string in YYYY-MM-DD format (UTC)
 */
function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get tomorrow's date string in YYYY-MM-DD format (UTC)
 */
function getTomorrowDateString(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Format access denied message
 */
export function formatAccessDeniedMessage(result: AccessCheckResult): string {
  if (result.allowed) {
    return "";
  }

  switch (result.reason) {
    case "limit_exceeded": {
      const resetTime = new Date(result.resetsAt);
      const resetHour = resetTime.getUTCHours();
      return `❌ Вы достигли дневного лимита сообщений.\n\n⏱ Лимит обновится в ${resetHour.toString().padStart(2, "0")}:00 UTC (00:00 по Москве)\n\n💡 Хотите больше доступа? Используйте /subscribe`;
    }
    case "trial_expired": {
      return `❌ Ваш пробный период истек.\n\n💡 Оформите подписку для продолжения: /subscribe`;
    }
    case "subscription_expired": {
      return `❌ Ваша подписка истекла.\n\n💡 Продлите подписку: /subscribe`;
    }
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
