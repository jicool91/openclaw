# Стек технологий

Обоснование выбора технологий для обёрток вокруг ядра OpenClaw Platform.

## Принцип выбора

Каждая технология выбирается по одному критерию: **совместимость с ядром OpenClaw**. Ядро — TypeScript/ESM, plugin SDK — TypeScript, hooks — TypeScript. Мы не вводим чужеродные технологии.

## Язык: TypeScript (ESM)

**Почему не Python/Go/Rust?**

OpenClaw Plugin SDK работает **in-process** — плагины загружаются через `jiti` прямо в runtime gateway. Это не HTTP-микросервисы, это нативные расширения:

```typescript
// openclaw.plugin.json
{
  "name": "subscription-wrapper",
  "openclaw": {
    "extensions": ["./src/access-control.ts", "./src/payment.ts"]
  }
}

// Плагин регистрируется in-process
export default function(api) {
  api.registerTool({ name: "check_subscription", ... });
}
```

Писать обёртки на другом языке = потерять:

- Нативные plugin hooks (`message_received`, `before_agent_start`)
- Прямой доступ к `api.registerTool()`
- Type safety с OpenClaw типами
- In-process скорость (без сетевых вызовов)

**Вывод**: TypeScript — не наш выбор, а требование платформы. Это правильно.

## Хранение данных: миграция JSON → SQLite → PostgreSQL

### Текущее состояние: JSON файл (MVP)

```
users.db (SQLite) → /data/.openclaw/users.db
```

**Проблемы**:

- Нет транзакций — гонки при параллельных записях
- Весь файл перезаписывается при каждом обновлении
- На Railway: файл теряется при редеплое (если нет volume)
- Нет SQL — невозможна аналитика
- Не масштабируется: 1000+ записей = тормоза

### Фаза 2: SQLite (ближайшая цель)

OpenClaw сам использует SQLite для persistent agent state (open-prose extension). Паттерн уже есть в экосистеме:

```typescript
// OpenClaw использует SQLite для state management
sqlite3 .prose/runs/{id}/state.db "SELECT memory FROM agents WHERE name = 'captain'"
```

Для наших обёрток:

```
/data/.openclaw/subscription.db
├── users          — профили и роли
├── subscriptions  — история подписок
├── payments       — транзакции Stars
├── usage_daily    — дневная статистика
└── invites        — VIP invite-ссылки
```

**Почему SQLite, а не сразу PostgreSQL**:

- Zero-config: один файл, нет отдельного сервиса
- Railway: volume mount = persistence
- Транзакции + WAL mode = конкурентный доступ
- SQL = аналитика (`SELECT role, COUNT(*) FROM users GROUP BY role`)
- better-sqlite3 — синхронный, быстрый, zero-dep для Node.js
- OpenClaw уже показывает паттерн использования SQLite

```typescript
import Database from "better-sqlite3";

const db = new Database("/data/.openclaw/subscription.db");
db.pragma("journal_mode = WAL");

// Миграции
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_user_id INTEGER PRIMARY KEY,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'trial',
    messages_used_today INTEGER DEFAULT 0,
    last_message_date TEXT,
    trial_expires_at INTEGER,
    subscription_expires_at INTEGER,
    subscription_plan TEXT,
    total_messages_used INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id INTEGER NOT NULL,
    charge_id TEXT UNIQUE,
    amount_stars INTEGER NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id)
  );
`);
```

**Зависимость**: `better-sqlite3` — единственная новая dep. Нативный модуль, но Railway поддерживает.

### Фаза 4: PostgreSQL (при масштабировании)

Когда нужно:

- 10K+ активных пользователей
- Несколько инстансов бота (горизонтальное масштабирование)
- Real-time аналитика и дашборды
- Резервное копирование и point-in-time recovery

Railway предоставляет managed PostgreSQL. Миграция SQLite → PostgreSQL:

- Схема остаётся той же (стандартный SQL)
- Меняется только connection layer
- Используем `pg` или `postgres` (slonik) npm package

**Не сейчас**: PostgreSQL — это отдельный сервис, конфиг, бэкапы, мониторинг. Оверкилл для MVP/Фазы 2.

## Rate Limiting: in-memory (ядро уже помогает)

**Почему НЕ Redis**:

- OpenClaw — single-process gateway. Один инстанс = один процесс
- Rate limiting для 5 сообщений/день — это `Map<userId, count>` в памяти + persist в SQLite
- Redis нужен при горизонтальном масштабировании (несколько инстансов). Это Фаза 4+
- Лишний сервис = лишние деньги на Railway

```typescript
// Достаточно для нашего масштаба
const dailyCounters = new Map<number, { count: number; date: string }>();

function checkLimit(userId: number, limit: number): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyCounters.get(userId);
  if (!entry || entry.date !== today) {
    dailyCounters.set(userId, { count: 1, date: today });
    return true;
  }
  return entry.count < limit;
}
```

## Кеширование: не нужно

- OpenClaw кеширует AI-ответы через session management
- Наши обёртки делают lookup по userId — это O(1) из SQLite или Map
- HTTP-кеш? У нас нет HTTP API (Telegram → grammY → наш код → ядро)

## Очереди: не нужны

- OpenClaw имеет свою [queue system](https://docs.openclaw.ai/concepts/queue) для сообщений
- Telegram rate limits (30 msg/sec) — grammY автоматически throttle-ит
- Payment processing — синхронный (Telegram Stars callback → update DB)

## Интеграция с ядром: Plugin Hooks

Сейчас наш код **модифицирует файлы ядра** (`bot.ts`, `bot-message.ts`). Это плохо — ломается при обновлении upstream.

**Целевая архитектура** — использование Plugin SDK:

```
extensions/
  subscription/
    openclaw.plugin.json    ← манифест плагина
    package.json            ← deps: better-sqlite3
    src/
      index.ts              ← registerPluginHooksFromDir(api, "./hooks")
      hooks/
        message-gate.ts     ← hook: message_received → access control
        payment.ts          ← hook: pre_checkout_query, successful_payment
        usage-tracker.ts    ← hook: message_sent → increment counter
      db/
        schema.ts           ← SQLite миграции
        queries.ts          ← prepared statements
      roles.ts              ← логика ролей
      commands/
        start.ts            ← /start command handler
        plan.ts             ← /plan command handler
        subscribe.ts        ← /subscribe command handler
```

Хуки которые нам нужны из ядра:

| Hook               | Наше использование                                 |
| ------------------ | -------------------------------------------------- |
| `message_received` | Access control: проверка роли/лимитов ДО обработки |
| `message_sent`     | Usage tracking: инкремент счётчика ПОСЛЕ ответа    |
| `session_start`    | Auto-создание trial юзера при первом контакте      |
| `gateway_start`    | Инициализация SQLite, миграции                     |

## Итоговый стек

```
┌─────────────────────────────────────────────────────────┐
│  НАШИ ОБЁРТКИ                                           │
│                                                         │
│  Язык:     TypeScript (ESM) — как ядро                  │
│  Форма:    OpenClaw Plugin (extensions/subscription/)    │
│  Хуки:    message_received, message_sent, gateway_start │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Access       │  │ User Store   │  │ Payment      │   │
│  │ Control      │  │              │  │ Handlers     │   │
│  │ (hook)       │  │ SQLite DB    │  │ (Stars)      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                         │                                │
│              /data/.openclaw/subscription.db             │
├─────────────────────────────────────────────────────────┤
│  ЯДРО OPENCLAW PLATFORM                                 │
│  TypeScript, grammY, Plugin SDK, Hooks, Gateway         │
└─────────────────────────────────────────────────────────┘
```

## План миграции

| Шаг | Что                                    | Когда                             |
| --- | -------------------------------------- | --------------------------------- |
| 1   | JSON → SQLite (better-sqlite3)         | Фаза 2 (следующий спринт)         |
| 2   | Прямое редактирование → Plugin hooks   | Фаза 2                            |
| 3   | In-memory rate limits + SQLite persist | Фаза 2                            |
| 4   | SQLite → PostgreSQL                    | Фаза 4 (при 10K+ юзеров)          |
| 5   | Redis для distributed rate limiting    | Фаза 4 (при нескольких инстансах) |

## Что НЕ добавляем

- **Redis** — оверкилл для single-process, нет горизонтального масштабирования
- **PostgreSQL сейчас** — лишний сервис, SQLite достаточно
- **MongoDB** — нет причин, SQL лучше для structured data с joins
- **Prisma/TypeORM** — overkill, better-sqlite3 + raw SQL достаточно
- **REST API** — нет внешних клиентов, всё in-process через plugin hooks
- **Message queue (RabbitMQ, etc.)** — ядро уже имеет queue system
- **Отдельный микросервис** — plugin SDK работает in-process, быстрее и проще
