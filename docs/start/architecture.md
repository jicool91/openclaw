# Архитектура

Обзор технической архитектуры OpenClaw Bot.

## Общая схема

```
┌─────────────┐
│  Telegram   │
│   User      │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────┐
│     grammY Bot Framework         │
│  ┌────────────────────────────┐  │
│  │  Message Handler           │  │
│  │  ├─ Authorization Check    │  │
│  │  ├─ Rate Limiting          │  │
│  │  └─ Dispatch to Agent      │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  Payment Handlers          │  │
│  │  ├─ pre_checkout_query     │  │
│  │  └─ successful_payment     │  │
│  └────────────────────────────┘  │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│        User Store                │
│  (users.json / SQLite)           │
│  ├─ User records                 │
│  ├─ Subscription status          │
│  └─ Usage statistics             │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│      AI Agent Core               │
│  ├─ Per-user sessions            │
│  ├─ Context management           │
│  ├─ Model routing                │
│  └─ Tool execution               │
└──────────────────────────────────┘
```

## Компоненты

### 1. Telegram Bot (grammY)

**Технология**: grammY framework
**Файлы**: `src/telegram/bot.ts`, `src/telegram/bot-message-context.ts`

Обрабатывает входящие сообщения и команды от пользователей:

- Получение сообщений от Telegram API
- Парсинг команд (`/start`, `/subscribe`, и т.д.)
- Deep linking (invite-коды, referral-ссылки)
- Отправка ответов пользователям

### 2. Authorization Middleware

**Файлы**: `src/telegram/bot-message-context.ts`

Проверяет права доступа перед обработкой сообщения:

1. Получить `telegramUserId` из сообщения
2. Загрузить `UserRecord` из User Store
3. Проверить роль и лимиты (`checkAccess`)
4. Разрешить/запретить/показать промпт на подписку

### 3. User Store

**Файлы**: `src/store/user-store.ts` (планируется)
**Хранилище**: `/data/.openclaw/users.json` или SQLite

Хранит информацию о пользователях:

```typescript
type UserRecord = {
  telegramUserId: number;
  username?: string;
  firstName?: string;
  role: "owner" | "vip" | "subscriber" | "trial" | "expired";
  createdAt: number;
  trialExpiresAt?: number;
  subscriptionExpiresAt?: number;
  subscriptionPlan?: "starter" | "premium";
  messagesUsedToday: number;
  lastMessageDate: string; // YYYY-MM-DD
  totalTokensUsed: number;
  totalCostUsd: number;
};
```

### 4. Payment Handlers

**Технология**: Telegram Bot API (sendInvoice, Stars)
**Файлы**: `src/telegram/payment-handlers.ts` (планируется)

Обработка платежей через Telegram Stars:

**pre_checkout_query** (< 10 сек ответ обязателен):

- Валидация пользователя
- Проверка доступности плана
- `answerPreCheckoutQuery(true)`

**successful_payment**:

- Активация/продление подписки в User Store
- Обновление `subscriptionExpiresAt` (+30 дней)
- Сохранение `subscriptionChargeId` для refund

### 5. Agent Core

**Файлы**: `src/agents/`, `src/session/`

Запуск AI-агента для обработки сообщения:

- **Per-user sessions** — изолированная память для каждого `telegramUserId`
- **Context management** — загрузка истории сообщений
- **Model routing** — выбор модели на основе тарифа
- **Tool execution** — выполнение команд (web search, code execution, etc.)

### 6. Rate Limiter

**Файлы**: `src/telegram/rate-limiter.ts` (планируется)

Проверка лимитов перед отправкой сообщения агенту:

- Сброс счетчика `messagesUsedToday` если `lastMessageDate !== today`
- Проверка `messagesUsedToday < limit[role]`
- Инкремент счетчика при успешной отправке

## Поток обработки сообщения

```
1. Telegram API → grammY bot.on("message")
   ↓
2. Authorization Middleware
   ├─ getUserRecord(telegramUserId)
   ├─ checkAccess(user, messageType)
   └─ allow / deny / prompt_subscribe
   ↓
3. Rate Limiter
   ├─ messagesUsedToday < limit?
   └─ increment counter
   ↓
4. Agent Core
   ├─ Load session (per-user)
   ├─ Select model (based on plan)
   ├─ Execute tools
   └─ Generate response
   ↓
5. Send response to Telegram
```

## Поток оплаты

```
1. User → /subscribe
   ↓
2. Bot → sendInvoice(currency: "XTR", subscription_period: 2592000)
   ↓
3. Telegram → показывает нативный UI оплаты
   ↓
4. User → оплачивает (2 тапа)
   ↓
5. Telegram → bot.on("pre_checkout_query")
   ├─ Validate user/plan
   └─ answerPreCheckoutQuery(true) [< 10 сек!]
   ↓
6. Telegram → bot.on("message:successful_payment")
   ├─ Update User Store
   ├─ subscriptionExpiresAt = now + 30 days
   └─ Send confirmation message
   ↓
7. Через 30 дней → Telegram auto-renew
   └─ successful_payment снова (если не отменено)
```

## Технологический стек

| Компонент     | Технология                           |
| ------------- | ------------------------------------ |
| Bot Framework | grammY                               |
| Runtime       | Node.js 22+ / Bun                    |
| Language      | TypeScript                           |
| Payment       | Telegram Stars                       |
| Hosting       | Railway                              |
| Database      | JSON / SQLite (планируется Postgres) |
| AI Models     | OpenAI, Anthropic, и др.             |

## Безопасность

- **dmPolicy: "open"** — любой может написать боту
- **dmScope: "per-peer"** — изолированные сессии для каждого пользователя
- **Per-agent memory** — owner не видит сообщения публичных пользователей
- **Rate limiting** — защита от спама и перерасхода

## Что дальше?

- [Настройка бота](/admin/setup) — деплой и конфигурация
- [База данных](/reference/database-schema) — структура User Store
- [Payment Handlers](/telegram/payment-handlers) — имплементация оплаты
