# Telegram Bot Setup

Настройка Telegram бота через BotFather и grammY.

## Создание бота через BotFather

### 1. Откройте BotFather

Telegram → [@BotFather](https://t.me/BotFather) → `/start`

### 2. Создайте бота

```
/newbot
```

**BotFather спросит**:

1. **Название бота** (отображается в списке чатов):

   ```
   OpenClaw Bot
   ```

2. **Username бота** (должен заканчиваться на `bot`):
   ```
   openclaw_jicool_bot
   ```

### 3. Получите токен

```
Done! Congratulations on your new bot.
You will find it at t.me/openclaw_jicool_bot

Here is your token:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz-1234567890

Keep it safe!
```

⚠️ **Важно**: Токен = полный доступ к боту. Никому не показывайте!

---

## Настройка бота

### Команды

```
/setcommands
```

Выберите вашего бота → вставьте:

```
start - Начать работу с ботом
plan - Показать текущий тариф и лимиты
usage - Статистика использования
subscribe - Оформить подписку через Stars
cancel - Отменить авто-продление
help - Справка по использованию
```

---

### Описание

```
/setdescription
```

Вставьте:

```
AI-ассистент в Telegram с системой подписки через Stars.

Попробуйте бесплатный trial на 7 дней!
```

---

### Короткое описание

```
/setabouttext
```

Вставьте:

```
Умный AI-ассистент прямо в Telegram
```

---

### Аватар (опционально)

```
/setuserpic
```

Загрузите изображение (512x512 px, PNG/JPG).

---

### Платежи (Telegram Stars)

```
/mybots
→ выберите бота
→ Bot Settings
→ Payments
→ Connect Provider: Telegram Stars
```

✅ Включите **Telegram Stars** как платежный провайдер.

---

### Privacy Mode (рекомендуется отключить)

```
/setprivacy
→ выберите бота
→ Disable
```

**Зачем**: По умолчанию боты в группах видят только сообщения начинающиеся с `/`. Отключение Privacy Mode позволяет боту видеть все сообщения.

⚠️ **Важно**: Для DM (личных чатов) Privacy Mode не влияет.

---

## Интеграция с grammY

### Установка

```bash
pnpm add grammy
```

### Базовый setup

**Файл**: `src/telegram/bot.ts`

```typescript
import { Bot } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN!;
const bot = new Bot(token);

// Start command
bot.command("start", async (ctx) => {
  await ctx.reply("✅ Добро пожаловать!");
});

// Plan command
bot.command("plan", async (ctx) => {
  const userId = ctx.from!.id;
  const user = await getUserRecord(userId);

  await ctx.reply(`
📊 Ваш план: ${user.role}

⏱ Срок действия: ${formatDate(user.expiresAt)}
📨 Использовано сегодня: ${user.messagesUsedToday}
🤖 Модель: ${user.model}
  `);
});

// Handle all messages
bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  // Check access
  const allowed = await checkAccess(userId);
  if (!allowed) {
    return ctx.reply("❌ Лимит исчерпан. /subscribe");
  }

  // Send to AI agent
  const response = await sendToAgent(userId, text);
  await ctx.reply(response);
});

// Start bot
bot.start();
```

---

## Deep Links (Invite-ссылки)

### Формат

```
https://t.me/openclaw_jicool_bot?start=PAYLOAD
```

- **PAYLOAD**: до 64 символов (`A-Z a-z 0-9 _ -`)

### Обработка payload

```typescript
bot.command("start", async (ctx) => {
  const payload = ctx.match; // Все после /start

  if (!payload) {
    // Обычный /start
    return ctx.reply("Привет! Ты новый пользователь.");
  }

  if (payload.startsWith("inv_")) {
    // Invite-код
    const inviteCode = payload;
    await activateVIP(ctx.from.id, inviteCode);
    return ctx.reply("✅ VIP доступ активирован!");
  }

  if (payload.startsWith("ref_")) {
    // Реферальная ссылка
    const referrerId = decodeReferral(payload);
    await linkReferral(ctx.from.id, referrerId);
    return ctx.reply("Добро пожаловать! Вы пришли по реферальной ссылке.");
  }
});
```

### Генерация invite-ссылки

```typescript
bot.command("invite", async (ctx) => {
  // Только для owner
  if (!isOwner(ctx.from.id)) {
    return ctx.reply("❌ Только для владельца");
  }

  const label = ctx.match; // Текст после /invite
  const inviteCode = generateInviteCode(ctx.from.id);

  const link = `https://t.me/${bot.botInfo.username}?start=${inviteCode}`;

  await ctx.reply(`
✅ VIP invite-ссылка создана:

${link}

Label: ${label}
Срок действия: бессрочно
  `);
});
```

---

## Telegram Stars (Платежи)

### Отправка invoice

```typescript
bot.command("subscribe", async (ctx) => {
  const userId = ctx.from.id;

  // Показать варианты тарифов
  await ctx.reply("Выберите тариф:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Starter — 100 ⭐/мес", callback_data: "subscribe_starter" }],
        [{ text: "Premium — 300 ⭐/мес", callback_data: "subscribe_premium" }],
      ],
    },
  });
});

bot.callbackQuery("subscribe_starter", async (ctx) => {
  await ctx.answerCallbackQuery();

  await ctx.api.sendInvoice(ctx.from.id, {
    title: "Starter Plan",
    description: "30 сообщений/день, средняя модель",
    payload: JSON.stringify({ plan: "starter", userId: ctx.from.id }),
    currency: "XTR", // Telegram Stars
    prices: [{ label: "Starter", amount: 100 }],
    subscription_period: 2592000, // 30 дней в секундах
  });
});
```

### Pre-checkout handler

```typescript
bot.on("pre_checkout_query", async (ctx) => {
  const payload = JSON.parse(ctx.preCheckoutQuery.invoice_payload);

  // Валидация
  const user = await getUserRecord(payload.userId);
  if (!user) {
    return ctx.answerPreCheckoutQuery(false, {
      error_message: "User not found",
    });
  }

  // Подтверждение (< 10 секунд обязательно!)
  await ctx.answerPreCheckoutQuery(true);
});
```

### Successful payment handler

```typescript
bot.on("message:successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = JSON.parse(payment.invoice_payload);

  // Активировать подписку
  await activateSubscription(payload.userId, payload.plan, payment.telegram_payment_charge_id);

  await ctx.reply(`
✅ Подписка успешно оформлена!

📊 Ваш новый план: ${payload.plan}
⏱ Активна до: ${formatDate(Date.now() + 30 * 24 * 60 * 60 * 1000)}
  `);
});
```

---

## Error Handling

```typescript
bot.catch((err) => {
  console.error("Bot error:", err);

  // Отправить уведомление owner
  bot.api.sendMessage(
    OWNER_TELEGRAM_ID,
    `
⚠️ Ошибка бота:

${err.message}

Stack:
${err.stack}
  `,
  );
});
```

---

## Webhook (альтернатива polling)

### Setup webhook

```typescript
const WEBHOOK_URL = "https://your-bot.com/webhook";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

await bot.api.setWebhook(WEBHOOK_URL, {
  secret_token: WEBHOOK_SECRET,
});
```

### Handle webhook

```typescript
import express from "express";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  // Проверка secret
  if (req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  // Обработка update
  await bot.handleUpdate(req.body);
  res.sendStatus(200);
});

app.listen(8080);
```

**Преимущества webhook**:

- Меньше задержка
- Меньше нагрузка на Telegram API

**Требования**:

- HTTPS
- Публичный URL

---

## Что дальше?

- [grammY Framework](/telegram/grammyjs) — детали про grammY
- [Deep Linking](/telegram/deep-linking) — invite-ссылки
- [Payment Handlers](/telegram/payment-handlers) — работа с Stars
- [Setup Guide](/admin/setup) — полная настройка бота
