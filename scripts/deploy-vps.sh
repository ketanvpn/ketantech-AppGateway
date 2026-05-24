#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/.openclaw/workspace/projects/ketantech-AppGateway}"
BRANCH="${BRANCH:-main}"
PAYMENT_SERVICE="${PAYMENT_SERVICE:-ketantech-payment.service}"
DASHBOARD_SERVICE="${DASHBOARD_SERVICE:-ketantech-dashboard.service}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
PROVIDERS_URL="${PROVIDERS_URL:-http://127.0.0.1:3000/health/providers}"
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_DASHBOARD="${SKIP_DASHBOARD:-0}"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "git tidak ditemukan"
command -v npm >/dev/null || fail "npm tidak ditemukan"
command -v curl >/dev/null || fail "curl tidak ditemukan"
command -v systemctl >/dev/null || fail "systemctl tidak ditemukan"

[ -d "$APP_DIR/.git" ] || fail "APP_DIR bukan git repo: $APP_DIR"
cd "$APP_DIR"

log "App dir: $APP_DIR"
log "Branch: $BRANCH"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "Ada perubahan tracked lokal. Commit/stash dulu sebelum deploy."
fi

BEFORE="$(git rev-parse --short HEAD)"
log "Current commit: $BEFORE"

if [ "$SKIP_PULL" != "1" ]; then
  log "Fetching latest code..."
  git fetch origin "$BRANCH"
  log "Pulling origin/$BRANCH..."
  git pull --ff-only origin "$BRANCH"
else
  warn "SKIP_PULL=1, tidak pull dari GitHub"
fi

AFTER="$(git rev-parse --short HEAD)"
log "Deploy commit: $AFTER"

log "Installing backend dependencies..."
npm ci

log "Building backend..."
npm run build

if [ "$SKIP_DASHBOARD" != "1" ]; then
  log "Installing dashboard dependencies..."
  npm --prefix dashboard ci

  log "Building dashboard..."
  npm --prefix dashboard run build
else
  warn "SKIP_DASHBOARD=1, dashboard install/build dilewati"
fi

log "Restarting services..."
systemctl restart "$PAYMENT_SERVICE"
if [ "$SKIP_DASHBOARD" != "1" ]; then
  systemctl restart "$DASHBOARD_SERVICE"
fi

log "Waiting services warm up..."
sleep 3

systemctl is-active --quiet "$PAYMENT_SERVICE" || {
  systemctl status "$PAYMENT_SERVICE" --no-pager -l || true
  fail "$PAYMENT_SERVICE tidak active"
}

if [ "$SKIP_DASHBOARD" != "1" ]; then
  systemctl is-active --quiet "$DASHBOARD_SERVICE" || {
    systemctl status "$DASHBOARD_SERVICE" --no-pager -l || true
    fail "$DASHBOARD_SERVICE tidak active"
  }
fi

log "Checking health..."
curl -fsS "$HEALTH_URL" >/tmp/ketantechpay-health.json
cat /tmp/ketantechpay-health.json
printf '\n'

if curl -fsS "$PROVIDERS_URL" >/tmp/ketantechpay-providers.json; then
  cat /tmp/ketantechpay-providers.json
  printf '\n'
else
  warn "Provider health endpoint gagal dicek: $PROVIDERS_URL"
fi

log "Done. $BEFORE -> $AFTER"
