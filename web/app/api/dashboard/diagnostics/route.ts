import { NextResponse } from "next/server";
import { getClickHouse } from "@/lib/clickhouse";
import { getWebEnv, getGuildIdU64 } from "@/lib/env";
import { getSession } from "@/lib/session";

type CountRow = { name: string; cnt: string };

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getWebEnv();
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

    return NextResponse.json({
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
    });
  } catch (e) {
    console.error("diagnostics", e);
    return NextResponse.json(
      {
        ok: false,
        database: db,
        error: e instanceof Error ? e.message : String(e),
        hint: "Check CLICKHOUSE_* env vars on the web service and network access to ClickHouse.",
      },
      { status: 200 }
    );
  }
}
