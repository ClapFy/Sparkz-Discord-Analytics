# Sparkz Analytics

Monorepo for a silent Discord analytics collector and a password-protected Next.js dashboard backed by ClickHouse. Message text is not stored; only metadata and event fields are written.

## Structure

- `bot/` — Node.js TypeScript service using discord.js. Connects to ClickHouse and ingests guild events for a single server ID. Leaves any other guild immediately. No commands and no chat responses.
- `web/` — Next.js App Router dashboard. Credentials auth via NextAuth, draggable dashboard tiles (react-grid-layout), charts via Recharts. All ClickHouse queries run on the server.
- `clickhouse/migrations/` — SQL to create the database and tables. Apply these once against your ClickHouse instance before running the bot or web app.

Root `package.json` defines npm workspaces `bot` and `web`.

## Requirements

- Node.js 20 or newer.
- A ClickHouse instance reachable from both Railway services (ClickHouse Cloud, self-hosted, or a container).
- A Discord application with a bot user. Do not enable the Message Content Intent; this project does not read or store message bodies.

### Discord intents (Developer Portal)

Enable privileged intents as needed for your server size:

- Server Members Intent (for `GuildMembers`, member join/leave/update).
- Message Content Intent must stay **disabled** (not used).

Non-privileged intents used by the bot:

- `Guilds`, `GuildMessages`, `GuildVoiceStates`, `GuildMessageReactions`.

Invite the bot with permissions that allow reading channels you want counted (View Channel, Read Message History). Reactions and voice require no extra message content.

## ClickHouse setup

1. Create a database user and database (or use defaults).
2. Run migrations in order:

```bash
clickhouse-client --host YOUR_HOST --secure --port 8443 -u USER --password PASS -q "$(cat clickhouse/migrations/001_init.sql)"
```

Or paste the file contents into the ClickHouse SQL console. The default database name in the migration file is `sparkzanalytics`. If you use another name, set `CLICKHOUSE_DATABASE` to match everywhere and adjust the migration `CREATE DATABASE` / table qualifiers if you remove the hard-coded database prefix in SQL.

Tables: `messages`, `message_events`, `member_events`, `members`, `voice_sessions`, `reactions`, `channels`, `guild_snapshots`, `dashboard_layouts`.

## Local development

Install from the repository root:

```bash
npm install
```

Bot:

```bash
cp .env.example .env
# Edit .env with bot variables only (see table below).
npm run dev -w bot
```

Web:

```bash
# Use a .env.local inside web/ or export variables (see table below).
cd web && cp ../.env.example .env.local
npm run dev -w web
```

Open `http://localhost:3000`, sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`, then open the dashboard.

## Railway deployment

### Single service (bot plus dashboard)

This repository supports one Railway service that runs the Discord bot and the Next.js app together (see root `nixpacks.toml`, `railway.toml`, and `npm run start:railway`).

- **Root directory:** repository root (not `web/` or `bot/`).
- **Build:** Nixpacks runs `npm ci` and `npm run build` (both workspaces).
- **Start:** `start:railway` runs the compiled bot in the background and Next.js on `PORT` with `--hostname 0.0.0.0`.

Place the ClickHouse service in the **same Railway project** and use the **private** hostname for HTTP (no TLS on the internal network):

- `CLICKHOUSE_HOST=clickhouse.railway.internal` (or the value of `HOST` / `RAILWAY_PRIVATE_DOMAIN` from the ClickHouse service variables).
- `CLICKHOUSE_PORT=8123`
- `CLICKHOUSE_SECURE=false`
- `CLICKHOUSE_DATABASE=railway` if you use the default Railway ClickHouse database name (see that service's `CLICKHOUSE_DB`).

On first boot the bot runs DDL from `clickhouse/migrations/001_init.sql` against `CLICKHOUSE_DATABASE` (skipped if `SKIP_SCHEMA_ENSURE=true`).

Set `AUTH_TRUST_HOST=true` so NextAuth accepts the Railway public hostname without hard-coding `NEXTAUTH_URL`. Still set a long random `NEXTAUTH_SECRET` (at least 32 characters).

Health check path: `/api/health`.

### Two-service alternative

You can instead deploy `bot/` and `web/` as separate Railway services with separate root directories; use the same ClickHouse variables on both (internal host recommended when colocated in one project).

If the web build runs without variables, provide the same env vars during the build phase on Railway so `next build` can validate configuration when routes are analyzed.

## Environment variables

| Variable | Service | Format / notes |
|----------|---------|----------------|
| `DISCORD_BOT_TOKEN` | bot only | Discord bot token string. |
| `DISCORD_GUILD_ID` | bot, web | Numeric snowflake string. Target guild only; bot leaves all others. Web uses this to scope queries. Must match between bot and web. |
| `CLICKHOUSE_HOST` | bot, web | Hostname only, no `https://` prefix. |
| `CLICKHOUSE_PORT` | bot, web | Integer. Common values: `8443` (HTTPS native interface), `8123` (HTTP). |
| `CLICKHOUSE_USER` | bot, web | String. |
| `CLICKHOUSE_PASSWORD` | bot, web | String; may be empty on local dev. |
| `CLICKHOUSE_DATABASE` | bot, web | Database name, default `sparkzanalytics`. |
| `CLICKHOUSE_SECURE` | bot, web | `true` or `false`. Use `true` for TLS (typical for ClickHouse Cloud). |
| `ADMIN_USERNAME` | web only | Dashboard login username. |
| `ADMIN_PASSWORD` | web only | Dashboard login password; use a strong value. |
| `NEXTAUTH_SECRET` | web only | At least 32 characters, random. |
| `NEXTAUTH_URL` | web only | Public base URL of the web app, e.g. `https://your-service.up.railway.app`. |
| `LOG_LEVEL` | bot optional | `debug`, `info`, `warn`, or `error`. Default `info`. |
| `CH_BATCH_MS` | bot optional | Batch flush interval in milliseconds. Default `2000`. |
| `CH_BATCH_MAX_ROWS` | bot optional | Flush when buffer reaches this many rows. Default `500`. |

## Privacy note

The bot records message metadata (IDs, timestamps, attachment and embed counts, flags, type) but not message content. Channel names are not stored in ClickHouse. User IDs and channel IDs are stored for analytics.

## Git and remotes

This repository includes a `.gitignore` suitable for Node and Next.js. No remote or GitHub push is configured by the project; add your own remote when ready.
