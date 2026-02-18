import type { UserRecord, UserRole } from "./user-store.types.js";

const TRIAL_MESSAGES_PER_DAY = 20;
const EXPIRED_MESSAGES_PER_DAY = 2;

/**
 * Role limits configuration
 */
export type RoleLimits = {
  messagesPerDay: number | "unlimited";
  canUseTools: boolean;
  canUseWebSearch: boolean;
  modelTier: "basic" | "medium" | "best";
};

/**
 * Get message limit for a role
 */
export function getRoleMessageLimit(role: UserRole): number | "unlimited" {
  switch (role) {
    case "owner":
    case "vip":
    case "subscriber":
      return "unlimited";
    case "trial":
      return TRIAL_MESSAGES_PER_DAY;
    case "expired":
      return EXPIRED_MESSAGES_PER_DAY;
    default: {
      // Exhaustive check
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/**
 * Get full limits for a role
 */
export function getRoleLimits(role: UserRole): RoleLimits {
  switch (role) {
    case "owner":
      return {
        messagesPerDay: "unlimited",
        canUseTools: true,
        canUseWebSearch: true,
        modelTier: "best",
      };
    case "vip":
      return {
        messagesPerDay: "unlimited",
        canUseTools: true,
        canUseWebSearch: true,
        modelTier: "best",
      };
    case "subscriber":
      return {
        messagesPerDay: "unlimited",
        canUseTools: true,
        canUseWebSearch: true,
        modelTier: "best",
      };
    case "trial":
      return {
        messagesPerDay: TRIAL_MESSAGES_PER_DAY,
        canUseTools: false,
        canUseWebSearch: true,
        modelTier: "medium",
      };
    case "expired":
      return {
        messagesPerDay: EXPIRED_MESSAGES_PER_DAY,
        canUseTools: false,
        canUseWebSearch: false,
        modelTier: "basic",
      };
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

/**
 * Check if user has unlimited access
 */
export function hasUnlimitedAccess(user: UserRecord): boolean {
  return user.role === "owner" || user.role === "vip" || user.role === "subscriber";
}

/**
 * Check if user is an owner
 */
export function isOwner(user: UserRecord): boolean {
  return user.role === "owner";
}

/**
 * Check if user has active trial
 */
export function hasActiveTrial(user: UserRecord): boolean {
  if (user.role !== "trial") {
    return false;
  }

  if (!user.trialExpiresAt) {
    return false;
  }

  return Date.now() < user.trialExpiresAt;
}

/**
 * Check if user has active subscription
 */
export function hasActiveSubscription(user: UserRecord): boolean {
  if (user.role !== "subscriber") {
    return false;
  }

  if (!user.subscriptionExpiresAt) {
    return false;
  }

  return Date.now() < user.subscriptionExpiresAt;
}

/**
 * Get user's display status
 */
export function getUserDisplayStatus(user: UserRecord): string {
  switch (user.role) {
    case "owner":
      return "Owner";
    case "vip":
      return "VIP";
    case "subscriber":
      return user.subscriptionPlan === "premium" ? "Premium Subscriber" : "Starter Subscriber";
    case "trial": {
      if (!hasActiveTrial(user)) {
        return "Trial Expired";
      }
      const daysLeft = Math.ceil(((user.trialExpiresAt ?? 0) - Date.now()) / (24 * 60 * 60 * 1000));
      return `Trial (${daysLeft} days left)`;
    }
    case "expired":
      return "Expired";
    default: {
      const _exhaustive: never = user.role;
      return _exhaustive;
    }
  }
}

/**
 * Format expiration date
 */
export function formatExpirationDate(timestamp: number | null | undefined): string | null {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

/**
 * Get days until expiration
 */
export function getDaysUntilExpiration(timestamp: number | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const now = Date.now();
  if (now >= timestamp) {
    return 0;
  }

  return Math.ceil((timestamp - now) / (24 * 60 * 60 * 1000));
}
