#!/usr/bin/env bash
#
# Railway Helper Utility for OpenClaw
# Упрощенный скрипт для работы с Railway без интерактивных команд
#

set -euo pipefail

# Railway IDs (из RAILWAY_SESSION_RUNBOOK.md)
PROJECT_ID="${RAILWAY_PROJECT_ID:-6a9e5acb-0d8a-4687-bef8-12148d9f3981}"
ENV_ID="${RAILWAY_ENV_ID:-f53aeb88-93b1-4e9b-91d9-8608e7ce2261}"
SERVICE_ID="${RAILWAY_SERVICE_ID:-848d7299-671a-4914-8cbf-3f9449047e79}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
  echo "Railway Helper - упрощенная утилита для работы с Railway"
  echo ""
  echo "Usage: $0 <command>"
  echo ""
  echo "Commands:"
  echo "  status       - показать статус deployment"
  echo "  logs         - показать логи (последние 100 строк)"
  echo "  logs-follow  - следить за логами в реальном времени"
  echo "  ssh          - открыть SSH сессию"
  echo "  env          - показать переменные окружения"
  echo "  deploy       - задеплоить текущую версию (git push)"
  echo "  restart      - перезапустить сервис"
  echo "  health       - проверить health gateway"
  echo "  set-admin <id[,id2]> - установить ADMIN_TELEGRAM_IDS"
  echo "  help         - показать эту справку"
  echo ""
  echo "Environment Variables:"
  echo "  RAILWAY_PROJECT_ID  - ID проекта (default: 6a9e5acb...)"
  echo "  RAILWAY_ENV_ID      - ID environment (default: f53aeb88...)"
  echo "  RAILWAY_SERVICE_ID  - ID сервиса (default: 848d7299...)"
  exit 1
}

check_railway_cli() {
  if ! command -v railway &> /dev/null; then
    echo -e "${RED}❌ Railway CLI not found${NC}"
    echo "Install: npm i -g @railway/cli"
    exit 1
  fi
}

cmd_status() {
  echo -e "${BLUE}📊 Railway Status${NC}"
  railway status --json || railway status
}

cmd_logs() {
  echo -e "${BLUE}📜 Railway Logs (last 100 lines)${NC}"
  railway logs \
    -s "$SERVICE_ID" \
    -e "$ENV_ID" \
    --deployment \
    --json
}

cmd_logs_follow() {
  echo -e "${BLUE}📜 Railway Logs (following...)${NC}"
  # Note: Railway CLI doesn't support --follow, use web dashboard instead
  railway logs \
    -s "$SERVICE_ID" \
    -e "$ENV_ID" \
    --deployment \
    --json
}

cmd_ssh() {
  echo -e "${BLUE}🔐 Opening SSH session${NC}"
  railway ssh \
    -p "$PROJECT_ID" \
    -e "$ENV_ID" \
    -s "$SERVICE_ID"
}

cmd_env() {
  echo -e "${BLUE}🔧 Environment Variables${NC}"
  railway variables \
    -s "$SERVICE_ID" \
    -e "$ENV_ID" \
    --json | jq 'to_entries | map({key: .key, value: .value}) | sort_by(.key)'
}

cmd_deploy() {
  echo -e "${YELLOW}🚀 Deploying to Railway...${NC}"

  # Check if there are uncommitted changes
  if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}❌ You have uncommitted changes${NC}"
    echo "Commit your changes first: git add . && git commit -m 'your message'"
    exit 1
  fi

  # Get current branch
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo -e "${BLUE}Current branch: $BRANCH${NC}"

  # Push to Railway (assumes Railway is connected to git)
  echo "Pushing to origin/$BRANCH..."
  git push origin "$BRANCH"

  echo -e "${GREEN}✅ Pushed to Railway${NC}"
  echo "Railway will auto-deploy. Check status with: $0 status"
}

cmd_restart() {
  echo -e "${YELLOW}🔄 Restarting service...${NC}"
  railway redeploy \
    -s "$SERVICE_ID" \
    --yes
  echo -e "${GREEN}✅ Restart initiated${NC}"
}

cmd_health() {
  echo -e "${BLUE}🏥 Checking Gateway Health${NC}"

  # Get gateway URL from env
  GW_JSON=$(railway variables \
    -s "$SERVICE_ID" \
    -e "$ENV_ID" \
    --json)
  GW_DOMAIN=$(echo "$GW_JSON" | jq -r '.RAILWAY_PUBLIC_DOMAIN // empty')

  if [ -z "$GW_DOMAIN" ]; then
    echo -e "${RED}❌ RAILWAY_PUBLIC_DOMAIN not found${NC}"
    exit 1
  fi

  echo "Gateway URL: wss://$GW_DOMAIN"
  echo "Checking HTTP health endpoint..."

  curl -s "https://$GW_DOMAIN/health" | jq . || {
    echo -e "${YELLOW}No JSON health endpoint, trying basic connectivity...${NC}"
    curl -s -o /dev/null -w "%{http_code}" "https://$GW_DOMAIN"
  }
}

cmd_set_admin() {
  local ids="${1:-}"
  if [ -z "$ids" ]; then
    echo -e "${RED}❌ Missing admin ID(s)${NC}"
    echo "Usage: $0 set-admin <id[,id2,...]>"
    exit 1
  fi

  echo -e "${YELLOW}🔐 Setting ADMIN_TELEGRAM_IDS=${ids}${NC}"
  railway variables \
    -s "$SERVICE_ID" \
    -e "$ENV_ID" \
    --set "ADMIN_TELEGRAM_IDS=${ids}"
  echo -e "${GREEN}✅ ADMIN_TELEGRAM_IDS updated${NC}"
}

# Main
COMMAND="${1:-help}"
ARG1="${2:-}"

case "$COMMAND" in
  status)
    check_railway_cli
    cmd_status
    ;;
  logs)
    check_railway_cli
    cmd_logs
    ;;
  logs-follow|follow)
    check_railway_cli
    cmd_logs_follow
    ;;
  ssh)
    check_railway_cli
    cmd_ssh
    ;;
  env|vars|variables)
    check_railway_cli
    cmd_env
    ;;
  deploy)
    cmd_deploy
    ;;
  restart)
    check_railway_cli
    cmd_restart
    ;;
  health)
    check_railway_cli
    cmd_health
    ;;
  set-admin)
    check_railway_cli
    cmd_set_admin "$ARG1"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo -e "${RED}Unknown command: $1${NC}"
    usage
    ;;
esac
