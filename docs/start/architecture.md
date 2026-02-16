# Архитектура

Обзор технической архитектуры проекта: как наши фичи (подписки, роли, оплата) работают поверх ядра OpenClaw Platform.

## Принцип: ядро + обёртки

Мы **НЕ** заменяем OpenClaw, а строим поверх него. Вся core-функциональность (Gateway, Agent, Sessions, Telegram channel, Tools, Models) — это ядро OpenClaw. Наши добавления — тонкие обёртки для монетизации и управления доступом.

```
┌─────────────────────────────────────────────────────────┐
│                  Telegram User                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  НАША ОБЁРТКА: Access Control Layer                     │
│  src/telegram/access-control.ts                         │
│  src/telegram/user-store.ts                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 1. Получить userId из message.from                 │ │
│  │ 2. Найти/создать UserRecord в User Store           │ │
│  │ 3. Проверить роль, trial, подписку, лимиты         │ │
│  │ 4. Разрешить → передать в ядро OpenClaw            │ │
│  │    Запретить → показать prompt на подписку          │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ (если доступ разрешён)
                         ▼
┌─────────────────────────────────────────────────────────┐
│  ЯДРО OPENCLAW PLATFORM                                 │
│                                                         │
│  ┌─────────────────┐  ┌────────────────────────────┐    │
│  │ Gateway WS API  │  │ Telegram Channel (grammY)  │    │
│  │ Port 8080       │  │ Long-polling / Webhooks    │    │
│  └─────────────────┘  └────────────────────────────┘    │
│                                                         │
│  ┌─────────────────┐  ┌────────────────────────────┐    │
│  │ Agent Runtime   │  │ Session Management         │    │
│  │ Pi embedded     │  │ Per-user isolation          │    │
│  │ Tool streaming  │  │ Compaction & pruning        │    │
│  └─────────────────┘  └────────────────────────────┘    │
│                                                         │
│  ┌─────────────────┐  ┌────────────────────────────┐    │
│  │ Model Routing   │  │ Tools & Skills             │    │
│  │ Anthropic, OAI  │  │ Browser, exec, web search  │    │
│  │ Google, Ollama  │  │ Canvas, file ops           │    │
│  └─────────────────┘  └────────────────────────────┘    │
│                                                         │
│  ┌─────────────────┐  ┌────────────────────────────┐    │
│  │ Config System   │  │ Hooks & Plugins            │    │
│  │ openclaw.json   │  │ Event-driven extensibility │    │
│  └─────────────────┘  └────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Что даёт ядро OpenClaw (НЕ трогаем)

Полная документация ядра: [docs.openclaw.ai](https://docs.openclaw.ai)

### Gateway

WebSocket API для управления соединениями. Уже встроено:

- Telegram/Discord/Slack/WhatsApp/Signal каналы
- Health monitoring, heartbeat
- Webchat Control UI
- Nodes & device pairing

Конфигурация: `openclaw.json` → `gateway: { port, auth, mode }`

### Agent Runtime

AI-агент с per-user sessions. Уже встроено:

- System prompt из AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md
- Compaction (сжатие длинных сессий)
- Tool streaming и block streaming
- Multi-agent с sub-agents
- Workspace bootstrapping из templates

Конфигурация: `openclaw.json` → `agents: { defaults, list }`

### Telegram Channel

Полная интеграция через grammY. Уже встроено:

- Long-polling и webhook режимы
- DM policy (pairing, allowlist, open)
- Group support с requireMention
- Custom commands registration
- Media handling (images, audio, video, stickers)
- Reply-to mode, link preview, stream mode
- Retry policy, proxy support

Конфигурация: `openclaw.json` → `channels: { telegram: { ... } }`

### Config System

Стандартная конфигурация через `~/.openclaw/openclaw.json`:

```json5
{
  gateway: { mode: "local", port: 8080 },
  channels: {
    telegram: {
      enabled: true,
      botToken: "TOKEN",
      dmPolicy: "open",
      customCommands: [
        { command: "plan", description: "Текущий план и статистика" },
        { command: "subscribe", description: "Оформить подписку" },
      ],
    },
  },
  agents: {
    defaults: {
      model: { primary: "google/gemini-3-pro-preview" },
    },
  },
}
```

CLI: `openclaw config get/set/unset` для управления.

## Что добавляем мы (обёртки)

### 1. User Store (`src/telegram/user-store.ts`)

Хранит информацию о подписках и ролях пользователей. **Это НЕ замена OpenClaw sessions** — sessions управляют AI-контекстом, User Store управляет бизнес-логикой подписок.

```typescript
type UserRecord = {
  telegramUserId: number;
  role: "owner" | "vip" | "subscriber" | "trial" | "expired";
  messagesUsedToday: number;
  lastMessageDate: string; // YYYY-MM-DD, сброс ежедневно
  trialExpiresAt?: number;
  subscriptionExpiresAt?: number;
  totalMessagesUsed: number;
};
```

Хранилище: `/data/.openclaw/users.json` (атомарная запись через tmp + rename).

### 2. Access Control (`src/telegram/access-control.ts`)

Тонкая прослойка перед ядром OpenClaw. Проверяет:

1. Trial не истёк?
2. Подписка активна?
3. Дневной лимит не превышен?
4. → Разрешить → передать сообщение в Agent Runtime (ядро)
5. → Запретить → показать prompt на подписку

### 3. Роли (`src/telegram/user-roles.ts`)

Discriminated union с exhaustive checking:

| Роль         | Лимит сообщений | Источник               |
| ------------ | --------------- | ---------------------- |
| `owner`      | безлимит        | `ADMIN_TELEGRAM_IDS`   |
| `vip`        | безлимит        | Invite-ссылка от owner |
| `subscriber` | безлимит        | Оплата через Stars     |
| `trial`      | 5/день          | Первый `/start`        |
| `expired`    | 2/день          | Истёк trial/подписка   |

### 4. Подписочные команды (`src/telegram/bot-native-commands.ts`)

Команды зарегистрированные через стандартный механизм OpenClaw `customCommands`:

- `/start` — приветствие, создание trial
- `/plan` — текущий план и статистика
- `/subscribe` — оформление подписки через Telegram Stars

### 5. Payment Handlers (планируется)

Обработка Telegram Stars через grammY (уже встроен в ядро):

- `pre_checkout_query` — валидация перед оплатой
- `successful_payment` — активация подписки в User Store

## Поток обработки сообщения

```
1. Telegram API → grammY (ЯДРО OpenClaw)
   ↓
2. Access Control Layer (НАША ОБЁРТКА)
   ├─ getUserRecord(userId) из User Store
   ├─ canSendMessage(user) — проверка роли/лимитов
   └─ allowed → continue / denied → prompt subscribe
   ↓
3. Agent Runtime (ЯДРО OpenClaw)
   ├─ Load session (per-user, стандартный механизм)
   ├─ Build context (AGENTS.md + SOUL.md + IDENTITY.md)
   ├─ Select model (из openclaw.json)
   ├─ Execute tools (browser, exec, web search)
   └─ Generate response
   ↓
4. Send response → Telegram (ЯДРО OpenClaw)
   ↓
5. Increment usage counter (НАША ОБЁРТКА)
   └─ userStore.incrementUsage(userId, tokens, cost)
```

## Технологический стек

| Слой               | Технология                               | Источник |
| ------------------ | ---------------------------------------- | -------- |
| Платформа          | OpenClaw Platform                        | Ядро     |
| Gateway            | WebSocket API                            | Ядро     |
| Telegram           | grammY framework                         | Ядро     |
| Agent Runtime      | Pi embedded runner                       | Ядро     |
| Session Management | Per-user isolation, compaction           | Ядро     |
| Model Routing      | Anthropic, OpenAI, Google, Ollama        | Ядро     |
| Config             | openclaw.json                            | Ядро     |
| **User Store**     | **JSON file (users.json)**               | Обёртка  |
| **Access Control** | **Middleware перед agent dispatch**      | Обёртка  |
| **Roles & Limits** | **Discriminated unions + daily counter** | Обёртка  |
| **Payment**        | **Telegram Stars (через grammY)**        | Обёртка  |
| Hosting            | Railway                                  | Деплой   |

## Правила развития

1. **Не модифицировать ядро** — все наши фичи через обёртки, hooks, plugins
2. **Использовать стандартную конфигурацию** — `openclaw.json`, не кастомный config.yaml
3. **Обновлять из upstream** — следить за обновлениями OpenClaw Platform
4. **Чётко разделять** — файлы ядра vs наши файлы (user-store, access-control, user-roles, owner-config)
5. **Документировать что ядро, что обёртка** — в каждом файле

## Официальная документация OpenClaw

Полная документация ядра: [docs.openclaw.ai](https://docs.openclaw.ai)

Ключевые разделы:

- [Архитектура](https://docs.openclaw.ai/concepts/architecture)
- [Конфигурация](https://docs.openclaw.ai/gateway/configuration)
- [Telegram Channel](https://docs.openclaw.ai/channels/telegram)
- [Agent Runtime](https://docs.openclaw.ai/concepts/agent)
- [Sessions](https://docs.openclaw.ai/concepts/session)
- [Hooks & Plugins](https://docs.openclaw.ai/tools/plugin)
- [Tools](https://docs.openclaw.ai/tools)
- [Skills](https://docs.openclaw.ai/tools/skills)

## Что дальше?

- [Настройка бота](/admin/setup)
- [Роли пользователей](/reference/user-roles)
- [База данных User Store](/reference/database-schema)
- [Тарифы и оплата](/payment/plans)
