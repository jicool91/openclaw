# Rate Limits

Лимиты использования по ролям и тарифам.

## Обзор лимитов

| Роль                 | Сообщений/день | Срок      | Модель        | Инструменты |
| -------------------- | -------------- | --------- | ------------- | ----------- |
| trial                | 5              | 7 дней    | gemini-flash  | чат         |
| expired              | 2              | —         | gemini-flash  | чат         |
| subscriber (Starter) | 30             | 30 дней   | gemini-pro    | чат + web   |
| subscriber (Premium) | ∞              | 30 дней   | gpt-4o/claude | все         |
| vip                  | ∞              | бессрочно | best          | все         |
| owner                | ∞              | бессрочно | best          | все + admin |

---

## Лимиты сообщений

### Trial

**Лимит**: 5 сообщений/день

**Логика**:

```typescript
const TRIAL_DAILY_LIMIT = 5;

if (user.role === "trial") {
  if (user.messagesUsedToday >= TRIAL_DAILY_LIMIT) {
    return "❌ Лимит исчерпан (5/5). Подождите до завтра или /subscribe";
  }
}
```

**Сброс**: Каждый день в 00:00 UTC

---

### Expired

**Лимит**: 2 сообщения/день

**Логика**:

```typescript
const EXPIRED_DAILY_LIMIT = 2;

if (user.role === "expired") {
  if (user.messagesUsedToday >= EXPIRED_DAILY_LIMIT) {
    return "❌ Лимит исчерпан (2/2). Оформите подписку: /subscribe";
  }
}
```

---

### Subscriber (Starter)

**Лимит**: 30 сообщений/день

**Логика**:

```typescript
const STARTER_DAILY_LIMIT = 30;

if (user.role === "subscriber" && user.subscriptionPlan === "starter") {
  if (user.messagesUsedToday >= STARTER_DAILY_LIMIT) {
    return "❌ Лимит исчерпан (30/30). Upgrade до Premium: /subscribe";
  }
}
```

---

### Subscriber (Premium)

**Лимит**: Безлимит ∞

**Логика**:

```typescript
if (user.role === "subscriber" && user.subscriptionPlan === "premium") {
  // No limit
}
```

**Примечание**: Технически может быть soft limit (~200/день) для защиты от abuse, но пользователь не видит его.

---

### VIP и Owner

**Лимит**: Безлимит ∞

**Логика**:

```typescript
if (user.role === "vip" || user.role === "owner") {
  // No limit
}
```

---

## Лимиты токенов (планируется)

В будущем могут быть введены лимиты по токенам вместо сообщений:

| Роль    | Токенов/день | Токенов/сообщение (средн.) |
| ------- | ------------ | -------------------------- |
| trial   | 10,000       | 2,000 (5 сообщений)        |
| starter | 60,000       | 2,000 (30 сообщений)       |
| premium | ∞            | —                          |

**Преимущества**:

- Более справедливо (короткие вопросы не "крадут" квоту)
- Защита от длинных промптов

**Недостатки**:

- Сложнее объяснить пользователям
- Нужен UI для отображения токенов

---

## Временные лимиты

### Trial период

**Длительность**: 7 дней

**Отсчет**: С момента первого `/start`

**Логика**:

```typescript
const now = Date.now();
const TRIAL_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 дней

if (user.role === "trial") {
  if (now > user.trialExpiresAt) {
    user.role = "expired";
    await saveUser(user);
  }
}
```

---

### Подписка

**Длительность**: 30 дней

**Авто-продление**: Да (если включено)

**Логика**:

```typescript
const now = Date.now();

if (user.role === "subscriber") {
  if (now > user.subscriptionExpiresAt) {
    if (user.autoRenew) {
      // Telegram снимет Stars автоматически
      // Бот получит successful_payment и продлит
    } else {
      user.role = "expired";
      await saveUser(user);
    }
  }
}
```

---

## Лимиты по моделям

### Доступные модели

| Роль          | Модель              | Качество   | Стоимость/1K токенов |
| ------------- | ------------------- | ---------- | -------------------- |
| trial/expired | gemini-flash        | ⭐⭐       | $0.001               |
| starter       | gemini-pro          | ⭐⭐⭐     | $0.005               |
| premium       | gpt-4o              | ⭐⭐⭐⭐⭐ | $0.020               |
| vip/owner     | claude-3.5 / gpt-4o | ⭐⭐⭐⭐⭐ | $0.015-0.020         |

**Логика выбора модели**:

```typescript
function getModelForUser(user: UserRecord): string {
  if (user.role === "owner" || user.role === "vip") {
    return "claude-3.5-sonnet"; // или gpt-4o
  }

  if (user.role === "subscriber") {
    if (user.subscriptionPlan === "premium") {
      return "gpt-4o";
    }
    if (user.subscriptionPlan === "starter") {
      return "gemini-pro"; // или gemini-flash для экономии
    }
  }

  // trial, expired
  return "gemini-flash";
}
```

---

## Лимиты по инструментам

### Доступ к инструментам

| Инструмент         | Trial | Starter | Premium | VIP/Owner       |
| ------------------ | ----- | ------- | ------- | --------------- |
| **Чат**            | ✅    | ✅      | ✅      | ✅              |
| **Web Search**     | ❌    | ✅      | ✅      | ✅              |
| **Firecrawl**      | ❌    | ❌      | ✅      | ✅              |
| **Code Execution** | ❌    | ❌      | ✅      | ✅              |
| **Admin Commands** | ❌    | ❌      | ❌      | ✅ (owner only) |

**Логика**:

```typescript
function getAllowedTools(user: UserRecord): string[] {
  const tools = ["chat"];

  if (user.role === "subscriber" && user.subscriptionPlan === "starter") {
    tools.push("web_search");
  }

  if (
    (user.role === "subscriber" && user.subscriptionPlan === "premium") ||
    user.role === "vip" ||
    user.role === "owner"
  ) {
    tools.push("web_search", "firecrawl", "code_execution");
  }

  if (user.role === "owner") {
    tools.push("admin_commands");
  }

  return tools;
}
```

---

## Soft Limits (защита от abuse)

### Rate limiting

Для защиты от спама и abuse, даже безлимитные пользователи могут иметь soft limits:

**Premium/VIP/Owner**:

- Максимум **200 сообщений/день** (предупреждение)
- Максимум **10 сообщений/минуту** (throttling)

**Логика**:

```typescript
const PREMIUM_SOFT_LIMIT = 200;
const BURST_LIMIT = 10; // сообщений/мин

if (user.messagesUsedToday > PREMIUM_SOFT_LIMIT) {
  await notifyOwner(
    `User ${user.telegramUserId} exceeded soft limit (${user.messagesUsedToday} messages)`,
  );
  // Не блокируем, но логируем
}

if (user.messagesInLastMinute > BURST_LIMIT) {
  return "⚠️ Слишком много сообщений. Подождите минуту.";
}
```

---

## Сброс лимитов

### Дневной сброс

**Время**: 00:00 UTC каждый день

**Логика**:

```typescript
const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

if (user.lastMessageDate !== today) {
  user.messagesUsedToday = 0;
  user.lastMessageDate = today;
  await saveUser(user);
}
```

---

## Уведомления о лимитах

### Trial близок к исчерпанию

```typescript
if (user.role === "trial" && user.messagesUsedToday === 4) {
  await bot.sendMessage(userId, "⚠️ Осталось 1 сообщение на сегодня. Завтра сброс или /subscribe");
}
```

### Trial истекает скоро

```typescript
const daysLeft = Math.floor((user.trialExpiresAt - now) / (24 * 60 * 60 * 1000));

if (daysLeft === 1) {
  await bot.sendMessage(userId, "⚠️ Trial заканчивается завтра. Оформите подписку: /subscribe");
}
```

### Подписка истекает скоро

```typescript
const daysLeft = Math.floor((user.subscriptionExpiresAt - now) / (24 * 60 * 60 * 1000));

if (daysLeft === 3) {
  await bot.sendMessage(
    userId,
    "⚠️ Подписка истекает через 3 дня. Убедитесь что достаточно Stars.",
  );
}
```

---

## Что дальше?

- [User Roles](/reference/user-roles) — роли и права доступа
- [Database Schema](/reference/database-schema) — структура UserRecord
- [Тарифные планы](/payment/plans) — подробнее о тарифах
