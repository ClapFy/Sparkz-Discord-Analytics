#!/usr/bin/env bash
# Wires Railway variables for ClickHouse + this app via CLI.
# Railway has no importable template.json; multi-service templates are edited in the dashboard.
# Run after `railway link` (e.g. `railway link -p Template`) from the repo root.
#
# Optional env overrides:
#   RAILWAY_CLICKHOUSE_SERVICE   DB service name for `railway variables -s`, default: AnalyticsDB
#   RAILWAY_APP_SERVICE          default: Sparkz-Discord-Analytics
#   RAILWAY_CLICKHOUSE_REF       Must match DB service name in ${{...}} refs, default: AnalyticsDB
#   RAILWAY_CLICKHOUSE_DB        default database on server (Railway plugin often uses railway), default: railway
#   RAILWAY_CLICKHOUSE_USER      DB login name exposed to DATABASE_URL (default: clickhouse)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CH="${RAILWAY_CLICKHOUSE_SERVICE:-AnalyticsDB}"
APP="${RAILWAY_APP_SERVICE:-Sparkz-Discord-Analytics}"
REF="${RAILWAY_CLICKHOUSE_REF:-AnalyticsDB}"
DB="${RAILWAY_CLICKHOUSE_DB:-railway}"

echo "Wiring Railway variables: DB service='$CH' app='$APP' (app template refs use name: $REF)"
echo "Project: $(railway status 2>/dev/null | head -5 || true)"
echo

railway variables -s "$CH" \
  --set 'HOST=${{RAILWAY_PRIVATE_DOMAIN}}' \
  --set 'PORT=8123' \
  --set 'HOST_PORT=${{HOST}}:${{PORT}}' \
  --set 'PUBLIC_HOST=${{RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'PUBLIC_PORT=443' \
  --set "CLICKHOUSE_DB=${DB}" \
  --set "CLICKHOUSE_USER=${RAILWAY_CLICKHOUSE_USER:-clickhouse}" \
  --set 'DATABASE_URL=http://${{CLICKHOUSE_USER}}:${{CLICKHOUSE_PASSWORD}}@${{HOST}}:${{PORT}}/${{CLICKHOUSE_DB}}'

railway variables -s "$APP" \
  --set "CLICKHOUSE_HOST=\${{${REF}.RAILWAY_PRIVATE_DOMAIN}}" \
  --set 'CLICKHOUSE_PORT=8123' \
  --set 'CLICKHOUSE_SECURE=false' \
  --set "CLICKHOUSE_USER=\${{${REF}.CLICKHOUSE_USER}}" \
  --set "CLICKHOUSE_PASSWORD=\${{${REF}.CLICKHOUSE_PASSWORD}}" \
  --set "CLICKHOUSE_DATABASE=${DB}" \
  --set 'ADMIN_USERNAME=admin' \
  --set 'ADMIN_PASSWORD=admin' \
  --set 'NEXTAUTH_SECRET=${{secret(64, "abcdef0123456789")}}' \
  --set 'DISCORD_BOT_TOKEN=__REPLACE_WITH_DISCORD_BOT_TOKEN__' \
  --set 'DISCORD_GUILD_ID=000000000000000001'

echo
echo "Done. Verify with: railway variables -k -s $CH | head -20"
echo "              and: railway variables -k -s $APP | grep -E 'CLICKHOUSE_|ADMIN_|DISCORD_|NEXTAUTH_'"
