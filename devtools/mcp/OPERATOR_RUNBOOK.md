# Configure Sparkanalytics with Cursor MCP

Use this when you want **operations and secrets** via MCP while **application code** still ships only through **GitHub** (push → Railway build).

## Servers to enable (Cursor → Settings → MCP)

| Server | Purpose |
|--------|--------|
| **Railway** (`user-railway`) | Link project/service, list/set variables, logs, deploy triggers |
| **ClickHouse** (Cursor ClickHouse plugin) | Run read-only SQL against the same cluster the bot/web use (after `mcp_auth`) |

Do **not** paste raw **`list-variables`** output into chats or tickets — it includes secrets. Prefer Railway’s dashboard or redact values.

## Railway layout (this repo’s linked project)

- **TestDB** — ClickHouse (internal hostname `clickhouse.railway.internal`, public host on Railway).
- **sparkanalytics** — Web (and bot env if you run both from this service) — uses `CLICKHOUSE_*` pointing at the internal host.

## One-time: link the app service to this workspace

From the agent or MCP tools:

1. `list-services` with `workspacePath` = your clone of this repo (e.g. `.../sparkzanalytics`).
2. `link-service` with `workspacePath` + `serviceName`: **`sparkanalytics`**.

Until a service is linked, `list-variables` without `service` can fail with “No service linked”.

## Set / update variables (MCP)

Tool: **`set-variables`**

- `workspacePath`: path to this repo root.
- `service`: **`sparkanalytics`** (or the service that runs the Next app / bot).
- `variables`: array of `KEY=value` strings.

Recommended keys (see root `.env.example`):

- `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN` (bot service or combined service)
- `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_SECURE`
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `NEXTAUTH_SECRET` or `SESSION_SECRET` (≥ 32 chars)
- `INTERNAL_DIAG_TOKEN` (≥ 32 chars) for `GET /api/internal/diagnostics`

**GitHub-only deploys:** changing variables in Railway does **not** replace git; it only updates runtime config. Code changes = commit + push; Railway rebuilds from the repo.

## ClickHouse MCP

1. Run tool **`mcp_auth`** on the ClickHouse MCP server (empty `{}`) and complete auth in the IDE.
2. Use the plugin’s query tools to validate tables (`message_events`, `member_events`, etc.) and row counts for your `guild_id`.

## Internal diagnostics (HTTP)

After `INTERNAL_DIAG_TOKEN` is set, use:

- `GET /api/internal/diagnostics` with `Authorization: Bearer <token>`
- Or browser: `/internal/diag` on your public web URL  

See `devtools/INTERNAL_DIAGNOSTICS.md`.

## What was done via MCP in the setup pass

- Linked Railway service **`sparkanalytics`** to workspace path **`/Users/misha/Desktop/Coding/sparkzanalytics`**.
- Set **`INTERNAL_DIAG_TOKEN`** on service **`sparkanalytics`** (verify under Variables in Railway if needed).

---

**Security:** If variable lists were ever copied into a chat, **rotate** Discord bot token, ClickHouse password, admin password, and session secret in Railway, then redeploy.
