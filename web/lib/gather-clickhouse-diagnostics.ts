import { getClickHouse } from "./clickhouse";
import type { WebEnv } from "./env";
import { getWebEnv, getGuildIdU64 } from "./env";

type CountRow = { name: string; cnt: string };

export type GatherResult =
  | {
      ok: true;
      database: string;
      guildIdSuffix: string;
      guildIdLength: number;
      latencyMs: number;
      counts: Record<string, number>;
      hint: string | null;
    }
  | {
      ok: false;
      database?: string;
      error: string;
      hint: string;
    };

/** Shared counts query for dashboard UI and internal diagnostics API. */
export async function gatherClickhouseDiagnostics(env: WebEnv): Promise<GatherResult> {
  const g = getGuildIdU64();
  const db = env.CLICKHOUSE_DATABASE;

  try {
    const ch = getClickHouse();
    const started = Date.now();
    const q = `
      SELECT 'message_events' AS name, count() AS cnt FROM ${db}.message_events WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'member_events', count() FROM ${db}.member_events WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'messages', count() FROM ${db}.messages FINAL WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'reactions', count() FROM ${db}.reactions WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'voice_sessions', count() FROM ${db}.voice_sessions WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'guild_snapshots', count() FROM ${db}.guild_snapshots WHERE guild_id = {g:UInt64}
      UNION ALL SELECT 'members', count() FROM ${db}.members FINAL WHERE guild_id = {g:UInt64}
    `;
    const r = await ch.query({
      query: q,
      query_params: { g },
      format: "JSONEachRow",
    });
    const rows = (await r.json()) as CountRow[];
    const latencyMs = Date.now() - started;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.name] = Number(row.cnt ?? 0);
    }
    const totalEvents =
      (counts.message_events ?? 0) +
      (counts.member_events ?? 0) +
      (counts.reactions ?? 0) +
      (counts.voice_sessions ?? 0);

    return {
      ok: true,
      database: db,
      guildIdSuffix: g.length > 6 ? `…${g.slice(-6)}` : g,
      guildIdLength: g.length,
      latencyMs,
      counts,
      hint:
        totalEvents === 0
          ? "No rows for this guild_id. Confirm DISCORD_GUILD_ID matches the bot target guild and the bot service is running and connected to this ClickHouse database."
          : null,
    };
  } catch (e) {
    console.error("gatherClickhouseDiagnostics", e);
    return {
      ok: false,
      database: db,
      error: e instanceof Error ? e.message : String(e),
      hint: "Check CLICKHOUSE_* env vars on the web service and network access to ClickHouse.",
    };
  }
}

/** Extended diagnostics for bearer-authenticated internal API (read-only samples, redacted env). */
export async function gatherInternalDeepDiagnostics(): Promise<Record<string, unknown>> {
  let env: WebEnv;
  try {
    env = getWebEnv();
  } catch (e) {
    return {
      ok: false,
      phase: "env" as const,
      error: e instanceof Error ? e.message : String(e),
      hint: "Web env validation failed (missing or invalid DISCORD_GUILD_ID, CLICKHOUSE_*, session secret, etc.).",
    };
  }

  const g = getGuildIdU64();
  const base = await gatherClickhouseDiagnostics(env);

  const redactedEnv = {
    CLICKHOUSE_HOST: env.CLICKHOUSE_HOST,
    CLICKHOUSE_PORT: env.CLICKHOUSE_PORT,
    CLICKHOUSE_DATABASE: env.CLICKHOUSE_DATABASE,
    CLICKHOUSE_SECURE: env.CLICKHOUSE_SECURE,
    DISCORD_GUILD_ID_SUFFIX: g.length > 6 ? `…${g.slice(-6)}` : g,
    DISCORD_GUILD_ID_LENGTH: g.length,
    NODE_VERSION: process.version,
  };

  if (!base.ok) {
    return { ...base, env: redactedEnv };
  }

  const db = env.CLICKHOUSE_DATABASE;
  const ch = getClickHouse();
  const samples: Record<string, unknown> = {};

  try {
    const q1 = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, event FROM ${db}.message_events WHERE guild_id = {g:UInt64} ORDER BY at DESC LIMIT 5`;
    const r1 = await ch.query({ query: q1, query_params: { g }, format: "JSONEachRow" });
    samples.recent_message_events = await r1.json();

    const q2 = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, event FROM ${db}.member_events WHERE guild_id = {g:UInt64} ORDER BY at DESC LIMIT 5`;
    const r2 = await ch.query({ query: q2, query_params: { g }, format: "JSONEachRow" });
    samples.recent_member_events = await r2.json();
  } catch (e) {
    samples.error = e instanceof Error ? e.message : String(e);
  }

  return {
    ...base,
    env: redactedEnv,
    samples,
    deploymentNote:
      "Set INTERNAL_DIAG_TOKEN only in your host secrets (e.g. Railway from GitHub). Rotate if leaked. No passwords are returned by this endpoint.",
  };
}
