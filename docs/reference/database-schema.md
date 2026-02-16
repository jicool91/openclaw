# Database Schema

Структура хранения данных пользователей в OpenClaw Bot.

## User Store

Хранилище пользователей содержит всю информацию о каждом пользователе бота.

### Текущая реализация

**Файл**: `/data/.openclaw/users.json` (временно)

**Планируется**: SQLite или PostgreSQL

---

## UserRecord

Основная структура данных пользователя.

### TypeScript определение

```typescript
type UserRecord = {
  // Идентификация
  telegramUserId: number;
  username?: string;
  firstName?: string;
  lastName?: string;

  // Роль и доступ
  role: "owner" | "vip" | "subscriber" | "trial" | "expired";

  // Временные метки
  createdAt: number; // Unix timestamp (мс)
  updatedAt?: number; // Unix timestamp (мс)

  // Trial
  trialExpiresAt?: number; // Unix timestamp (мс)

  // Подписка
  subscriptionPlan?: "starter" | "premium";
  subscriptionExpiresAt?: number; // Unix timestamp (мс)
  subscriptionChargeId?: string; // для refund/cancel
  autoRenew?: boolean; // авто-продление (default: true)

  // Invite
  invitedBy?: number; // Telegram ID пригласившего
  inviteCode?: string; // Код с которым пришел

  // Лимиты (daily reset)
  messagesUsedToday: number;
  lastMessageDate: string; // YYYY-MM-DD (UTC)

  // Статистика (lifetime)
  totalMessagesUsed: number;
  totalTokensUsed: number;
  totalCostUsd: number;
};
```

### Пример записи

```json
{
  "telegramUserId": 123456789,
  "username": "johndoe",
  "firstName": "John",
  "lastName": "Doe",
  "role": "subscriber",
  "createdAt": 1707264000000,
  "updatedAt": 1708128000000,
  "subscriptionPlan": "premium",
  "subscriptionExpiresAt": 1710720000000,
  "subscriptionChargeId": "tch_abc123xyz",
  "autoRenew": true,
  "invitedBy": null,
  "inviteCode": null,
  "messagesUsedToday": 12,
  "lastMessageDate": "2026-02-16",
  "totalMessagesUsed": 450,
  "totalTokensUsed": 125000,
  "totalCostUsd": 6.25
}
```

---

## Поля детально

### Идентификация

#### `telegramUserId` (number, required)

Уникальный Telegram ID пользователя.

**Пример**: `123456789`

**Использование**: Primary key

---

#### `username` (string, optional)

Telegram username (без `@`).

**Пример**: `"johndoe"`

**Может измениться**: да (пользователь может сменить username)

---

#### `firstName` (string, optional)

Имя пользователя в Telegram.

**Пример**: `"John"`

---

#### `lastName` (string, optional)

Фамилия пользователя в Telegram.

**Пример**: `"Doe"`

---

### Роль и доступ

#### `role` (enum, required)

Текущая роль пользователя.

**Возможные значения**:

- `"owner"` — владелец бота
- `"vip"` — VIP доступ (бесплатный)
- `"subscriber"` — платная подписка
- `"trial"` — тестовый период
- `"expired"` — истекший доступ

**Default**: `"trial"` (при создании)

Подробнее: [User Roles](/reference/user-roles)

---

### Временные метки

#### `createdAt` (number, required)

Время создания записи (Unix timestamp в миллисекундах).

**Пример**: `1707264000000` (07.02.2026 00:00:00 UTC)

**Использование**: Отслеживание регистрации

---

#### `updatedAt` (number, optional)

Время последнего обновления записи.

**Пример**: `1708128000000`

**Обновляется при**: изменении любого поля

---

### Trial

#### `trialExpiresAt` (number, optional)

Время истечения trial (Unix timestamp).

**Пример**: `1707868800000` (14.02.2026)

**Присутствует если**: `role === "trial"`

**Что происходит при истечении**:

```typescript
if (now > trialExpiresAt) {
  role = "expired";
}
```

---

### Подписка

#### `subscriptionPlan` (enum, optional)

Тип подписки.

**Возможные значения**:

- `"starter"` — 100 Stars/мес
- `"premium"` — 300 Stars/мес

**Присутствует если**: `role === "subscriber"`

---

#### `subscriptionExpiresAt` (number, optional)

Время истечения подписки (Unix timestamp).

**Пример**: `1710720000000` (18.03.2026)

**Присутствует если**: `role === "subscriber"`

**Авто-продление**:

```typescript
if (now > subscriptionExpiresAt && autoRenew) {
  // Telegram снимает Stars автоматически
  // Bot получает successful_payment event
  subscriptionExpiresAt = now + 30 days;
}
```

---

#### `subscriptionChargeId` (string, optional)

Telegram Charge ID последнего платежа.

**Пример**: `"tch_abc123xyz456"`

**Использование**: Для refund через `bot.api.refundStarPayment()`

---

#### `autoRenew` (boolean, optional)

Включено ли авто-продление.

**Default**: `true`

**Изменяется при**: `/cancel` → `false`

---

### Invite

#### `invitedBy` (number, optional)

Telegram ID пользователя, который пригласил (обычно owner).

**Пример**: `987654321`

**Присутствует если**: пользователь пришел по invite-ссылке

---

#### `inviteCode` (string, optional)

Invite-код с которым пришел пользователь.

**Пример**: `"inv_abc123def456"`

**Использование**: Отслеживание эффективности invite-ссылок

---

### Лимиты (daily reset)

#### `messagesUsedToday` (number, required)

Количество сообщений использованных сегодня.

**Default**: `0`

**Сброс**: Каждый день в 00:00 UTC

**Логика**:

```typescript
if (lastMessageDate !== today) {
  messagesUsedToday = 0;
  lastMessageDate = today;
}
```

---

#### `lastMessageDate` (string, required)

Дата последнего сообщения (YYYY-MM-DD UTC).

**Пример**: `"2026-02-16"`

**Использование**: Для сброса `messagesUsedToday`

---

### Статистика (lifetime)

#### `totalMessagesUsed` (number, required)

Общее количество сообщений за все время.

**Default**: `0`

**Инкремент**: При каждом сообщении

---

#### `totalTokensUsed` (number, required)

Общее количество токенов использованных за все время.

**Default**: `0`

**Использование**: Аналитика, статистика расходов

---

#### `totalCostUsd` (number, required)

Общая стоимость использования API в USD.

**Default**: `0`

**Расчет**:

```typescript
totalCostUsd += tokensUsed * modelCostPerToken;
```

---

## Операции с UserRecord

### Создание нового пользователя

```typescript
async function createUser(telegramUserId: number, firstName?: string): Promise<UserRecord> {
  const now = Date.now();
  const trialDays = 7;

  const user: UserRecord = {
    telegramUserId,
    firstName,
    role: "trial",
    createdAt: now,
    trialExpiresAt: now + trialDays * 24 * 60 * 60 * 1000,
    messagesUsedToday: 0,
    lastMessageDate: new Date().toISOString().split("T")[0],
    totalMessagesUsed: 0,
    totalTokensUsed: 0,
    totalCostUsd: 0,
  };

  await saveUser(user);
  return user;
}
```

### Активация подписки

```typescript
async function activateSubscription(
  userId: number,
  plan: "starter" | "premium",
  chargeId: string,
): Promise<void> {
  const user = await getUser(userId);
  const now = Date.now();

  user.role = "subscriber";
  user.subscriptionPlan = plan;
  user.subscriptionExpiresAt = now + 30 * 24 * 60 * 60 * 1000;
  user.subscriptionChargeId = chargeId;
  user.autoRenew = true;
  user.updatedAt = now;

  await saveUser(user);
}
```

### Проверка лимита

```typescript
async function checkMessageLimit(userId: number): Promise<boolean> {
  const user = await getUser(userId);
  const today = new Date().toISOString().split("T")[0];

  // Сброс счетчика если новый день
  if (user.lastMessageDate !== today) {
    user.messagesUsedToday = 0;
    user.lastMessageDate = today;
    await saveUser(user);
  }

  // Получить лимит для роли
  const limit = getRoleLimit(user.role, user.subscriptionPlan);

  // Проверка
  return user.messagesUsedToday < limit;
}
```

### Инкремент использования

```typescript
async function incrementUsage(userId: number, tokensUsed: number, costUsd: number): Promise<void> {
  const user = await getUser(userId);

  user.messagesUsedToday += 1;
  user.totalMessagesUsed += 1;
  user.totalTokensUsed += tokensUsed;
  user.totalCostUsd += costUsd;
  user.updatedAt = Date.now();

  await saveUser(user);
}
```

---

## Миграция на SQL

### Планируемая SQL схема

```sql
CREATE TABLE users (
  telegram_user_id BIGINT PRIMARY KEY,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),

  role VARCHAR(50) NOT NULL DEFAULT 'trial',

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,

  trial_expires_at TIMESTAMP,

  subscription_plan VARCHAR(50),
  subscription_expires_at TIMESTAMP,
  subscription_charge_id VARCHAR(255),
  auto_renew BOOLEAN DEFAULT TRUE,

  invited_by BIGINT,
  invite_code VARCHAR(255),

  messages_used_today INT NOT NULL DEFAULT 0,
  last_message_date DATE NOT NULL,

  total_messages_used BIGINT NOT NULL DEFAULT 0,
  total_tokens_used BIGINT NOT NULL DEFAULT 0,
  total_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0
);

CREATE INDEX idx_role ON users(role);
CREATE INDEX idx_subscription_expires_at ON users(subscription_expires_at);
CREATE INDEX idx_invited_by ON users(invited_by);
```

---

## Что дальше?

- [User Roles](/reference/user-roles) — роли и права доступа
- [Rate Limits](/reference/rate-limits) — лимиты по ролям
- [Admin User Management](/admin/user-management) — управление пользователями
