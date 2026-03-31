# Internal diagnostics (operators & agents)

## Purpose

Read-only JSON bundle: ClickHouse table counts for the configured guild, redacted env fields, and the last few `message_events` / `member_events` rows. No passwords or full tokens are returned.

## Enable

1. Generate a long random secret (32+ characters), e.g. `openssl rand -hex 32`.
2. Set **`INTERNAL_DIAG_TOKEN`** on the **web** service in your host (Railway, etc.).
3. Deploy the web app **only through your GitHub-linked pipeline** (same as the rest of this repo). Rotate the token in platform secrets if it leaks.

## HTTP

```http
GET /api/internal/diagnostics
Authorization: Bearer <INTERNAL_DIAG_TOKEN>
```

- If `INTERNAL_DIAG_TOKEN` is unset: **404** `{"error":"Not found"}` (route not advertised).
- Wrong token: **401** `{"error":"Unauthorized"}`.

## Browser

Open **`/internal/diag`** on your deployed site, paste the token, click **Run diagnostics**. The page is `noindex`; it only talks to your own origin.

## cURL

```bash
curl -sS -H "Authorization: Bearer $INTERNAL_DIAG_TOKEN" "https://YOUR_WEB_ORIGIN/api/internal/diagnostics" | jq .
```

## MCP / Cursor

- **Railway MCP:** use `link-service` + `set-variables` / `list-variables` with this repo’s `workspacePath`. Full workflow: `devtools/mcp/OPERATOR_RUNBOOK.md`.
- Standard **fetch** tools often cannot set custom `Authorization` headers for this API. Prefer **terminal + curl** (above) or the **browser** page.
- **ClickHouse MCP:** call `mcp_auth` on the plugin server, then run queries against the same DB as `CLICKHOUSE_*` on the web/bot service.
- **Deploys:** code only via **GitHub** push; Railway MCP is for variables, logs, and operational actions — not a substitute for git.

## Security

- Treat `INTERNAL_DIAG_TOKEN` like a password.
- Do not commit it to the repo; use host secrets only.
