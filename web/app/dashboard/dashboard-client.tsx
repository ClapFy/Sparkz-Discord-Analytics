"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { v4 as uuidv4 } from "uuid";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { getDefaultDashboardDoc } from "@/lib/default-dashboard";

const ResponsiveGridLayout = WidthProvider(Responsive);

export type WidgetType = "stat" | "timeseries" | "bar" | "table" | "section" | "placeholder";

export interface DashboardItem {
  i: string;
  type: WidgetType;
  title?: string;
  config: Record<string, unknown>;
}

export interface DashboardDoc {
  items: DashboardItem[];
  layouts: Layouts;
}

const defaultDoc: DashboardDoc = {
  items: [],
  layouts: { lg: [], md: [], sm: [], xs: [], xxs: [] },
};

const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const cols = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

function debounce<T extends (...args: Parameters<T>) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Stable signature so polling does not restart when object key order in `config` changes. */
function stableConfigJson(config: Record<string, unknown>): string {
  const keys = Object.keys(config).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = config[k];
  return JSON.stringify(sorted);
}

function stableWidgetsSignature(
  widgets: { i: string; type: string; config: Record<string, unknown> }[]
): string {
  return [...widgets]
    .sort((a, b) => a.i.localeCompare(b.i))
    .map((w) => `${w.i}\t${w.type}\t${stableConfigJson(w.config)}`)
    .join("\n");
}

/** Cheap equality so identical poll payloads do not trigger React re-renders or chart remounts. */
function tilePayloadEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function maxY(layout: Layout[]): number {
  return layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
}

function defaultLayoutsForId(
  layouts: Layouts,
  id: string,
  w: Record<keyof typeof cols, number>,
  h: number
): Layouts {
  const next: Layouts = { ...layouts };
  (Object.keys(cols) as (keyof typeof cols)[]).forEach((bp) => {
    const list = [...(next[bp] ?? [])];
    const y = maxY(list);
    const cw = cols[bp];
    const ww = Math.min(w[bp], cw);
    list.push({ i: id, x: 0, y, w: ww, h, minW: 2, minH: 2 });
    next[bp] = list;
  });
  return next;
}

function defaultConfig(type: WidgetType): Record<string, unknown> {
  switch (type) {
    case "stat":
      return { metric: "messages_24h", compare: true };
    case "timeseries":
      return { metric: "messages", rangeDays: 7, bucket: "day", chart: "line" };
    case "bar":
      return { metric: "top_channels", rangeDays: 7, limit: 8, horizontal: false };
    case "table":
      return { kind: "member_events", limit: 15 };
    case "section":
      return {};
    case "placeholder":
      return { body: "Add context in tile config." };
    default:
      return {};
  }
}

function defaultTitle(type: WidgetType): string {
  switch (type) {
    case "stat":
      return "Stat";
    case "timeseries":
      return "Series";
    case "bar":
      return "Bar";
    case "table":
      return "Table";
    case "section":
      return "Section";
    case "placeholder":
      return "Note";
    default:
      return "Widget";
  }
}

const STAT_COMPARE_LABEL_24H = new Set([
  "messages_24h",
  "joins_24h",
  "leaves_24h",
  "voice_hours_24h",
  "reactions_24h",
  "net_member_change_24h",
  "dau",
]);

function statCompareLabel(metric: string): string {
  return STAT_COMPARE_LABEL_24H.has(metric) ? "vs prior 24h" : "vs prior period";
}

function formatStatValue(metric: string, v: number): string {
  if (metric === "dau_mau_ratio") return v.toFixed(3);
  if (
    metric === "reply_rate_pct_7d" ||
    metric === "lurker_pct_approx" ||
    metric === "reactions_per_message_7d"
  ) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  if (metric === "avg_days_join_to_first_message" || metric === "avg_voice_session_minutes_7d") {
    return v.toFixed(1);
  }
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function SeriesEmptyState({ lines }: { lines: string[] }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px 12px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>
        {lines.map((line, i) => (
          <p
            key={i}
            className="sys-label"
            style={{
              margin: i ? "8px 0 0" : 0,
              color: "var(--muted)",
              lineHeight: 1.5,
              fontSize: 11,
            }}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Poll all data tiles together on this interval (one batched HTTP request). */
const TILE_REFRESH_MS = 1000;

/** Fills tile body height so charts scale when the grid row is tall. */
const CHART_FLEX_BOX: CSSProperties = {
  width: "100%",
  flex: 1,
  minHeight: 160,
  minWidth: 0,
};

type TileEntry = { data?: unknown; err: string | null; hydrated: boolean };

const TileDataContext = createContext<{ entries: Record<string, TileEntry> } | null>(null);

function TileDataProvider({ items, children }: { items: DashboardItem[]; children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, TileEntry>>({});

  const widgets = useMemo(() => {
    return items
      .filter(
        (i): i is DashboardItem & { type: "stat" | "timeseries" | "bar" | "table" } =>
          i.type === "stat" || i.type === "timeseries" || i.type === "bar" || i.type === "table"
      )
      .map((i) => ({ i: i.i, type: i.type, config: i.config }));
  }, [items]);

  const widgetsSig = useMemo(() => stableWidgetsSignature(widgets), [widgets]);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const ctxValue = useMemo(() => ({ entries }), [entries]);

  useEffect(() => {
    const list = [...widgetsRef.current].sort((a, b) => a.i.localeCompare(b.i));

    if (list.length === 0) {
      setEntries({});
      return;
    }

    let cancelled = false;
    /** Bumps when a new fetch starts or the effect cleans up — drop stale overlapping responses. */
    let fetchGen = 0;

    const run = async () => {
      const ticket = ++fetchGen;
      try {
        const r = await fetch("/api/dashboard/query-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ widgets: list }),
        });
        if (cancelled || ticket !== fetchGen) return;

        const j = (await r.json()) as {
          results?: { i: string; ok: boolean; data?: unknown; error?: string }[];
          error?: unknown;
        };

        if (cancelled || ticket !== fetchGen) return;

        if (!r.ok) {
          const msg =
            j?.error != null && typeof j.error === "object"
              ? JSON.stringify(j.error)
              : String(j?.error ?? r.statusText);
          setEntries((prev) => {
            let draft: Record<string, TileEntry> | null = null;
            const touch = () => {
              if (!draft) draft = { ...prev };
              return draft;
            };
            for (const w of list) {
              const p = prev[w.i];
              if (p?.data !== undefined && p.hydrated) {
                if (p.err !== null) {
                  touch()[w.i] = { ...p, err: null };
                }
              } else {
                const errMsg = `Batch: ${msg}`;
                if (!p || p.err !== errMsg || p.hydrated !== false) {
                  touch()[w.i] = { data: p?.data, err: errMsg, hydrated: false };
                }
              }
            }
            return draft ?? prev;
          });
          return;
        }

        const results = j.results ?? [];
        setEntries((prev) => {
          let draft: Record<string, TileEntry> | null = null;
          const touch = () => {
            if (!draft) draft = { ...prev };
            return draft;
          };
          for (const row of results) {
            if (row.ok) {
              const p = prev[row.i];
              if (
                p &&
                p.hydrated &&
                p.err == null &&
                tilePayloadEqual(p.data, row.data)
              ) {
                continue;
              }
              touch()[row.i] = { data: row.data, err: null, hydrated: true };
            } else {
              const p = prev[row.i];
              if (p?.data !== undefined && p.hydrated) {
                if (p.err !== null) {
                  touch()[row.i] = { ...p, err: null };
                }
              } else {
                const errMsg = row.error ?? "Query error";
                if (!p || p.err !== errMsg || p.data !== undefined) {
                  touch()[row.i] = {
                    data: undefined,
                    err: errMsg,
                    hydrated: false,
                  };
                }
              }
            }
          }
          return draft ?? prev;
        });
      } catch (e) {
        if (cancelled || ticket !== fetchGen) return;
        const msg = e instanceof Error ? e.message : "Network error";
        setEntries((prev) => {
          let draft: Record<string, TileEntry> | null = null;
          const touch = () => {
            if (!draft) draft = { ...prev };
            return draft;
          };
          for (const w of list) {
            const p = prev[w.i];
            if (p?.data !== undefined && p.hydrated) {
              if (p.err !== null) {
                touch()[w.i] = { ...p, err: null };
              }
            } else {
              if (!p || p.err !== msg || p.hydrated !== false) {
                touch()[w.i] = { data: undefined, err: msg, hydrated: false };
              }
            }
          }
          return draft ?? prev;
        });
      }
    };

    void run();
    const id = setInterval(run, TILE_REFRESH_MS);
    return () => {
      cancelled = true;
      fetchGen += 1;
      clearInterval(id);
    };
  }, [widgetsSig]);

  return <TileDataContext.Provider value={ctxValue}>{children}</TileDataContext.Provider>;
}

/** Upper bound for Y when only one time bucket exists — keeps the bar proportional (not full-height). */
function yAxisMaxForSinglePoint(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 1;
  if (Number.isInteger(v)) return Math.max(1, Math.ceil(v * 1.2));
  return Math.max(v * 1.2, 1);
}

/** Short axis labels so tilted X ticks and narrow Y lanes stay readable; full string in tooltip. */
function shortenAxisLabel(raw: string, maxLen = 18): string {
  const s = String(raw);
  if (s.length <= maxLen) return s;
  if (/^\d{15,}$/.test(s)) {
    return `${s.slice(0, 5)}…${s.slice(-4)}`;
  }
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}

function barTooltipLabel(label: unknown, payload: unknown): string {
  const row = (payload as { payload?: { nameFull?: string } }[] | undefined)?.[0]?.payload;
  if (row && typeof row.nameFull === "string") return row.nameFull;
  return String(label ?? "");
}

function WidgetBody({ item }: { item: DashboardItem }) {
  const needsQuery = item.type === "stat" || item.type === "timeseries" || item.type === "bar" || item.type === "table";
  const ctx = useContext(TileDataContext);

  const chartTheme = {
    stroke: "#888",
    fill: "#fff",
    grid: "#222",
    tick: "#888",
    join: "#cfcfcf",
    leave: "#666666",
    voice: "#aaaaaa",
    msg: "#ffffff",
  };

  if (item.type === "section") {
    return null;
  }

  if (item.type === "placeholder") {
    return (
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", alignItems: "center" }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem", lineHeight: 1.45 }}>
          {String(item.config.body ?? "")}
        </p>
      </div>
    );
  }

  const loadingWrap = (node: ReactNode) => (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", alignItems: "center" }}>{node}</div>
  );

  if (needsQuery) {
    if (!ctx) {
      return loadingWrap(<p className="sys-label">Loading</p>);
    }
    const entry = ctx.entries[item.i];
    if (!entry) {
      return loadingWrap(<p className="sys-label">Loading</p>);
    }
    if (entry.data === undefined) {
      if (entry.err) {
        return loadingWrap(<p style={{ color: "#c66", margin: 0 }}>{entry.err}</p>);
      }
      return loadingWrap(<p className="sys-label">Loading</p>);
    }
    /* Stale-while-revalidate: keep showing data during refresh (ignore hydrated toggles). */
  }

  const data = needsQuery && ctx ? ctx.entries[item.i]!.data : null;
  if (needsQuery && data === undefined) {
    return loadingWrap(<p className="sys-label">Loading</p>);
  }

  if (item.type === "stat") {
    const metric = String(item.config.metric ?? "");
    const s = data as { value?: number; previous?: number };
    const v = s?.value ?? 0;
    const p = s?.previous;
    let delta: string | null = null;
    if (p != null && Boolean(item.config.compare)) {
      if (p === 0) delta = v > 0 ? "new" : "0";
      else delta = `${(((v - p) / p) * 100).toFixed(1)}%`;
    }
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: "clamp(1.35rem, 2.8vw + 1rem, 2.75rem)",
            lineHeight: 1.05,
            wordBreak: "break-word",
          }}
        >
          {formatStatValue(metric, v)}
        </div>
        {delta != null ? (
          <p className="sys-label" style={{ margin: 0, lineHeight: 1.4 }}>
            {statCompareLabel(metric)}: {delta}
          </p>
        ) : null}
      </div>
    );
  }

  if (item.type === "timeseries") {
    const metric = String(item.config.metric ?? "");
    const raw = Array.isArray(data) ? (data as Record<string, string | number>[]) : [];

    if (metric === "joins_leaves") {
      const rows = raw.map((r) => ({
        t: r.t ? String(r.t).slice(0, 16) : "",
        joins: Number(r.joins ?? 0),
        leaves: Number(r.leaves ?? 0),
      }));
      if (rows.length === 0) {
        return (
          <SeriesEmptyState
            lines={[
              "No join/leave buckets in this range.",
              "Send a test message or trigger a member event after the bot has written to ClickHouse.",
            ]}
          />
        );
      }
      return (
        <div style={CHART_FLEX_BOX}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: chartTheme.tick, fontSize: 10 }} />
              <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="joins" fill={chartTheme.join} name="Joins" />
              <Bar dataKey="leaves" fill={chartTheme.leave} name="Leaves" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    if (metric === "voice_vs_messages") {
      const rows = raw.map((r) => ({
        t: r.t ? String(r.t).slice(0, 16) : "",
        voice_minutes: Number(r.voice_minutes ?? 0),
        messages: Number(r.messages ?? 0),
      }));
      if (rows.length === 0) {
        return (
          <SeriesEmptyState
            lines={["No voice/message buckets in this range.", "Voice sessions and messages appear once data exists."]}
          />
        );
      }
      const chart = (item.config.chart as string) === "area" ? "area" : "line";
      const common = (
        <>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" tick={{ fill: chartTheme.tick, fontSize: 11 }} />
          <YAxis yAxisId="l" tick={{ fill: chartTheme.tick, fontSize: 11 }} width={40} />
          <YAxis yAxisId="r" orientation="right" tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
          <Tooltip
            contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </>
      );
      return (
        <div style={CHART_FLEX_BOX}>
          <ResponsiveContainer width="100%" height="100%">
            {chart === "area" ? (
              <AreaChart data={rows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                {common}
                <Area
                  yAxisId="l"
                  type="monotone"
                  dataKey="voice_minutes"
                  name="Voice min"
                  stroke={chartTheme.voice}
                  fill="rgba(170,170,170,0.12)"
                  dot={false}
                  strokeWidth={1}
                />
                <Area
                  yAxisId="r"
                  type="monotone"
                  dataKey="messages"
                  name="Messages"
                  stroke={chartTheme.msg}
                  fill="rgba(255,255,255,0.06)"
                  dot={false}
                  strokeWidth={1}
                />
              </AreaChart>
            ) : (
              <LineChart data={rows} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                {common}
                <Line
                  yAxisId="l"
                  type="monotone"
                  dataKey="voice_minutes"
                  name="Voice min"
                  stroke={chartTheme.voice}
                  dot={false}
                  activeDot={false}
                  strokeWidth={1}
                />
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="messages"
                  name="Messages"
                  stroke={chartTheme.msg}
                  dot={false}
                  activeDot={false}
                  strokeWidth={1}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      );
    }

    if (metric === "attachments_split") {
      const rows = raw.map((r) => ({
        t: r.t ? String(r.t).slice(0, 16) : "",
        text_only: Number(r.text_only ?? 0),
        with_attachments: Number(r.with_attachments ?? 0),
      }));
      if (rows.length === 0) {
        return (
          <SeriesEmptyState
            lines={["No message rows in this range for attachments split.", "Messages table fills when the bot records chat."]}
          />
        );
      }
      const chart = (item.config.chart as string) === "area" ? "area" : "line";
      const common = (
        <>
          <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" tick={{ fill: chartTheme.tick, fontSize: 11 }} />
          <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
          <Tooltip
            contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </>
      );
      return (
        <div style={CHART_FLEX_BOX}>
          <ResponsiveContainer width="100%" height="100%">
            {chart === "area" ? (
              <AreaChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                {common}
                <Area
                  type="monotone"
                  dataKey="text_only"
                  name="Text only"
                  stackId="1"
                  stroke="#888"
                  fill="rgba(136,136,136,0.2)"
                  dot={false}
                  strokeWidth={1}
                />
                <Area
                  type="monotone"
                  dataKey="with_attachments"
                  name="With attachments"
                  stackId="1"
                  stroke="#fff"
                  fill="rgba(255,255,255,0.15)"
                  dot={false}
                  strokeWidth={1}
                />
              </AreaChart>
            ) : (
              <LineChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                {common}
                <Line
                  type="monotone"
                  dataKey="text_only"
                  name="Text only"
                  stroke="#888"
                  dot={false}
                  activeDot={false}
                  strokeWidth={1}
                />
                <Line
                  type="monotone"
                  dataKey="with_attachments"
                  name="With attachments"
                  stroke="#fff"
                  dot={false}
                  activeDot={false}
                  strokeWidth={1}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      );
    }

    const rows = raw.map((r) => ({
      t: r.t ? String(r.t).slice(0, 16) : "",
      c: Number(r.c ?? 0),
    }));
    if (rows.length === 0) {
      return (
        <SeriesEmptyState
          lines={[
            "No data points in this date range.",
            "If counts stay zero, the bot may not be inserting (check deploy logs) or this guild has no snapshots/events yet.",
          ]}
        />
      );
    }
    if (rows.length === 1) {
      const v = rows[0].c;
      const yMax = yAxisMaxForSinglePoint(v);
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ flex: 1, minHeight: 140, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: chartTheme.tick, fontSize: 11 }} />
                <YAxis
                  domain={[0, yMax]}
                  tick={{ fill: chartTheme.tick, fontSize: 11 }}
                  width={40}
                  allowDecimals={!Number.isInteger(v)}
                />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
                />
                <Bar dataKey="c" fill={chartTheme.fill} radius={[4, 4, 0, 0]} maxBarSize={72} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p
            className="sys-label"
            style={{
              margin: "10px 0 0",
              paddingBottom: 4,
              lineHeight: 1.45,
              flexShrink: 0,
              color: "var(--muted)",
            }}
          >
            Single time bucket — line charts need two or more points; this bar avoids a stray dot. More
            points appear as data accumulates.
          </p>
        </div>
      );
    }
    const chart = (item.config.chart as string) === "area" ? "area" : "line";
    const common = (
      <>
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={{ fill: chartTheme.tick, fontSize: 11 }} />
        <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
        <Tooltip
          contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
        />
      </>
    );
    return (
      <div style={CHART_FLEX_BOX}>
        <ResponsiveContainer width="100%" height="100%">
          {chart === "area" ? (
            <AreaChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              {common}
              <Area
                type="monotone"
                dataKey="c"
                stroke={chartTheme.fill}
                fill="rgba(255,255,255,0.08)"
                dot={false}
                activeDot={false}
                strokeWidth={1}
              />
            </AreaChart>
          ) : (
            <LineChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              {common}
              <Line
                type="monotone"
                dataKey="c"
                stroke={chartTheme.fill}
                dot={false}
                activeDot={false}
                strokeWidth={1}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  if (item.type === "bar") {
    const horizontal = Boolean(item.config.horizontal);
    const rawBars = (Array.isArray(data) ? data : []).map((r: { k?: string; c?: string }) => ({
      nameFull: String(r.k ?? ""),
      c: Number(r.c ?? 0),
    }));
    if (rawBars.length === 0) {
      return (
        <SeriesEmptyState
          lines={["No rows for this chart in the selected range.", "Bars fill once the bot has written matching events."]}
        />
      );
    }
    if (horizontal) {
      const rows = rawBars.map((r) => ({
        name: shortenAxisLabel(r.nameFull, 26),
        nameFull: r.nameFull,
        c: r.c,
      }));
      const maxLen = rows.reduce((m, r) => Math.max(m, r.name.length), 0);
      const yAxisWidth = Math.min(200, Math.max(88, Math.ceil(maxLen * 7 + 14)));
      const chartH = Math.max(200, rows.length * 40 + 56);
      return (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <div style={{ width: "100%", height: chartH, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={rows}
                margin={{ top: 10, right: 16, left: 8, bottom: 10 }}
                barCategoryGap={14}
              >
                <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fill: chartTheme.tick, fontSize: 12 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={yAxisWidth}
                  interval={0}
                  tick={{
                    fill: chartTheme.tick,
                    fontSize: 11,
                    dominantBaseline: "middle",
                  }}
                />
                <Tooltip
                  labelFormatter={(l, p) => barTooltipLabel(l, p)}
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
                />
                <Bar dataKey="c" fill="#ffffff" opacity={0.85} maxBarSize={36} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }
    const rows = rawBars.map((r) => ({
      name: shortenAxisLabel(r.nameFull),
      nameFull: r.nameFull,
      c: r.c,
    }));
    const maxLabelChars = rows.reduce((m, r) => Math.max(m, r.name.length), 0);
    const xAxisHeight = Math.min(100, Math.max(52, 16 + Math.ceil(maxLabelChars * 5.5)));
    const bottomMargin = Math.min(96, Math.max(36, xAxisHeight + 8));
    return (
      <div style={{ ...CHART_FLEX_BOX, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 6, left: -14, bottom: bottomMargin }}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tick={{ fill: chartTheme.tick, fontSize: 10 }}
              interval={0}
              angle={-32}
              textAnchor="end"
              height={xAxisHeight}
              tickMargin={6}
            />
            <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
            <Tooltip
              labelFormatter={(l, p) => barTooltipLabel(l, p)}
              contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
            />
            <Bar dataKey="c" fill="#ffffff" opacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const rows = data as Record<string, string>[];
  if (!rows?.length) {
    return loadingWrap(<p className="sys-label">No rows</p>);
  }
  const keys = Object.keys(rows[0]);
  const cellStyle: CSSProperties = {
    padding: "4px 6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    verticalAlign: "top",
  };
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.88rem",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          {keys.map((k) => {
            const kk = k.toLowerCase();
            let w: string | undefined;
            if (kk === "at" || kk === "t" || kk.endsWith("_at")) w = "14%";
            else if (kk === "channel") w = "20%";
            else if (kk === "author" || kk === "user") w = "42%";
            else if (kk === "event" || kk === "kind" || kk === "action") w = "12%";
            return <col key={k} style={{ width: w }} />;
          })}
        </colgroup>
        <thead>
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                className="sys-label"
                style={{ textAlign: "left", padding: "4px 6px", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #1a1a1a" }}>
              {keys.map((k) => {
                const text = String(r[k] ?? "");
                return (
                  <td key={k} style={cellStyle} title={text}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigForm({
  item,
  onSave,
  onClose,
}: {
  item: DashboardItem;
  onSave: (next: DashboardItem) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DashboardItem>(structuredClone(item));

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div className="panel" style={{ maxWidth: 420, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <p className="sys-label" style={{ marginBottom: 12 }}>
          Tile config
        </p>
        <label className="sys-label">Title</label>
        <input
          value={draft.title ?? ""}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          style={{ marginTop: 4, marginBottom: 12 }}
        />

        {draft.type === "section" ? (
          <p className="sys-label" style={{ marginBottom: 12 }}>
            Section title uses the Title field above. No query runs for this tile.
          </p>
        ) : null}

        {draft.type === "placeholder" ? (
          <>
            <label className="sys-label">Body text</label>
            <textarea
              value={String(draft.config.body ?? "")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, body: e.target.value } })
              }
              rows={5}
              style={{ marginTop: 4, marginBottom: 12, width: "100%", resize: "vertical" }}
            />
          </>
        ) : null}

        {draft.type === "stat" ? (
          <>
            <label className="sys-label">Metric</label>
            <select
              value={String(draft.config.metric ?? "messages_24h")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, metric: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="messages_24h">Messages (24h)</option>
              <option value="joins_24h">Joins (24h)</option>
              <option value="leaves_24h">Leaves (24h)</option>
              <option value="voice_hours_24h">Voice hours (24h)</option>
              <option value="reactions_24h">Reactions added (24h)</option>
              <option value="net_member_change_24h">Net member change (24h)</option>
              <option value="dau">Daily active authors (rolling ~24h)</option>
              <option value="active_users_7d">Active authors (7d)</option>
              <option value="active_users_30d">Active authors (30d)</option>
              <option value="active_users_90d">Active authors (90d)</option>
              <option value="dau_mau_ratio">DAU / MAU ratio</option>
              <option value="avg_voice_session_minutes_7d">Avg voice session (min, 7d)</option>
              <option value="reply_rate_pct_7d">Reply rate % (7d)</option>
              <option value="lurker_pct_approx">Lurker % (approx)</option>
              <option value="reactions_per_message_7d">Reactions per message (7d)</option>
              <option value="churn_leaves_30d">Leaves count (30d)</option>
              <option value="avg_days_join_to_first_message">Avg days join → first message</option>
              <option value="voice_only_users">Users with voice, no text ever</option>
              <option value="messages_in_threads_7d">Messages in threads (7d)</option>
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(draft.config.compare)}
                onChange={(e) =>
                  setDraft({ ...draft, config: { ...draft.config, compare: e.target.checked } })
                }
              />
              <span className="sys-label">Compare prior period</span>
            </label>
          </>
        ) : null}

        {draft.type === "timeseries" ? (
          <>
            <label className="sys-label">Metric</label>
            <select
              value={String(draft.config.metric ?? "messages")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, metric: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="messages">Messages</option>
              <option value="joins">Joins</option>
              <option value="leaves">Leaves</option>
              <option value="reactions">Reactions</option>
              <option value="voice_minutes">Voice minutes</option>
              <option value="member_count">Total members (guild snapshot)</option>
              <option value="joins_leaves">Joins vs leaves (grouped)</option>
              <option value="net_member_change">Net growth (joins − leaves)</option>
              <option value="voice_vs_messages">Voice minutes vs messages</option>
              <option value="attachments_split">Text-only vs attachments</option>
            </select>
            <label className="sys-label">Range (days)</label>
            <input
              type="number"
              min={1}
              max={90}
              value={Number(draft.config.rangeDays ?? 7)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: { ...draft.config, rangeDays: Number(e.target.value) },
                })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            <label className="sys-label">Bucket</label>
            <select
              value={String(draft.config.bucket ?? "day")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, bucket: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="day">Day</option>
              <option value="hour">Hour</option>
            </select>
            <label className="sys-label">Chart</label>
            <select
              value={String(draft.config.chart ?? "line")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, chart: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="line">Line</option>
              <option value="area">Area</option>
            </select>
          </>
        ) : null}

        {draft.type === "bar" ? (
          <>
            <label className="sys-label">Metric</label>
            <select
              value={String(draft.config.metric ?? "top_channels")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, metric: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="top_channels">Top channels</option>
              <option value="top_emojis">Top emojis</option>
              <option value="messages_by_hour">Messages by hour of day</option>
              <option value="messages_by_dow">Messages by weekday</option>
              <option value="top_voice_channels">Top voice channels (minutes)</option>
              <option value="top_authors">Top authors</option>
              <option value="roles_member_count">Role distribution (IDs)</option>
              <option value="joins_by_week">Members by join week</option>
            </select>
            <label className="sys-label">Range (days)</label>
            <input
              type="number"
              min={1}
              max={90}
              value={Number(draft.config.rangeDays ?? 7)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: { ...draft.config, rangeDays: Number(e.target.value) },
                })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            <label className="sys-label">Limit</label>
            <input
              type="number"
              min={3}
              max={25}
              value={Number(draft.config.limit ?? 8)}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, limit: Number(e.target.value) } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(draft.config.horizontal)}
                onChange={(e) =>
                  setDraft({ ...draft, config: { ...draft.config, horizontal: e.target.checked } })
                }
              />
              <span className="sys-label">Horizontal bars</span>
            </label>
          </>
        ) : null}

        {draft.type === "table" ? (
          <>
            <label className="sys-label">Source</label>
            <select
              value={String(draft.config.kind ?? "member_events")}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, kind: e.target.value } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            >
              <option value="member_events">Member events</option>
              <option value="message_events">Message events</option>
              <option value="top_reacted_messages">Most reacted messages</option>
            </select>
            <label className="sys-label">Limit</label>
            <input
              type="number"
              min={5}
              max={100}
              value={Number(draft.config.limit ?? 15)}
              onChange={(e) =>
                setDraft({ ...draft, config: { ...draft.config, limit: Number(e.target.value) } })
              }
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            {String(draft.config.kind ?? "") === "top_reacted_messages" ? (
              <>
                <label className="sys-label">Reaction window (days)</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={Number(draft.config.rangeDays ?? 30)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      config: { ...draft.config, rangeDays: Number(e.target.value) },
                    })
                  }
                  style={{ marginTop: 4, marginBottom: 12 }}
                />
              </>
            ) : null}
          </>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => onSave(draft)}>
            Save
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardClient({ username }: { username: string }) {
  const [doc, setDoc] = useState<DashboardDoc>(defaultDoc);
  const [loaded, setLoaded] = useState(false);
  const [configItem, setConfigItem] = useState<DashboardItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const pull = () => {
      fetch("/api/dashboard/diagnostics")
        .then(async (r) => {
          const j = (await r.json()) as Record<string, unknown>;
          if (!r.ok) {
            if (!cancelled) {
              setDiag({
                ok: false,
                error: String(j.error ?? `HTTP ${r.status}`),
                hint: "Session may have expired — refresh or sign in again.",
              });
            }
            return;
          }
          if (!cancelled) setDiag(j);
        })
        .catch(() => {
          if (!cancelled) setDiag({ ok: false, error: "Diagnostics request failed" });
        });
    };
    pull();
    const id = setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loaded]);

  const saveRef = useRef(
    debounce(async (layout: DashboardDoc) => {
      await fetch("/api/dashboard/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      });
    }, 800)
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/layout")
      .then((r) => r.json())
      .then((j: { layout?: DashboardDoc }) => {
        if (cancelled || !j.layout) return;
        const items = j.layout.items ?? [];
        if (items.length === 0) {
          const d = getDefaultDashboardDoc();
          setDoc({
            items: d.items as DashboardItem[],
            layouts: d.layouts,
          });
          return;
        }
        setDoc({
          items,
          layouts: {
            lg: j.layout.layouts?.lg ?? [],
            md: j.layout.layouts?.md ?? [],
            sm: j.layout.layouts?.sm ?? [],
            xs: j.layout.layouts?.xs ?? [],
            xxs: j.layout.layouts?.xxs ?? [],
          },
        });
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onLayoutChange = useCallback((_layout: Layout[], allLayouts: Layouts) => {
    setDoc((prev) => {
      const next = { ...prev, layouts: allLayouts };
      saveRef.current(next);
      return next;
    });
  }, []);

  const addWidget = (type: WidgetType) => {
    setDoc((prev) => {
      const id = uuidv4();
      const item: DashboardItem = {
        i: id,
        type,
        title: defaultTitle(type),
        config: defaultConfig(type),
      };
      const layouts = defaultLayoutsForId(prev.layouts, id, { lg: 4, md: 4, sm: 6, xs: 4, xxs: 2 }, 4);
      const next = { items: [...prev.items, item], layouts };
      saveRef.current(next);
      return next;
    });
    setAddOpen(false);
  };

  const removeWidget = (id: string) => {
    setConfigItem((c) => (c?.i === id ? null : c));
    setDoc((prev) => {
      const items = prev.items.filter((x) => x.i !== id);
      const layouts: Layouts = { ...prev.layouts };
      (Object.keys(layouts) as (keyof Layouts)[]).forEach((k) => {
        layouts[k] = (layouts[k] ?? []).filter((l) => l.i !== id);
      });
      const next = { items, layouts };
      saveRef.current(next);
      return next;
    });
  };

  const updateItem = (next: DashboardItem) => {
    setDoc((prev) => {
      const items = prev.items.map((x) => (x.i === next.i ? next : x));
      const n = { ...prev, items };
      saveRef.current(n);
      return n;
    });
    setConfigItem(null);
  };

  if (!loaded) {
    return (
      <main style={{ padding: 24 }}>
        <p className="sys-label">Loading layout</p>
      </main>
    );
  }

  return (
    <TileDataProvider items={doc.items}>
      <main style={{ minHeight: "100vh", padding: "12px 12px 48px" }}>
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          <div>
            <p className="sys-label">Dashboard // Grid · tiles refresh every {TILE_REFRESH_MS / 1000}s</p>
            <h1 style={{ margin: "4px 0 0", fontSize: "1.6rem", fontWeight: 400 }}>{username}</h1>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="secondary" onClick={() => setAddOpen(true)}>
              Add tile
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/login";
              }}
            >
              Sign out
            </button>
          </div>
        </header>

        {diag == null ? (
          <p className="sys-label" style={{ marginBottom: 12 }}>
            Checking database…
          </p>
        ) : diag.ok === false ? (
          <p className="sys-label" style={{ marginBottom: 12, color: "#c66", maxWidth: 720 }}>
            Database: {String(diag.error ?? "unreachable")}. {String(diag.hint ?? "")}
          </p>
        ) : (
          <p className="sys-label" style={{ marginBottom: 12, maxWidth: 900, lineHeight: 1.5 }}>
            ClickHouse {String(diag.database ?? "")} · guild {String(diag.guildIdSuffix ?? "")} ·{" "}
            {String(diag.latencyMs ?? "?")}ms · message_events: {String((diag.counts as Record<string, number> | undefined)?.message_events ?? "?")} ·
            messages: {String((diag.counts as Record<string, number> | undefined)?.messages ?? "?")} ·
            member_events: {String((diag.counts as Record<string, number> | undefined)?.member_events ?? "?")}
            {diag.hint ? (
              <span style={{ display: "block", marginTop: 6, color: "#c9a227" }}>{String(diag.hint)}</span>
            ) : null}
          </p>
        )}

        <ResponsiveGridLayout
        className="layout"
        layouts={doc.layouts}
        breakpoints={breakpoints}
        cols={cols}
        rowHeight={32}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        onLayoutChange={onLayoutChange}
        isDraggable
        isResizable
        draggableHandle=".tile-drag"
        compactType="vertical"
        preventCollision={false}
      >
        {doc.items.map((item) => (
          <div key={item.i} className="panel" style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                paddingBottom: item.type === "section" ? 6 : 8,
                borderBottom: item.type === "section" ? "1px solid #2a2a2a" : "1px solid #1a1a1a",
              }}
            >
              <div
                className="tile-drag"
                style={{
                  flex: 1,
                  minWidth: 0,
                  cursor: "grab",
                  touchAction: "none",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span
                  className={item.type === "section" ? undefined : "sys-label"}
                  style={{
                    minWidth: 0,
                    ...(item.type === "section"
                      ? {
                          fontSize: "1rem",
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          fontWeight: 400,
                        }
                      : {}),
                  }}
                >
                  {item.title || item.type}
                </span>
              </div>
              <div
                style={{ display: "flex", gap: 8, flexShrink: 0 }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                  onClick={() => setConfigItem(item)}
                >
                  Config
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                  onClick={() => removeWidget(item.i)}
                >
                  Remove
                </button>
              </div>
            </div>
            <div
              className={item.type === "section" ? undefined : "dashboard-tile-body"}
              style={{
                flex: 1,
                minHeight: 0,
                marginTop: item.type === "section" ? 0 : 8,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <WidgetBody item={item} />
            </div>
          </div>
        ))}
      </ResponsiveGridLayout>

      {addOpen ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 200,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setAddOpen(false)}
        >
          <div className="panel" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <p className="sys-label" style={{ marginBottom: 12 }}>
              Add tile type
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {(["stat", "timeseries", "bar", "table"] as WidgetType[]).map((t) => (
                <button key={t} type="button" onClick={() => addWidget(t)}>
                  {defaultTitle(t)}
                </button>
              ))}
              <button type="button" className="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

        {configItem ? (
          <ConfigForm item={configItem} onSave={updateItem} onClose={() => setConfigItem(null)} />
        ) : null}
      </main>
    </TileDataProvider>
  );
}
