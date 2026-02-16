/**
 * User roles in the system
 */
export type UserRole = "owner" | "vip" | "subscriber" | "trial" | "expired";

/**
 * Subscription plan types
 */
export type SubscriptionPlan = "starter" | "premium";

/**
 * Complete user record stored in the database
 */
export type UserRecord = {
  // Identification
  readonly telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;

  // Role and access
  role: UserRole;

  // Timestamps
  readonly createdAt: number; // Unix timestamp (ms)
  updatedAt?: number | null; // Unix timestamp (ms)

  // Trial
  trialExpiresAt?: number | null; // Unix timestamp (ms)

  // Subscription (for future use)
  subscriptionPlan?: SubscriptionPlan | null;
  subscriptionExpiresAt?: number | null; // Unix timestamp (ms)
  subscriptionChargeId?: string | null; // for refund/cancel
  autoRenew?: boolean | null; // default: true

  // Invite (for future use)
  invitedBy?: number | null; // Telegram ID of inviter
  inviteCode?: string | null; // Invite code used

  // Daily limits (reset at 00:00 UTC)
  messagesUsedToday: number;
  lastMessageDate: string; // YYYY-MM-DD (UTC)

  // Lifetime statistics
  totalMessagesUsed: number;
  totalTokensUsed: number;
  totalCostUsd: number;
};

/**
 * Create user options
 */
export type CreateUserOptions = {
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole; // defaults to "trial"
  trialDays?: number; // defaults to 7
};

/**
 * Update user options
 */
export type UpdateUserOptions = Partial<Omit<UserRecord, "telegramUserId" | "createdAt">>;

/**
 * User stats query options
 */
export type UserStatsOptions = {
  period?: "today" | "week" | "month" | "all";
};
