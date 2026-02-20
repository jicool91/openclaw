#!/usr/bin/env bash
#
# Railway entrypoint: ensure full permissions before starting gateway.
# Runs once per container start; safe to re-run (idempotent).
#
set -eu

STATE_DIR="${OPENCLAW_STATE_DIR:-/data}"
CONFIG_FILE="$STATE_DIR/openclaw.json"
APPROVALS_DIR="$HOME/.openclaw"
APPROVALS_FILE="$APPROVALS_DIR/exec-approvals.json"

# ── 1. Ensure exec-approvals.json with full permissions ──
mkdir -p "$APPROVALS_DIR"
if [ ! -f "$APPROVALS_FILE" ]; then
  echo '{"version":1,"defaults":{"security":"full","ask":"off","askFallback":"full","autoAllowSkills":true},"agents":{"*":{"security":"full","ask":"off","askFallback":"full","autoAllowSkills":true}}}' > "$APPROVALS_FILE"
  echo "[entrypoint] Created exec-approvals.json with full permissions"
else
  echo "[entrypoint] exec-approvals.json already exists, skipping"
fi

# ── 2. Ensure openclaw.json config has full tool permissions ──
# Use openclaw config set (idempotent, merges into existing config)
node dist/index.js config set tools.profile full 2>/dev/null || true
node dist/index.js config set tools.exec.host gateway 2>/dev/null || true
node dist/index.js config set tools.exec.security full 2>/dev/null || true
node dist/index.js config set tools.exec.ask off 2>/dev/null || true
node dist/index.js config set tools.exec.timeoutSec 300 2>/dev/null || true
node dist/index.js config set tools.exec.applyPatch.enabled true 2>/dev/null || true
node dist/index.js config set tools.web.search.enabled true 2>/dev/null || true
node dist/index.js config set tools.web.fetch.enabled true 2>/dev/null || true
node dist/index.js config set tools.elevated.enabled true 2>/dev/null || true
node dist/index.js config set tools.agentToAgent.enabled true 2>/dev/null || true
node dist/index.js config set tools.message.crossContext.allowWithinProvider true 2>/dev/null || true
node dist/index.js config set tools.message.crossContext.allowAcrossProviders true 2>/dev/null || true
node dist/index.js config set tools.message.broadcast.enabled true 2>/dev/null || true
node dist/index.js config set agents.defaults.sandbox.mode off 2>/dev/null || true
node dist/index.js config set agents.defaults.reasoningDefault off 2>/dev/null || true

echo "[entrypoint] Config permissions applied"

# ── 3. Start gateway ──
exec node dist/index.js gateway \
  --bind lan \
  --port 8080 \
  --allow-unconfigured \
  ${OPENCLAW_GATEWAY_TOKEN:+--token "$OPENCLAW_GATEWAY_TOKEN"}
