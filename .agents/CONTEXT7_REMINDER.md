# Context7 Usage Reminder

## ⚠️ CRITICAL: ALWAYS USE CONTEXT7 MCP

При любой разработке кода **ОБЯЗАТЕЛЬНО** использовать Context7 MCP для получения актуальной документации и best practices.

## Когда использовать Context7:

1. **Перед началом разработки новой фичи**
   - Проверить актуальные паттерны для используемых библиотек
   - Получить актуальные примеры кода

2. **При работе с внешними библиотеками**
   - grammY (Telegram bot framework)
   - TypeScript (type patterns, discriminated unions)
   - Node.js async patterns
   - Database libraries
   - UI frameworks

3. **При рефакторинге**
   - Проверить, не устарели ли используемые паттерны
   - Найти более современные подходы

4. **При интеграции нового API**
   - Получить актуальную документацию
   - Проверить примеры использования

## Процесс:

```bash
# 1. Найти библиотеку
mcp__context7__resolve-library-id
  query: "описание того что ищем"
  libraryName: "название библиотеки"

# 2. Получить документацию
mcp__context7__query-docs
  libraryId: "/org/project"
  query: "конкретный вопрос или паттерн"
```

## Примеры использования:

### TypeScript Patterns

```
libraryName: "typescript"
libraryId: "/websites/typescriptlang"
query: "discriminated unions with never type exhaustive checking"
```

### grammY (Telegram Bot)

```
libraryName: "grammy"
libraryId: "/grammyjs/website"
query: "bot command registration and async middleware patterns"
```

### Railway CLI

```
libraryName: "railway"
libraryId: "/railwayapp/cli"
query: "deploy commands and environment variables"
```

## Последние проверки (2026-02-16):

- ✅ TypeScript discriminated unions - актуально
- ✅ grammY bot.command() - актуально
- ✅ Async initialization patterns - актуально

## НЕ ЗАБЫВАЙ!

**ВСЕГДА** проверяй через Context7 перед написанием кода!
