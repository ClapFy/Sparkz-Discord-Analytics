import { z } from "zod";
import { getClickHouse } from "./clickhouse";
import {
  enrichBarRowsByKeyKind,
  enrichMemberEventTableRows,
  enrichMessageEventTableRows,
  enrichTopReactedTableRows,
} from "./discord-resolve";
import { getWebEnv, getGuildIdU64 } from "./env";

const statMetric = z.enum([
  "messages_24h",
  "joins_24h",
  "leaves_24h",
  "voice_hours_24h",
  "reactions_24h",
  "net_member_change_24h",
  "dau",
  "active_users_7d",
  "active_users_30d",
  "active_users_90d",
  "dau_mau_ratio",
  "avg_voice_session_minutes_7d",
  "reply_rate_pct_7d",
  "lurker_pct_approx",
  "reactions_per_message_7d",
  "churn_leaves_30d",
  "avg_days_join_to_first_message",
  "voice_only_users",
  "messages_in_threads_7d",
]);

const timeseriesMetric = z.enum([
  "messages",
  "joins",
  "leaves",
  "reactions",
  "voice_minutes",
  "member_count",
  "joins_leaves",
  "net_member_change",
  "voice_vs_messages",
  "attachments_split",
]);

const barMetric = z.enum([
  "top_channels",
  "top_emojis",
  "messages_by_hour",
  "messages_by_dow",
  "top_voice_channels",
  "top_authors",
  "roles_member_count",
  "joins_by_week",
]);

const tableKind = z.enum(["member_events", "message_events", "top_reacted_messages"]);

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
      horizontal: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("table"),
    config: z.object({
      kind: tableKind,
      limit: z.number().int().min(5).max(100).default(20),
      rangeDays: z.number().int().min(1).max(90).optional(),
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

/**
 * One row per (guild_id, message_id, event) with min(at) — collapses duplicate inserts
 * for the same logical Discord event.
 * Filter in an inner subquery so time predicates on `at` are not merged with the outer
 * aggregate; ClickHouse otherwise errors: "Aggregate function min(at) AS at is found in WHERE".
 */
function messageEventsDeduped(database: string, whereClause: string): string {
  return `(SELECT guild_id, message_id, any(channel_id) AS channel_id, any(author_id) AS author_id, event, min(at) AS at FROM (SELECT guild_id, message_id, channel_id, author_id, event, at FROM ${database}.message_events WHERE ${whereClause}) AS _me GROUP BY guild_id, message_id, event)`;
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
  metric: "messages_24h" | "joins_24h" | "leaves_24h" | "voice_hours_24h" | "reactions_24h",
  window: "last24h" | "prev24h"
): string {
  const time =
    window === "last24h"
      ? "at >= subtractDays(now(), 1)"
      : "at >= subtractDays(now(), 2) AND at < subtractDays(now(), 1)";
  if (metric === "messages_24h") {
    return `SELECT count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND ${time}`)} AS _d`;
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

async function statScalar(
  database: string,
  g: string,
  metric: z.infer<typeof statMetric>,
  window: "last24h" | "prev24h"
): Promise<number> {
  const time24 = "at >= subtractDays(now(), 1)";
  const timePrev = "at >= subtractDays(now(), 2) AND at < subtractDays(now(), 1)";

  if (
    metric === "messages_24h" ||
    metric === "joins_24h" ||
    metric === "leaves_24h" ||
    metric === "voice_hours_24h" ||
    metric === "reactions_24h"
  ) {
    return scalarNumber(statSql(database, metric, window), { g });
  }

  if (metric === "net_member_change_24h") {
    const t = window === "last24h" ? time24 : timePrev;
    const q = `SELECT countIf(event = 'join') - countIf(event = 'leave') AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND ${t}`;
    return scalarNumber(q, { g });
  }

  if (metric === "dau") {
    const t =
      window === "last24h"
        ? "at >= subtractDays(now(), 1)"
        : "at >= subtractDays(now(), 2) AND at < subtractDays(now(), 1)";
    const q = `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND ${t}`;
    return scalarNumber(q, { g });
  }

  if (metric === "active_users_7d") {
    const q =
      window === "last24h"
        ? `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 7)`
        : `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 14) AND at < subtractDays(now(), 7)`;
    return scalarNumber(q, { g });
  }

  if (metric === "active_users_30d") {
    const q =
      window === "last24h"
        ? `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 30)`
        : `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 60) AND at < subtractDays(now(), 30)`;
    return scalarNumber(q, { g });
  }

  if (metric === "active_users_90d") {
    const q =
      window === "last24h"
        ? `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 90)`
        : `SELECT uniqExact(author_id) AS c FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 180) AND at < subtractDays(now(), 90)`;
    return scalarNumber(q, { g });
  }

  if (metric === "dau_mau_ratio") {
    const q =
      window === "last24h"
        ? `SELECT if(mau > 0, toFloat64(dau) / toFloat64(mau), 0) AS c FROM (SELECT uniqExactIf(author_id, at >= subtractDays(now(), 1)) AS dau, uniqExactIf(author_id, at >= subtractDays(now(), 30)) AS mau FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 30))`
        : `SELECT if(mau > 0, toFloat64(dau) / toFloat64(mau), 0) AS c FROM (SELECT uniqExactIf(author_id, at >= subtractDays(now(), 2) AND at < subtractDays(now(), 1)) AS dau, uniqExactIf(author_id, at >= subtractDays(now(), 31) AND at < subtractDays(now(), 1)) AS mau FROM ${database}.message_events WHERE guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), 31) AND at < subtractDays(now(), 1))`;
    return scalarNumber(q, { g });
  }

  if (metric === "avg_voice_session_minutes_7d") {
    const q =
      window === "last24h"
        ? `SELECT coalesce(avg(duration_seconds), 0) / 60 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND ended_at >= subtractDays(now(), 7)`
        : `SELECT coalesce(avg(duration_seconds), 0) / 60 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND ended_at >= subtractDays(now(), 14) AND ended_at < subtractDays(now(), 7)`;
    return scalarNumber(q, { g });
  }

  if (metric === "reply_rate_pct_7d") {
    const q =
      window === "last24h"
        ? `SELECT if(count() > 0, countIf(reference_message_id IS NOT NULL) * 100.0 / count(), 0) AS c FROM ${database}.messages FINAL WHERE guild_id = {g:UInt64} AND created_at >= subtractDays(now(), 7)`
        : `SELECT if(count() > 0, countIf(reference_message_id IS NOT NULL) * 100.0 / count(), 0) AS c FROM ${database}.messages FINAL WHERE guild_id = {g:UInt64} AND created_at >= subtractDays(now(), 14) AND created_at < subtractDays(now(), 7)`;
    return scalarNumber(q, { g });
  }

  if (metric === "lurker_pct_approx") {
    const q = `
      SELECT if(m > 0, greatest(m - msg, 0) * 100.0 / m, 0) AS c FROM (
        SELECT
          (SELECT toFloat64(uniqExact(user_id)) FROM ${database}.members FINAL WHERE guild_id = {g:UInt64}) AS m,
          (SELECT toFloat64(uniqExact(author_id)) FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create'`)} AS _dm) AS msg
      )
    `;
    return scalarNumber(q, { g });
  }

  if (metric === "reactions_per_message_7d") {
    const rcCond =
      window === "last24h"
        ? `at >= subtractDays(now(), 7)`
        : `at >= subtractDays(now(), 14) AND at < subtractDays(now(), 7)`;
    const mcCond =
      window === "last24h"
        ? `at >= subtractDays(now(), 7)`
        : `at >= subtractDays(now(), 14) AND at < subtractDays(now(), 7)`;
    const q = `
      SELECT if(mc > 0, rc / mc, 0) AS c FROM (
        SELECT
          toFloat64((SELECT count() FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND ${rcCond})) AS rc,
          toFloat64(greatest((SELECT count() FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND ${mcCond}`)} AS _dm), 1)) AS mc
      )
    `;
    return scalarNumber(q, { g });
  }

  if (metric === "churn_leaves_30d") {
    const q =
      window === "last24h"
        ? `SELECT count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'leave' AND at >= subtractDays(now(), 30)`
        : `SELECT count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'leave' AND at >= subtractDays(now(), 60) AND at < subtractDays(now(), 30)`;
    return scalarNumber(q, { g });
  }

  if (metric === "avg_days_join_to_first_message") {
    const q = `
      SELECT coalesce(avg(dateDiff('day', j.first_join, m.first_msg)), 0) AS c FROM (
        SELECT user_id, min(joined_at) AS first_join FROM ${database}.members FINAL WHERE guild_id = {g:UInt64} AND joined_at IS NOT NULL GROUP BY user_id
      ) AS j
      INNER JOIN (
        SELECT author_id AS user_id, min(at) AS first_msg FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create'`)} AS _dm GROUP BY author_id
      ) AS m ON j.user_id = m.user_id
    `;
    return scalarNumber(q, { g });
  }

  if (metric === "voice_only_users") {
    const q = `
      SELECT uniqExact(v.user_id) AS c FROM ${database}.voice_sessions v
      WHERE v.guild_id = {g:UInt64}
        AND v.user_id NOT IN (
          SELECT author_id FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create'`)} AS _dm
        )
    `;
    return scalarNumber(q, { g });
  }

  if (metric === "messages_in_threads_7d") {
    const q =
      window === "last24h"
        ? `SELECT count() AS c FROM ${database}.messages FINAL WHERE guild_id = {g:UInt64} AND thread_id IS NOT NULL AND created_at >= subtractDays(now(), 7)`
        : `SELECT count() AS c FROM ${database}.messages FINAL WHERE guild_id = {g:UInt64} AND thread_id IS NOT NULL AND created_at >= subtractDays(now(), 14) AND created_at < subtractDays(now(), 7)`;
    return scalarNumber(q, { g });
  }

  return 0;
}

export async function runWidgetQuery(q: WidgetQuery): Promise<unknown> {
  const g = gid();
  const database = db();
  const ch = getClickHouse();

  switch (q.type) {
    case "stat": {
      const { metric, compare } = q.config;
      const supportsCompare =
        metric === "messages_24h" ||
        metric === "joins_24h" ||
        metric === "leaves_24h" ||
        metric === "voice_hours_24h" ||
        metric === "reactions_24h" ||
        metric === "net_member_change_24h" ||
        metric === "dau" ||
        metric === "active_users_7d" ||
        metric === "active_users_30d" ||
        metric === "active_users_90d" ||
        metric === "dau_mau_ratio" ||
        metric === "avg_voice_session_minutes_7d" ||
        metric === "reply_rate_pct_7d" ||
        metric === "reactions_per_message_7d" ||
        metric === "churn_leaves_30d" ||
        metric === "messages_in_threads_7d";

      const current = await statScalar(database, g, metric, "last24h");
      if (!compare || !supportsCompare) return { value: current };
      const previous = await statScalar(database, g, metric, "prev24h");
      return { value: current, previous };
    }
    case "timeseries": {
      const { metric, rangeDays, bucket } = q.config;
      const interval = bucket === "hour" ? "INTERVAL 1 HOUR" : "INTERVAL 1 DAY";

      if (metric === "member_count") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, max(member_count) AS c FROM ${database}.guild_snapshots WHERE guild_id = {g:UInt64} AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }

      if (metric === "joins_leaves") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, countIf(event = 'join') AS joins, countIf(event = 'leave') AS leaves FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }

      if (metric === "net_member_change") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, countIf(event = 'join') - countIf(event = 'leave') AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }

      if (metric === "voice_vs_messages") {
        const qy = `
          WITH
            v AS (
              SELECT toStartOfInterval(started_at, ${interval}) AS t, sum(duration_seconds) / 60.0 AS voice_minutes
              FROM ${database}.voice_sessions
              WHERE guild_id = {g:UInt64} AND started_at >= subtractDays(now(), {d:UInt32})
              GROUP BY t
            ),
            m AS (
              SELECT toStartOfInterval(at, ${interval}) AS t, count() AS messages
              FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm
              GROUP BY t
            )
          SELECT coalesce(v.t, m.t) AS t, coalesce(v.voice_minutes, 0) AS voice_minutes, coalesce(m.messages, 0) AS messages
          FROM v FULL OUTER JOIN m ON v.t = m.t
          ORDER BY t
        `;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }

      if (metric === "attachments_split") {
        const qy = `SELECT toStartOfInterval(created_at, ${interval}) AS t, countIf(attachment_count = 0) AS text_only, countIf(attachment_count > 0) AS with_attachments FROM ${database}.messages FINAL WHERE guild_id = {g:UInt64} AND created_at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }

      if (metric === "messages") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }
      if (metric === "joins") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'join' AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }
      if (metric === "leaves") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, count() AS c FROM ${database}.member_events WHERE guild_id = {g:UInt64} AND event = 'leave' AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }
      if (metric === "reactions") {
        const qy = `SELECT toStartOfInterval(at, ${interval}) AS t, count() AS c FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }
      const qy = `SELECT toStartOfInterval(started_at, ${interval}) AS t, sum(duration_seconds) / 60 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND started_at >= subtractDays(now(), {d:UInt32}) GROUP BY t ORDER BY t`;
      const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
      return await r.json();
    }
    case "bar": {
      const { metric, rangeDays, limit } = q.config;
      if (metric === "top_channels") {
        const qy = `SELECT toString(channel_id) AS k, count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm GROUP BY channel_id ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as { k?: string; c?: string }[];
        return enrichBarRowsByKeyKind(rows, g, "channel");
      }
      if (metric === "top_emojis") {
        const qy = `SELECT emoji AS k, count() AS c FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND at >= subtractDays(now(), {d:UInt32}) GROUP BY k ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays, lim: limit }, format: "JSONEachRow" });
        return await r.json();
      }
      if (metric === "messages_by_hour") {
        const qy = `SELECT toHour(at) AS hk, count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm GROUP BY hk ORDER BY hk`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        const rows = (await r.json()) as { hk?: string; c?: string }[];
        return rows.map((row) => ({ k: `${row.hk ?? 0}:00`, c: row.c ?? "0" }));
      }
      if (metric === "messages_by_dow") {
        const qy = `SELECT toDayOfWeek(at) AS dow, count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm GROUP BY dow ORDER BY dow`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const rows = (await r.json()) as { dow?: string; c?: string }[];
        return rows.map((row) => ({
          k: names[Number(row.dow ?? 1)] ?? String(row.dow),
          c: row.c ?? "0",
        }));
      }
      if (metric === "top_voice_channels") {
        const qy = `SELECT toString(channel_id) AS k, sum(duration_seconds) / 60 AS c FROM ${database}.voice_sessions WHERE guild_id = {g:UInt64} AND started_at >= subtractDays(now(), {d:UInt32}) GROUP BY channel_id ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as { k?: string; c?: string }[];
        return enrichBarRowsByKeyKind(rows, g, "channel");
      }
      if (metric === "top_authors") {
        const qy = `SELECT toString(author_id) AS k, count() AS c FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64} AND event = 'create' AND at >= subtractDays(now(), {d:UInt32})`)} AS _dm GROUP BY author_id ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as { k?: string; c?: string }[];
        return enrichBarRowsByKeyKind(rows, g, "user");
      }
      if (metric === "roles_member_count") {
        const qy = `SELECT toString(role_id) AS k, count() AS c FROM ${database}.members FINAL ARRAY JOIN role_ids AS role_id WHERE guild_id = {g:UInt64} GROUP BY role_id ORDER BY c DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as { k?: string; c?: string }[];
        return enrichBarRowsByKeyKind(rows, g, "role");
      }
      if (metric === "joins_by_week") {
        const qy = `SELECT formatDateTime(toStartOfWeek(joined_at), '%Y-%m-%d') AS k, count() AS c FROM ${database}.members FINAL WHERE guild_id = {g:UInt64} AND joined_at IS NOT NULL AND joined_at >= subtractDays(now(), {d:UInt32}) GROUP BY k ORDER BY k`;
        const r = await ch.query({ query: qy, query_params: { g, d: rangeDays }, format: "JSONEachRow" });
        return await r.json();
      }
      return [];
    }
    case "table": {
      const { kind, limit, rangeDays } = q.config;
      const reactedDays = rangeDays ?? 30;
      if (kind === "member_events") {
        const qy = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, toString(user_id) AS user_id, event FROM ${database}.member_events WHERE guild_id = {g:UInt64} ORDER BY at DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as Record<string, string>[];
        return enrichMemberEventTableRows(rows, g);
      }
      if (kind === "message_events") {
        const qy = `SELECT formatDateTime(at, '%Y-%m-%d %H:%i:%s') AS at, toString(channel_id) AS channel_id, toString(author_id) AS author_id, event FROM ${messageEventsDeduped(database, `guild_id = {g:UInt64}`)} AS _dm ORDER BY at DESC LIMIT {lim:UInt32}`;
        const r = await ch.query({ query: qy, query_params: { g, lim: limit }, format: "JSONEachRow" });
        const rows = (await r.json()) as Record<string, string>[];
        return enrichMessageEventTableRows(rows, g);
      }
      const qy = `SELECT toString(message_id) AS message_id, toString(channel_id) AS channel_id, count() AS reaction_count FROM ${database}.reactions WHERE guild_id = {g:UInt64} AND added = 1 AND at >= subtractDays(now(), {rd:UInt32}) GROUP BY message_id, channel_id ORDER BY reaction_count DESC LIMIT {lim:UInt32}`;
      const r = await ch.query({ query: qy, query_params: { g, lim: limit, rd: reactedDays }, format: "JSONEachRow" });
      const reacted = (await r.json()) as Record<string, string>[];
      return enrichTopReactedTableRows(reacted, g);
    }
    default:
      return null;
  }
}
