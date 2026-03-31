import type { Layouts } from "react-grid-layout";

export type DefaultWidgetType = "section" | "placeholder" | "stat" | "timeseries" | "bar" | "table";

export interface DefaultDashboardItem {
  i: string;
  type: DefaultWidgetType;
  title?: string;
  config: Record<string, unknown>;
  h: number;
}

const colKeys = ["lg", "md", "sm", "xs", "xxs"] as const;
const colWidths: Record<(typeof colKeys)[number], number> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2,
};

function stackedLayouts(items: DefaultDashboardItem[]): Layouts {
  const layouts: Layouts = { lg: [], md: [], sm: [], xs: [], xxs: [] };
  for (const bp of colKeys) {
    const cw = colWidths[bp];
    let y = 0;
    const row: NonNullable<Layouts["lg"]> = [];
    for (const it of items) {
      row.push({
        i: it.i,
        x: 0,
        y,
        w: cw,
        h: it.h,
        minW: 2,
        minH: it.type === "section" ? 1 : 2,
      });
      y += it.h;
    }
    layouts[bp] = row;
  }
  return layouts;
}

/** Full default dashboard: sections mirror the analytics spec; tiles use data the bot already collects. */
export const defaultDashboardItems: DefaultDashboardItem[] = [
  { i: "sec-members", type: "section", title: "Member analytics", config: {}, h: 1 },
  {
    i: "ts-member-count",
    type: "timeseries",
    title: "Total members (snapshot)",
    config: { metric: "member_count", rangeDays: 30, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "ts-joins-leaves",
    type: "timeseries",
    title: "New joins vs leaves",
    config: { metric: "joins_leaves", rangeDays: 30, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "ts-net-growth",
    type: "timeseries",
    title: "Net growth (joins − leaves)",
    config: { metric: "net_member_change", rangeDays: 30, bucket: "day", chart: "area" },
    h: 8,
  },
  {
    i: "bar-joins-week",
    type: "bar",
    title: "Members by join week",
    config: { metric: "joins_by_week", rangeDays: 90, limit: 20, horizontal: false },
    h: 9,
  },
  {
    i: "st-churn",
    type: "stat",
    title: "Leaves (30d)",
    config: { metric: "churn_leaves_30d", compare: true },
    h: 4,
  },
  {
    i: "ph-members",
    type: "placeholder",
    title: "More member metrics (not in data yet)",
    config: {
      body: "Retention cohort heatmap, invite source pie, geography, bot vs human, and finer churn need extra fields or providers.",
    },
    h: 5,
  },

  { i: "sec-messages", type: "section", title: "Message activity", config: {}, h: 1 },
  {
    i: "ts-messages",
    type: "timeseries",
    title: "Messages over time",
    config: { metric: "messages", rangeDays: 30, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "bar-hour",
    type: "bar",
    title: "Messages by hour of day",
    config: { metric: "messages_by_hour", rangeDays: 14, limit: 24, horizontal: true },
    h: 9,
  },
  {
    i: "bar-dow",
    type: "bar",
    title: "Messages by weekday",
    config: { metric: "messages_by_dow", rangeDays: 30, limit: 7, horizontal: false },
    h: 8,
  },
  {
    i: "bar-channels",
    type: "bar",
    title: "Top channels",
    config: { metric: "top_channels", rangeDays: 14, limit: 10, horizontal: true },
    h: 9,
  },
  {
    i: "bar-authors",
    type: "bar",
    title: "Most active users",
    config: { metric: "top_authors", rangeDays: 14, limit: 10, horizontal: true },
    h: 9,
  },
  {
    i: "ts-attach",
    type: "timeseries",
    title: "Text-only vs with attachments",
    config: { metric: "attachments_split", rangeDays: 30, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "bar-emojis-msg",
    type: "bar",
    title: "Top reaction emojis",
    config: { metric: "top_emojis", rangeDays: 14, limit: 15, horizontal: true },
    h: 9,
  },
  {
    i: "st-reply",
    type: "stat",
    title: "Reply rate (% in thread, 7d)",
    config: { metric: "reply_rate_pct_7d", compare: true },
    h: 4,
  },
  {
    i: "st-thread-msgs",
    type: "stat",
    title: "Messages in threads (7d)",
    config: { metric: "messages_in_threads_7d", compare: true },
    h: 4,
  },
  {
    i: "ph-messages",
    type: "placeholder",
    title: "More message metrics (not in data yet)",
    config: {
      body: "Average message length, exact threads-created count, and attachment MIME breakdown need message body or richer metadata.",
    },
    h: 5,
  },

  { i: "sec-voice", type: "section", title: "Voice activity", config: {}, h: 1 },
  {
    i: "ts-voice",
    type: "timeseries",
    title: "Voice minutes",
    config: { metric: "voice_minutes", rangeDays: 30, bucket: "day", chart: "area" },
    h: 8,
  },
  {
    i: "bar-voice-ch",
    type: "bar",
    title: "Voice channels by minutes",
    config: { metric: "top_voice_channels", rangeDays: 14, limit: 10, horizontal: true },
    h: 9,
  },
  {
    i: "st-voice-avg",
    type: "stat",
    title: "Avg voice session (min, 7d)",
    config: { metric: "avg_voice_session_minutes_7d", compare: true },
    h: 4,
  },
  {
    i: "ts-voice-vs-msg",
    type: "timeseries",
    title: "Voice minutes vs messages",
    config: { metric: "voice_vs_messages", rangeDays: 14, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "st-voice-only",
    type: "stat",
    title: "Users (voice, no text ever)",
    config: { metric: "voice_only_users", compare: false },
    h: 4,
  },
  {
    i: "ph-voice",
    type: "placeholder",
    title: "Peak concurrent voice",
    config: {
      body: "Needs join/leave timestamps per voice channel at high cadence or streaming session overlap analytics.",
    },
    h: 4,
  },

  { i: "sec-roles", type: "section", title: "Role & permission stats", config: {}, h: 1 },
  {
    i: "bar-roles",
    type: "bar",
    title: "Role distribution (role IDs)",
    config: { metric: "roles_member_count", rangeDays: 7, limit: 15, horizontal: true },
    h: 9,
  },
  {
    i: "ph-roles",
    type: "placeholder",
    title: "More role analytics (not in data yet)",
    config: {
      body: "Role-assignment history, common combinations, and empty roles need audit logs or scheduled role snapshots.",
    },
    h: 5,
  },

  { i: "sec-reactions", type: "section", title: "Engagement & reactions", config: {}, h: 1 },
  {
    i: "ts-reactions",
    type: "timeseries",
    title: "Reactions added over time",
    config: { metric: "reactions", rangeDays: 30, bucket: "day", chart: "line" },
    h: 8,
  },
  {
    i: "tbl-reacted",
    type: "table",
    title: "Most reacted messages",
    config: { kind: "top_reacted_messages", limit: 12, rangeDays: 30 },
    h: 10,
  },
  {
    i: "st-react-per-msg",
    type: "stat",
    title: "Reactions per message (7d)",
    config: { metric: "reactions_per_message_7d", compare: true },
    h: 4,
  },
  {
    i: "ph-engagement",
    type: "placeholder",
    title: "Lurker react-only profile",
    config: {
      body: "Cross-user “reacts but never messages” needs a dedicated query or identity graph; partially approximated by voice-only / lurker stats.",
    },
    h: 4,
  },

  { i: "sec-bot", type: "section", title: "Bot & command usage", config: {}, h: 1 },
  {
    i: "ph-bot",
    type: "placeholder",
    title: "Bot metrics (not collected)",
    config: {
      body: "Command counts, latency, and error rates require instrumenting your bot or logging slash-command events into ClickHouse.",
    },
    h: 5,
  },

  { i: "sec-mod", type: "section", title: "Moderation stats", config: {}, h: 1 },
  {
    i: "ph-mod",
    type: "placeholder",
    title: "Moderation (not collected)",
    config: {
      body: "Warns, mutes, kicks, bans, automod, and deleted-message reasons need moderation bot logs ingested here.",
    },
    h: 5,
  },

  { i: "sec-health", type: "section", title: "Health & retention", config: {}, h: 1 },
  {
    i: "st-dau",
    type: "stat",
    title: "Daily active authors (approx. DAU)",
    config: { metric: "dau", compare: true },
    h: 4,
  },
  {
    i: "st-wau",
    type: "stat",
    title: "Active authors (7d)",
    config: { metric: "active_users_7d", compare: true },
    h: 4,
  },
  {
    i: "st-mau",
    type: "stat",
    title: "Active authors (30d)",
    config: { metric: "active_users_30d", compare: true },
    h: 4,
  },
  {
    i: "st-90d",
    type: "stat",
    title: "Active authors (90d)",
    config: { metric: "active_users_90d", compare: true },
    h: 4,
  },
  {
    i: "st-dau-mau",
    type: "stat",
    title: "DAU / MAU ratio",
    config: { metric: "dau_mau_ratio", compare: true },
    h: 4,
  },
  {
    i: "st-lurker",
    type: "stat",
    title: "Lurker % (members − messagers)",
    config: { metric: "lurker_pct_approx", compare: false },
    h: 4,
  },
  {
    i: "st-join-first",
    type: "stat",
    title: "Avg days join → first message",
    config: { metric: "avg_days_join_to_first_message", compare: false },
    h: 4,
  },
  {
    i: "ph-health",
    type: "placeholder",
    title: "More retention metrics (not in data yet)",
    config: {
      body: "Resurrection rate, join→leave averages, and milestone annotations need longer history and optional external labels.",
    },
    h: 5,
  },

  { i: "sec-events", type: "section", title: "Events & milestones", config: {}, h: 1 },
  {
    i: "ph-events",
    type: "placeholder",
    title: "Events & milestones (manual)",
    config: {
      body: "Spike annotations, giveaways, and YoY anniversaries are best layered when you store campaign dates or notes.",
    },
    h: 4,
  },

  { i: "sec-leaderboards", type: "section", title: "Leaderboards", config: {}, h: 1 },
  {
    i: "st-msg-24",
    type: "stat",
    title: "Messages (24h)",
    config: { metric: "messages_24h", compare: true },
    h: 4,
  },
  {
    i: "st-reactions-24",
    type: "stat",
    title: "Reactions added (24h)",
    config: { metric: "reactions_24h", compare: true },
    h: 4,
  },
  {
    i: "st-voice-24",
    type: "stat",
    title: "Voice hours (24h)",
    config: { metric: "voice_hours_24h", compare: true },
    h: 4,
  },
  {
    i: "st-joins-24",
    type: "stat",
    title: "Joins (24h)",
    config: { metric: "joins_24h", compare: true },
    h: 4,
  },
  {
    i: "st-leaves-24",
    type: "stat",
    title: "Leaves (24h)",
    config: { metric: "leaves_24h", compare: true },
    h: 4,
  },
  {
    i: "st-net-24",
    type: "stat",
    title: "Net member change (24h)",
    config: { metric: "net_member_change_24h", compare: true },
    h: 4,
  },
  {
    i: "tbl-members",
    type: "table",
    title: "Recent member events",
    config: { kind: "member_events", limit: 12 },
    h: 10,
  },
  {
    i: "tbl-messages",
    type: "table",
    title: "Recent message events",
    config: { kind: "message_events", limit: 12 },
    h: 10,
  },
];

export function getDefaultDashboardDoc(): {
  items: Omit<DefaultDashboardItem, "h">[];
  layouts: Layouts;
} {
  const items = defaultDashboardItems.map(({ i, type, title, config }) => ({
    i,
    type,
    title,
    config,
  }));
  return {
    items,
    layouts: stackedLayouts(defaultDashboardItems),
  };
}
