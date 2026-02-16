# OpenClaw Bot

**AI-ассистент в Telegram с подпиской через Telegram Stars — на базе платформы [OpenClaw](https://github.com/openclaw/openclaw)**

OpenClaw Bot — это продукт, построенный на ядре **OpenClaw Platform** — open-source платформы для AI-агентов. Мы используем Gateway, Agent Runtime, Session Management и весь инструментарий OpenClaw, добавляя поверх него систему подписок, ролей и монетизации через Telegram Stars.

## Архитектура: ядро + обёртки

```
┌─────────────────────────────────────────────────┐
│              Наши обёртки (wrappers)             │
│  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ User Store  │ │ Подписки │ │ Telegram     │  │
│  │ & Роли      │ │ & Stars  │ │ Stars Оплата │  │
│  └─────────────┘ └──────────┘ └──────────────┘  │
├─────────────────────────────────────────────────┤
│         OpenClaw Platform (ядро)                │
│  ┌──────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ Gateway  │ │ Agent   │ │ Sessions, Tools, │  │
│  │ WS API   │ │ Runtime │ │ Models, Memory   │  │
│  └──────────┘ └─────────┘ └──────────────────┘  │
│  ┌──────────┐ ┌─────────┐ ┌──────────────────┐  │
│  │ Telegram │ │ Hooks & │ │ Config System    │  │
│  │ (grammY) │ │ Plugins │ │ (openclaw.json)  │  │
│  └──────────┘ └─────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Принцип**: мы НЕ заменяем OpenClaw, а строим поверх него. Ядро обновляется из upstream, наши фичи — это обёртки вокруг стандартных механизмов.

## Что даёт OpenClaw Platform (ядро)

- **Gateway** — WebSocket API, управление соединениями, health monitoring
- **Agent Runtime** — AI-агент с per-user sessions, context management, tool execution
- **Telegram Channel** — полная интеграция через grammY (polling, webhooks, media, groups)
- **Model Routing** — поддержка Anthropic, OpenAI, Google, Ollama и др.
- **Tools & Skills** — browser, exec, web search, file ops, canvas
- **Config System** — `openclaw.json` с hot-reload, $include, CLI config
- **Hooks & Plugins** — расширение без модификации ядра
- **Session Management** — изоляция, compaction, pruning

## Что добавляем мы (обёртки)

- ⭐ **Telegram Stars** — монетизация через встроенные платежи Telegram
- 👥 **Система ролей** — owner, vip, subscriber, trial, expired
- 📊 **User Store** — хранение подписок, статистики, лимитов
- 🔒 **Access Control** — проверка прав перед обработкой сообщения
- 🎟 **VIP Invite-ссылки** — бесплатный доступ для избранных
- 📈 **Аналитика** — отслеживание использования и расходов

## Быстрый старт

### Для пользователей

1. Откройте бота: [@openclaw_jicool_bot](https://t.me/openclaw_jicool_bot)
2. Нажмите `/start` — получите 7 дней бесплатного trial
3. При необходимости: `/subscribe` для оформления подписки

Подробнее: [Начало работы](/users/getting-started)

### Для администраторов

1. Установите OpenClaw: `npm i -g openclaw@latest`
2. Настройте `openclaw.json` (Telegram token, модели, агенты)
3. Задеплойте на Railway или другой хостинг
4. Настройте ADMIN_TELEGRAM_IDS для owner-доступа

Подробнее: [Настройка бота](/admin/setup)

## Система подписки

| Роль           | Как получить           | Доступ                   |
| -------------- | ---------------------- | ------------------------ |
| **trial**      | Первый `/start`        | 5 сообщений/день, 7 дней |
| **subscriber** | Оплата через Stars     | 30+ сообщений/день       |
| **vip**        | Invite-ссылка от owner | Полный доступ бесплатно  |
| **owner**      | ADMIN_TELEGRAM_IDS     | Админ-права, без лимитов |

Подробнее: [Тарифы](/payment/plans) | [Роли](/reference/user-roles)

## Ссылки

- [OpenClaw Platform (ядро)](https://github.com/openclaw/openclaw) — open-source проект
- [Официальная документация OpenClaw](https://docs.openclaw.ai) — полная документация ядра
- [GitHub Issues](https://github.com/openclaw/openclaw/issues)

---

**Готовы начать?** [Для пользователей](/users/getting-started) | [Для администраторов](/admin/setup) | [Архитектура](/start/architecture)
