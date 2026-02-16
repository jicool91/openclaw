# Конфигурация

Детальная настройка OpenClaw Bot через `config.yaml` и переменные окружения.

## Структура конфигурации

```
.
├── config.yaml          # Основная конфигурация
├── .env                 # Секреты (токены, ключи)
├── IDENTITY.md          # Персонализация агента
└── AGENTS.md            # Дополнительные промпты
```

---

## config.yaml

### Базовая конфигурация

```yaml
# Session settings
session:
  dmScope: "per-peer" # Изолированные сессии для каждого пользователя
  pruning:
    enabled: true
    keepDays: 30 # Удалять сессии старше 30 дней

# Channels
channels:
  telegram:
    dmPolicy: "open" # Любой может написать ("open" | "allowlist")
    allowFrom: ["*"] # Wildcard (или список ID)

# Agents
agents:
  list:
    - id: private
      default: false

    - id: public
      default: true

# Agent bindings (owner → private agent)
bindings:
  - agentId: private
    match:
      channel: telegram
      peer:
        kind: direct
        id: "YOUR_TELEGRAM_ID"
```

---

## Переменные окружения (.env)

### Обязательные

```bash
# Telegram Bot Token
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Admin IDs (владельцы)
ADMIN_TELEGRAM_IDS=123456789,987654321
```

### AI Models

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (GPT)
OPENAI_API_KEY=sk-...

# Google (Gemini)
GOOGLE_API_KEY=AIza...

# OpenRouter (альтернатива)
OPENROUTER_API_KEY=sk-or-...
```

### Инструменты (опционально)

```bash
# Brave Search (web search)
BRAVE_API_KEY=BSA...

# Firecrawl (web scraping)
FIRECRAWL_API_KEY=fc-...

# Perplexity (research)
PERPLEXITY_API_KEY=pplx-...
```

### База данных (опционально)

```bash
# SQLite (по умолчанию)
DATABASE_URL=sqlite:///data/.openclaw/users.db

# PostgreSQL (рекомендуется для production)
DATABASE_URL=postgresql://user:pass@host:5432/openclaw
```

---

## Конфигурация тарифов

### Файл: `src/config/plans.ts`

```typescript
export const PLANS = {
  trial: {
    messagesPerDay: 5,
    durationDays: 7,
    model: "gemini-flash",
    tools: ["chat"],
  },

  starter: {
    messagesPerDay: 30,
    price: 100, // Stars
    model: "gemini-pro",
    tools: ["chat", "web_search"],
  },

  premium: {
    messagesPerDay: Infinity,
    price: 300, // Stars
    model: "gpt-4o",
    tools: ["chat", "web_search", "firecrawl", "code_execution"],
  },
};
```

### Изменение цен

Отредактируйте `price`:

```typescript
starter: {
  price: 150, // Было 100, стало 150
}
```

Пересоберите:

```bash
pnpm build
```

---

## Конфигурация моделей

### Файл: `config.yaml`

```yaml
models:
  providers:
    - id: anthropic
      apiKey: ${ANTHROPIC_API_KEY}

    - id: openai
      apiKey: ${OPENAI_API_KEY}

    - id: google
      apiKey: ${GOOGLE_API_KEY}

  # Model routing
  routing:
    trial: "google:gemini-flash"
    starter: "google:gemini-pro"
    premium: "openai:gpt-4o"
    vip: "anthropic:claude-3.5-sonnet"
    owner: "anthropic:claude-3.5-sonnet"
```

---

## Конфигурация агентов

### IDENTITY.md

Персонализация личности бота:

```markdown
# Identity

You are OpenClaw Bot, an AI assistant for Telegram.

## Personality

- Friendly and helpful
- Concise responses (avoid walls of text)
- Professional but casual tone

## Language

- Detect user's language and respond in the same
- Default: English
- Supported: English, Russian

## Behavior

- No emojis unless user uses them
- Code blocks with syntax highlighting
- Cite sources when using web search
```

### AGENTS.md

Дополнительные промпты для агента:

```markdown
# Agent Instructions

## Tools Usage

When user asks for current information:

- Use web_search tool
- Cite sources

When user asks for code:

- Provide complete, runnable examples
- Add comments
- Suggest tests

## Subscription Prompts

When trial user hits limit:
"You've used all 5 messages for today. Options:
• Wait until tomorrow (reset at 00:00 UTC)
• Subscribe for more: /subscribe"

When expired user:
"Your trial has ended. Subscribe to continue: /subscribe"
```

---

## Конфигурация хранилища

### SQLite (по умолчанию)

```yaml
storage:
  type: "sqlite"
  path: "/data/.openclaw/users.db"
```

**Преимущества**:

- Быстрее JSON
- Транзакции
- Масштабируется до 10K пользователей

**Недостатки**:

- Файловая БД (не подходит для multi-instance)

### Legacy JSON (только миграция)

```yaml
storage:
  type: "json"
  path: "/data/.openclaw/users.json"
```

Используется только как источник одноразового импорта в `users.db` при старте.

### PostgreSQL

```yaml
storage:
  type: "postgres"
  url: ${DATABASE_URL}
```

**Преимущества**:

- Полноценная СУБД
- Масштабируется
- Поддержка репликации

**Недостатки**:

- Требует отдельный сервер

---

## Логирование

### Уровни логов

```yaml
logging:
  level: "info" # trace | debug | info | warn | error
  format: "json" # json | pretty
```

### Логи в файл

```yaml
logging:
  file:
    enabled: true
    path: "/data/.openclaw/logs/bot.log"
    maxSize: "100MB"
    maxAge: "30d"
```

---

## Безопасность

### Rate Limiting

```yaml
security:
  rateLimit:
    enabled: true
    maxMessagesPerMinute: 10 # Burst limit
    maxMessagesPerHour: 200 # Soft limit
```

### Webhook вместо Polling (опционально)

```yaml
channels:
  telegram:
    mode: "webhook"
    webhookUrl: "https://your-bot.com/webhook"
    webhookSecret: ${TELEGRAM_WEBHOOK_SECRET}
```

**Преимущества**:

- Меньше нагрузка
- Быстрее ответы

**Недостатки**:

- Требует HTTPS
- Требует публичный URL

---

## Мониторинг (планируется)

### Prometheus метрики

```yaml
monitoring:
  prometheus:
    enabled: true
    port: 9090
```

### Health check

```yaml
health:
  enabled: true
  port: 8080
  path: "/health"
```

---

## Примеры конфигураций

### Минимальная (только trial)

```yaml
session:
  dmScope: "per-peer"

channels:
  telegram:
    dmPolicy: "open"
    allowFrom: ["*"]
```

### Продакшн (с подпиской)

```yaml
session:
  dmScope: "per-peer"
  pruning:
    enabled: true
    keepDays: 30

channels:
  telegram:
    dmPolicy: "open"
    mode: "webhook"
    webhookUrl: ${TELEGRAM_WEBHOOK_URL}

storage:
  type: "postgres"
  url: ${DATABASE_URL}

logging:
  level: "info"
  format: "json"
  file:
    enabled: true

security:
  rateLimit:
    enabled: true
```

---

## Проверка конфигурации

### Валидация config.yaml

```bash
pnpm openclaw config validate
```

### Вывод текущей конфигурации

```bash
pnpm openclaw config show
```

---

## Что дальше?

- [Setup](/admin/setup) — первичная настройка
- [Deployment Railway](/admin/deployment-railway) — деплой на Railway
- [User Management](/admin/user-management) — управление пользователями
