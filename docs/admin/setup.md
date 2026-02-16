# Настройка бота

Пошаговая инструкция по первичной настройке OpenClaw Bot.

## Предварительные требования

✅ **Telegram Bot Token** — получить у [@BotFather](https://t.me/BotFather)
✅ **Railway аккаунт** — для хостинга (или другой VPS)
✅ **API ключи** — для AI моделей (Anthropic, OpenAI, и др.)
✅ **Brave API** (опционально) — для web search

---

## Шаг 1: Создание Telegram бота

### 1.1 Откройте BotFather

Telegram → [@BotFather](https://t.me/BotFather) → `/start`

### 1.2 Создайте нового бота

```
/newbot
```

**BotFather спросит**:

1. Название бота (например: "OpenClaw Bot")
2. Username бота (должен заканчиваться на `bot`, например: `openclaw_jicool_bot`)

### 1.3 Получите токен

BotFather вернет токен:

```
Done! Here is your token:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz

Keep it safe!
```

⚠️ **Важно**: Сохраните токен в безопасном месте. Никому его не показывайте!

### 1.4 Настройте команды (опционально)

```
/setcommands
```

Выберите бота → вставьте:

```
start - Начать работу с ботом
plan - Показать текущий тариф
usage - Статистика использования
subscribe - Оформить подписку
cancel - Отменить авто-продление
help - Справка
```

---

## Шаг 2: Клонирование репозитория

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

---

## Шаг 3: Установка зависимостей

```bash
pnpm install
```

Или:

```bash
npm install
```

---

## Шаг 4: Конфигурация

### 4.1 Создайте config.yaml

```bash
cp config.example.yaml config.yaml
```

### 4.2 Отредактируйте config.yaml

```yaml
# Основные настройки
session:
  dmScope: "per-peer" # Изолированные сессии для каждого пользователя

# Telegram канал
channels:
  telegram:
    dmPolicy: "open" # Любой может написать боту
    allowFrom: ["*"] # Wildcard

# Агенты (разделение owner и public)
agents:
  list:
    - id: private
      default: false
      # Полная memory для owner (ты + Аня)

    - id: public
      default: true
      # Общий агент для всех остальных

# Привязка owner к private агенту
bindings:
  - agentId: private
    match:
      channel: telegram
      peer:
        kind: direct
        id: "YOUR_TELEGRAM_ID" # Замени на свой ID

  - agentId: private
    match:
      channel: telegram
      peer:
        kind: direct
        id: "ANNA_TELEGRAM_ID" # Замени на ID Ани
```

### 4.3 Создайте .env

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Admin IDs (владельцы бота)
ADMIN_TELEGRAM_IDS=YOUR_ID,ANNA_ID

# AI Models
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Web Search (опционально)
BRAVE_API_KEY=BSA...
FIRECRAWL_API_KEY=fc-...

# Database (опционально, по умолчанию JSON)
# DATABASE_URL=postgresql://...
```

---

## Шаг 5: Получение Telegram ID

### Вариант 1: Через бота

1. Напишите [@userinfobot](https://t.me/userinfobot)
2. Он вернет ваш ID

### Вариант 2: Через код

Временно добавьте в `bot-message-context.ts`:

```typescript
console.log("User ID:", ctx.from.id);
```

Запустите бота → напишите ему → смотрите лог.

---

## Шаг 6: Локальный запуск

### 6.1 Запуск gateway

```bash
pnpm openclaw gateway run --bind loopback --port 18789
```

### 6.2 Проверка статуса

```bash
pnpm openclaw channels status --probe
```

Должно показать:

```
✅ telegram: connected
   Users: 0
   Gateway: ws://localhost:18789
```

### 6.3 Тестирование

Откройте Telegram → напишите боту:

```
Привет!
```

Бот должен ответить.

---

## Шаг 7: Деплой на Railway

### 7.1 Создайте проект на Railway

1. [railway.app](https://railway.app) → Sign up
2. New Project → Deploy from GitHub repo
3. Выберите `openclaw/openclaw`

### 7.2 Добавьте переменные окружения

Railway Dashboard → Variables → Add:

```
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_TELEGRAM_IDS=YOUR_ID,ANNA_ID
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
BRAVE_API_KEY=BSA...
FIRECRAWL_API_KEY=fc-...
```

### 7.3 Настройте Persistent Volume

Railway → Settings → Volumes → Add Volume:

```
Mount Path: /data
```

Это сохранит `users.json` между деплоями.

### 7.4 Деплой

Railway автоматически задеплоит.

Проверьте логи:

```
Railway Dashboard → Deployments → View Logs
```

Должно показать:

```
✅ Gateway started on port 18789
✅ Telegram bot connected
```

Подробнее: [Deployment Railway](/admin/deployment-railway)

---

## Шаг 8: Проверка работы

### 8.1 Напишите боту

Telegram → ваш бот → `/start`

Бот должен ответить:

```
✅ Добро пожаловать!

Вам доступен бесплатный trial на 7 дней:
📨 5 сообщений в день
⏱ До 23.02.2026

Попробуйте: напишите мне любой вопрос!
```

### 8.2 Проверьте owner доступ

Вы (owner) должны иметь безлимит:

```
/plan
```

Ответ:

```
📊 Ваш план: Owner

⏱ Срок действия: бессрочно
📨 Лимит: безлимит
🤖 Модель: лучшая доступная
```

### 8.3 Тест подписки

Попросите друга написать боту → оформить trial → попробовать `/subscribe`.

---

## Шаг 9: Мониторинг

### 9.1 Логи (Railway)

Railway Dashboard → Deployments → Logs

### 9.2 Статистика

```
/admin stats
```

Ответ:

```
📊 Статистика бота

👥 Пользователи:
- Trial: 5
- Subscriber: 0
- VIP: 0
- Total: 5

💰 Выручка: $0 (пока нет подписчиков)
```

---

## Что дальше?

- [Configuration](/admin/configuration) — детальная настройка
- [User Management](/admin/user-management) — управление пользователями
- [Analytics](/admin/analytics) — аналитика и метрики
- [Deployment Railway](/admin/deployment-railway) — подробнее про Railway
