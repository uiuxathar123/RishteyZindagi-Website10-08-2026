#!/usr/bin/env bash
#
# Real-HTTP smoke test orchestrator (production-completion phase).
#
#   scripts/smoke/run-smoke.sh prod      # NODE_ENV=production server + mock SMTP        -> pcp-prod-smoke.ts
#   scripts/smoke/run-smoke.sh b18       # B18: OTP required / not required, Super & Staff Admin, member settings (production server) -> b18-smoke.ts
#   scripts/smoke/run-smoke.sh b19       # B19: maintenance, admin MFA, contact form, live chat stream (SSE) through the proxy, groups, digest job, e-mail change -> b19-smoke.ts
#   scripts/smoke/run-smoke.sh b18-ui    # B18 browser check: Super Admin / Staff Admin / Member screens, OTP on and off (needs playwright)  -> b18-ui-check.ts
#   scripts/smoke/run-smoke.sh ui        # same production server, drives Chromium over the new screens   -> pcp-ui-check.ts (needs playwright, see that file)
#   scripts/smoke/run-smoke.sh ui-gateway # payment screens in Chromium with mock gateways + stubbed Razorpay popup -> pcp-ui-gateway-check.ts
#   scripts/smoke/run-smoke.sh gateway   # same build, NODE_ENV=test, mock Razorpay,
#                                        # PhonePe, Fast2SMS, SMTP                         -> pcp-gateway-smoke.ts
#
# Requirements: a built app (`npm run build`), a local PostgreSQL where ADMIN_DATABASE_URL may
# CREATE/DROP DATABASE, free ports 3100 and 45871-45874. The run:
#   1. creates a brand-new empty database,  2. runs every migration from empty,  3. seeds it,
#   4. starts `next start` with a generated throw-away environment (random secrets, never printed),
#   5. runs the smoke script over real HTTP,  6. stops the server and drops the database.
# Exit code is the smoke script's. Secrets generated here exist only in this process' environment.
set -euo pipefail

MODE="${1:-prod}"
case "$MODE" in prod|gateway|ui|ui-gateway|b18|b18-ui|b19) ;; *) echo "usage: run-smoke.sh prod|gateway|ui|ui-gateway|b18|b18-ui|b19" >&2; exit 3;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
[ -d .next ] || { echo "run-smoke.sh: no .next build found; run 'npm run build' first" >&2; exit 3; }

ADMIN_URL="${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL to a role that may CREATE/DROP DATABASE (e.g. postgresql://user:pw@localhost:5432/postgres)}"
DB="rz_smoke_${MODE}_$$"
DB_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#/[^/?]+(\?|$)#/${DB}\1#")"
PORT=3100
LOG="${SMOKE_LOG_DIR:-$(mktemp -d)}/server-$MODE.log"
SERVER_PID=""

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && wait "$SERVER_PID" 2>/dev/null || true
  rm -rf "${TLS_DIR:-/nonexistent-dir}" 2>/dev/null || true
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

rand() { openssl rand -hex "$1"; }

# Throw-away self-signed certificate (IP SAN 127.0.0.1) so the mock SMTP relay can offer STARTTLS, which production
# requires; the server trusts it via NODE_EXTRA_CA_CERTS (the app has no "ignore TLS errors" switch).
TLS_DIR="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" \
  -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" >/dev/null 2>&1
export SMOKE_SMTP_TLS_KEY="$TLS_DIR/key.pem" SMOKE_SMTP_TLS_CERT="$TLS_DIR/cert.pem" NODE_EXTRA_CA_CERTS="$TLS_DIR/cert.pem"
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$DB\"" >/dev/null

export DATABASE_URL="$DB_URL"
export AUTH_SECRET="$(rand 32)"
export PAYMENT_CREDENTIALS_ENCRYPTION_KEY="$(rand 32)"
export CRON_SECRET="$(rand 24)"
export APP_URL="http://localhost:$PORT"
export ALLOWED_ORIGINS="http://localhost:$PORT"
export TRUST_PROXY_HOPS=1
export SMTP_HOST=127.0.0.1 SMTP_PORT=45874 SMTP_USER=smoke-smtp-user SMTP_PASS="smoke-smtp-pass-$(rand 4)" EMAIL_FROM="RishteyZindagi <no-reply@smoke.example>"
export STORAGE_PROVIDER=local
export PORT
export SMOKE_BASE_URL="http://localhost:$PORT"
unset SEED_DEV_SUPER_ADMIN SEED_DEV_SUPER_ADMIN_EMAIL SEED_DEV_SUPER_ADMIN_PASSWORD
unset EMAIL_API_KEY SMS_API_KEY WHATSAPP_API_KEY FAST2SMS_API_KEY FAST2SMS_OTP_ID RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET PHONEPE_CLIENT_ID PHONEPE_CLIENT_SECRET

if [ "$MODE" = "prod" ] || [ "$MODE" = "ui" ] || [ "$MODE" = "b18" ] || [ "$MODE" = "b18-ui" ] || [ "$MODE" = "b19" ]; then
  export NODE_ENV=production
  SCRIPT=scripts/smoke/pcp-prod-smoke.ts
  [ "$MODE" = "ui" ] && SCRIPT=scripts/smoke/pcp-ui-check.ts
  [ "$MODE" = "b18" ] && SCRIPT=scripts/smoke/b18-smoke.ts
  [ "$MODE" = "b18-ui" ] && SCRIPT=scripts/smoke/b18-ui-check.ts
  [ "$MODE" = "b19" ] && SCRIPT=scripts/smoke/b19-smoke.ts
else
  export NODE_ENV=test               # production BUILD, but non-production guards so the mock gateway base URLs are honoured (the schema allows development|test|production)
  export RATE_LIMIT_POLICY=on        # the shared rate limiter is off under NODE_ENV=test unless asked for
  export PAYMENT_PROVIDER_MODE=real
  export RAZORPAY_API_BASE="http://127.0.0.1:45871"
  export PHONEPE_API_BASE="http://127.0.0.1:45872/pg" PHONEPE_AUTH_BASE="http://127.0.0.1:45872/identity/v1/oauth/token"
  export FAST2SMS_API_BASE="http://127.0.0.1:45873/dev"
  export FAST2SMS_API_KEY="smoke-f2s-key-$(rand 4)" FAST2SMS_OTP_ID="smoke-otp-id"
  SCRIPT=scripts/smoke/pcp-gateway-smoke.ts
  [ "$MODE" = "ui-gateway" ] && SCRIPT=scripts/smoke/pcp-ui-gateway-check.ts
fi
export SMOKE_SECRETS="$AUTH_SECRET,$PAYMENT_CREDENTIALS_ENCRYPTION_KEY,$CRON_SECRET,$SMTP_PASS,${FAST2SMS_API_KEY:-}"

echo "== migrate from an EMPTY database ($DB)"
npm run -s db:migrate >/dev/null
TABLES="$(psql "$DB_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
echo "   tables after migration: $TABLES"
echo "== seed"
npm run -s db:seed >/dev/null
echo "   roles: $(psql "$DB_URL" -Atc 'select count(*) from admin_roles'), permissions: $(psql "$DB_URL" -Atc 'select count(*) from permissions'), plans: $(psql "$DB_URL" -Atc 'select count(*) from membership_plans'), admin users: $(psql "$DB_URL" -Atc 'select count(*) from admin_users')"

echo "== start server (NODE_ENV=$NODE_ENV, port $PORT)"
# run node directly (not via npx) so $SERVER_PID is the server itself and the EXIT trap really stops it
node "$ROOT/node_modules/next/dist/bin/next" start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 60); do
  if curl -fs "http://localhost:$PORT/api/v1/health" >/dev/null 2>&1; then break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "server exited early:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done
curl -fs "http://localhost:$PORT/api/v1/health" >/dev/null || { echo "server did not become healthy:"; tail -20 "$LOG"; exit 1; }

echo "== run $SCRIPT"
set +e
npx --no-install tsx "$SCRIPT"
CODE=$?
set -e
echo "== server log lines containing a stack trace or 'secret': $(grep -ciE 'unhandled|stack|secret' "$LOG" || true) (full log: $LOG)"
exit $CODE
