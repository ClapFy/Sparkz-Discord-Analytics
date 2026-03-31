import { z } from "zod";
import { getClickHouse } from "./clickhouse";
import { getWebEnv, getGuildIdU64 } from "./env";

const statMetric = z.enum([
  "messages_24h",
  "joins_24h",
  "leaves_24h",
  "voice_hours_24h",
  "reactions_24h",
]);

const timeseriesMetric = z.enum([
  "messages",
  "joins",
  "leaves",
  "reactions",
  "voice_minutes",
]);

const barMetric = z.enum(["top_channels", "top_emojis"]);

export const widgetQuerySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stat"),
    config: z.object({
      metric: statMetric,
      compare: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("timeseries"),
    config: z.object({
      metric: timeseriesMetric,
      rangeDays: z.number().int().min(1).max(90).default(7),
      bucket: z.enum(["hour", "day"]).default("day"),
      chart: z.enum(["line", "area"]).optional(),
    }),
  }),
  z.object({
    type: z.literal("bar"),
    config: z.object({
      metric: barMetric,
      rangeDays: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(3).max(25).default(10),
    }),
  }),
  z.object({
    type: z.literal("table"),
    config: z.object({
      kind: z.enum(["member_events", "message_events"]),
      limit: z.number().int().min(5).max(100).default(20),
    }),
  }),
]);

export type WidgetQuery = z.infer<typeof widgetQuerySchema>;

function db() {
  return getWebEnv().CLICKHOUSE_DATABASE;
}

function gid() {
  return getGuildIdU64();
}

async function scalarNumber(query: string, params: Record<string, unknown>): Promise<number> {
  const ch = getClickHouse();
  const r = await ch.query({
    query,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as { c?: string }[];
  const row = rows[0];
  if (!row || row.c == null) return 0;
  return Number(row.c);
}

function statSql(
  database: string,
  metric: z.infer<typeof statMetric>,
  window: "last24h" | "prev24h"
): string {
  const time =
    window === "last24h"
      ? "at >= subtractDays(now(), 1)"
      : "at >= subtractDays(now(), 2) AND at < subtractDays(now(), 1)";
  if (metric === "messages_24h") {
    return `SELECT count() AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND ${time}`;
  }
  if (metric === "joins_24h") {
    return `SELECT count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'join' AND ${time}`;
  }
  if (metric === "leaves_24h") {
    return `SELECT count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'leave' AND ${time}`;
  }
  if (metric === "voice_hours_24h") {
    const t =
      window === "last24h"
        ? "ended_at >= subtractDays(now(), 1)"
        : "ended_at >= subtractDays(now(), 2) AND ended_at < subtractDays(now(), 1)";
    return `SELECT coalesce(sum(duration_seconds), 0) / 3600 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND ${t}`;
  }
  return `SELECT count() AS c FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND ${time}`;
}

export async function runWidgetQuery(q: WidgetQuery): Promise<unknown> {
  const g = gid();
  const database = db();
  const ch = getClickHouse();

  switch (q.type) {
    case "stat": {
      const { metric, compare } = q.config;
      const curSql = statSql(database, metric, "last24h");
      const current = await scalarNumber(curSql, { g });
      if (!compare) return { value: current };
      const prevSql = statSql(database, metric, "prev24h");
      const previous = await scalarNumber(prevSql, { g });
      return { value: current, previous };
    }
    case "timeseries": {
      const { metric, rangeDays, bucket } = q.config;
      const interval = bucket === "hour" ? "INTERVAL 1 HOUR" : "INTERVAL 1 DAY";
      let table: string;
      let extra = "";
      if (metric === "messages") {
        table = `${database}.message_events`;
        extra = `AND event = 'create'`;
      } else if (metric === "joins") {
        table = `${database}.member_events`;
        extra = `AND event = 'join'`;
      } else if (metric === "leaves") {
        table = `${database}.member_events`;
        extra = `AND event = 'leave'`;
      } else if (metric === "reactions") {
        table = `${database}.reactions`;
        extra = `AND added = 1`;
      } else {
        const qy = `SELECT toStartOfInterval(started_at, ${interval}) AS t, sum(duration_seconds) / 60 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND started_at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({
          query: qy,
          query_params: { g, d: rangeDays },
          format: "JSONEachRow",
        });
        return await r.json();
      }
      const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, count() AS c FROM ${table} WHERE guild_id = {g:UInt64} ${extra} AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
      const r = await ch.query({
        query: qy,
        query_params: { g, d: rangeDays },
        format: "JSONEachRow",
      });
      return await r.json();
    }
    case "bar": {
      const { metric, rangeDays, limit } = q.config;
      if (metric === "top_channels") {
        const qy = `SELECT channel_id AS k, count() AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32}) GROUP BY k ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({
          query: qy,
          query_params: { g, d: rangeDays, lim: limit },
          format: "JSONEachRow",
        });
        return await r.json();
      }
      const qy = `SELECT emoji AS k, count() AS c FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND at >= subtractDays(now(), {d:UInt32}) GROUP BY k ORDER BY c DESC LIMIT {lim:UInt32}`;
      const r = await ch.query({
        query: qy,
        query_params: { g, d: rangeDays, lim: limit },
        format: "JSONEachRow",
      });
      return await r.json();
    }
    case "table": {
      const { kind, limit } = q.config;
      if (kind === "member_events") {
        const qy = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, user_id, event FROM ${database}.member_events WHERE guild_id = {g:UInt64} ORDER BY at DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({
          query: qy,
          query_params: { g, lim: limit },
          format: "JSONEachRow",
        });
        return await r.json();
      }
      const qy = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, channel_id, author_id, event FROM ${database}.message_events WHERE guild_id = {g:UInt64} ORDER BY at DESC LIMIT {lim:UInt32}`;
      const r = await ch.query({
        query: qy,
        query_params: { g, lim: limit },
        format: "JSONEachRow",
      });
      return await r.json();
    }
    default:
      return null;
  }
}
