---
title: Deployment Railway
description: Deploy OpenClaw gateway on Railway
---

# Deployment Railway

Railway deployment guide for OpenClaw gateway.

## Prerequisites

- Railway account ([railway.app](https://railway.app))
- Railway CLI: `npm i -g @railway/cli`
- Git repository connected to Railway

## Quick Start

### 1. Connect Repository

Link your OpenClaw fork/repo to a Railway project via the Railway dashboard. Railway auto-deploys on `git push origin main`.

### 2. Add Persistent Volume

Railway Settings > Volumes > Add Volume:

```
Mount Path: /data
```

This persists user database, sessions, and workspace files across deploys.

### 3. Set Environment Variables

Required:

```bash
# Persistence (must match mounted volume path)
OPENCLAW_STATE_DIR=/data

# Telegram Bot
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Admin IDs (owner access)
ADMIN_TELEGRAM_IDS=YOUR_TELEGRAM_ID

# AI provider (at least one)
ANTHROPIC_API_KEY=sk-ant-...
```

Optional:

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
BRAVE_API_KEY=BSA...
OPENCLAW_GATEWAY_TOKEN=<custom-token>
```

### 4. Deploy

```bash
git push origin main
```

Railway picks up `Dockerfile.railway` automatically (configured in `railway.toml`).

## Railway Helper

Use `scripts/railway-helper.sh` for non-interactive Railway operations:

```bash
./scripts/railway-helper.sh status      # deployment status
./scripts/railway-helper.sh logs        # last 100 log lines
./scripts/railway-helper.sh logs-follow # follow logs
./scripts/railway-helper.sh ssh         # SSH into container
./scripts/railway-helper.sh env         # list env vars
./scripts/railway-helper.sh deploy      # deploy (git push)
./scripts/railway-helper.sh restart     # redeploy service
./scripts/railway-helper.sh health      # check gateway health
./scripts/railway-helper.sh open        # open project in browser
./scripts/railway-helper.sh env-set K=V # set env variable
./scripts/railway-helper.sh env-unset K # unset env variable
./scripts/railway-helper.sh set-admin ID1,ID2  # set admin IDs
```

The helper uses explicit `--project`/`--environment`/`--service` flags instead of `railway link`, so it never interferes with local Railway CLI state.

## Build Details

The `Dockerfile.railway` builds with:

- Node 22 + Bun + pnpm (via corepack)
- `CI=1` to suppress interactive prompts
- Gateway runs on port 8080 with `--bind lan`

## Verifying the Deploy

```bash
# Check logs for startup messages
./scripts/railway-helper.sh logs

# Expected output:
# Gateway started on port 8080
# Telegram bot connected
```

Send `/start` to your Telegram bot to verify end-to-end connectivity.

## Troubleshooting

### Bot not responding

1. Check logs: `./scripts/railway-helper.sh logs`
2. Verify env vars: `./scripts/railway-helper.sh env`
3. Restart: `./scripts/railway-helper.sh restart`

### Data lost after redeploy

Ensure `OPENCLAW_STATE_DIR=/data` is set and a persistent volume is mounted at `/data`.

### Build fails

Check build logs in the Railway dashboard. Common issues:

- Missing `pnpm-lock.yaml` (commit it to repo)
- Bun install failure on ARM (handled gracefully)
