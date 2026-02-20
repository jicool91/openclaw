# Context7 Usage Reminder

## When to Use Context7

Use Context7 MCP **before writing code** that involves external libraries to get up-to-date docs and patterns.

**Use when:**

1. Implementing features with external library APIs (grammY, zod, commander, etc.)
2. Checking if current patterns are still recommended (e.g., zod v3 → v4 migration)
3. Integrating a new API or library not yet used in the project
4. Debugging library-specific behavior

**Do NOT use for:**

- Internal project code (read the source directly)
- Simple questions answerable from code
- Libraries with trivial APIs

## Process

```
# Step 1: Resolve library ID (if not in the table below)
mcp__context7__resolve-library-id
  query: "what you need"
  libraryName: "library name"

# Step 2: Query docs
mcp__context7__query-docs
  libraryId: "/org/project"
  query: "specific question or pattern"
```

## Rule of 3

Context7 calls are expensive. **Max 3 calls per question:**

- resolve + query = 2 calls, 1 reserve for follow-up

## Verified Library IDs (project dependencies)

| Library           | Version in project | libraryId                  | Notes                    |
| ----------------- | ------------------ | -------------------------- | ------------------------ |
| grammY            | ^1.40.0            | `/grammyjs/website`        | Telegram bot framework   |
| zod (v4)          | ^4.3.6             | `/websites/zod_dev_v4`     | Schema validation (v4!)  |
| zod (v3 docs)     | —                  | `/colinhacks/zod`          | Only if v3 compat needed |
| vitest            | ^4.x               | `/vitest-dev/vitest`       | Test framework           |
| commander         | ^14.0.3            | `/tj/commander.js`         | CLI framework            |
| TypeScript        | 5.x                | `/websites/typescriptlang` | Language docs            |
| @sinclair/typebox | latest             | `/sinclairzx81/typebox`    | JSON Schema types        |
| Railway docs      | —                  | `/railwayapp/docs`         | Deployment platform      |

## Examples

### grammY (Telegram Bot)

```
libraryId: "/grammyjs/website"
query: "bot.command() with middleware and session management"
```

### zod v4 (Schema Validation)

```
libraryId: "/websites/zod_dev_v4"
query: "schema composition, pipe transform, v4 migration from v3"
```

### vitest (Testing)

```
libraryId: "/vitest-dev/vitest"
query: "vi.mock with factory function and partial mocking"
```

### commander (CLI)

```
libraryId: "/tj/commander.js"
query: "subcommands with options and action handlers"
```
