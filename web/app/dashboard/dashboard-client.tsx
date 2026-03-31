"use client";

import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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

const ResponsiveGridLayout = WidthProvider(Responsive);

export type WidgetType = "stat" | "timeseries" | "bar" | "table";

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
      return { metric: "top_channels", rangeDays: 7, limit: 8 };
    case "table":
      return { kind: "member_events", limit: 15 };
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
    default:
      return "Widget";
  }
}

async function postQuery(body: unknown) {
  const r = await fetch("/api/dashboard/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("query failed");
  const j = (await r.json()) as { data: unknown };
  return j.data;
}

function WidgetBody({ item }: { item: DashboardItem }) {
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const payload = useMemo(
    () => ({ type: item.type, config: item.config }),
    [item.type, item.config]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    postQuery(payload)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErr("Load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const chartTheme = {
    stroke: "#888",
    fill: "#fff",
    grid: "#222",
    tick: "#888",
  };

  if (loading) return <p className="sys-label">Loading</p>;
  if (err) return <p style={{ color: "#c66" }}>{err}</p>;

  if (item.type === "stat") {
    const s = data as { value?: number; previous?: number };
    const v = s?.value ?? 0;
    const p = s?.previous;
    let delta: string | null = null;
    if (p != null && Boolean(item.config.compare)) {
      if (p === 0) delta = v > 0 ? "new" : "0";
      else delta = `${(((v - p) / p) * 100).toFixed(1)}%`;
    }
    return (
      <div>
        <div style={{ fontSize: "2.2rem", lineHeight: 1 }}>{Number.isInteger(v) ? v : v.toFixed(2)}</div>
        {delta != null ? (
          <p className="sys-label" style={{ marginTop: 8 }}>
            vs prior 24h: {delta}
          </p>
        ) : null}
      </div>
    );
  }

  if (item.type === "timeseries") {
    const rows = (data as { t?: string; c?: string }[]).map((r) => ({
      t: r.t ? String(r.t).slice(0, 16) : "",
      c: Number(r.c ?? 0),
    }));
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
      <div style={{ width: "100%", height: 200, minWidth: 0 }}>
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
                strokeWidth={1}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  if (item.type === "bar") {
    const rows = (data as { k?: string; c?: string }[]).map((r) => ({
      name: String(r.k ?? "").slice(0, 18),
      c: Number(r.c ?? 0),
    }));
    return (
      <div style={{ width: "100%", height: 220, minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -18, bottom: 40 }}>
            <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tick={{ fill: chartTheme.tick, fontSize: 10 }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fill: chartTheme.tick, fontSize: 11 }} width={36} />
            <Tooltip
              contentStyle={{ background: "#0a0a0a", border: "1px solid #333", color: "#fff" }}
            />
            <Bar dataKey="c" fill="#ffffff" opacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const rows = data as Record<string, string>[];
  if (!rows?.length) return <p className="sys-label">No rows</p>;
  const keys = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} className="sys-label" style={{ textAlign: "left", padding: "4px 6px" }}>
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #1a1a1a" }}>
              {keys.map((k) => (
                <td key={k} style={{ padding: "4px 6px", wordBreak: "break-all" }}>
                  {String(r[k] ?? "")}
                </td>
              ))}
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
            </select>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(draft.config.compare)}
                onChange={(e) =>
                  setDraft({ ...draft, config: { ...draft.config, compare: e.target.checked } })
                }
              />
              <span className="sys-label">Compare prior 24h</span>
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

export function DashboardClient() {
  const { data: session } = useSession();
  const [doc, setDoc] = useState<DashboardDoc>(defaultDoc);
  const [loaded, setLoaded] = useState(false);
  const [configItem, setConfigItem] = useState<DashboardItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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
        setDoc({
          items: j.layout.items ?? [],
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
    <main style={{ minHeight: "100vh", padding: "12px 12px 48px" }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <div>
          <p className="sys-label">Dashboard // Grid</p>
          <h1 style={{ margin: "4px 0 0", fontSize: "1.6rem", fontWeight: 400 }}>
            {session?.user?.name ?? "Admin"}
          </h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="secondary" onClick={() => setAddOpen(true)}>
            Add tile
          </button>
          <button type="button" className="secondary" onClick={() => signOut({ callbackUrl: "/login" })}>
            Sign out
          </button>
        </div>
      </header>

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
              className="tile-drag"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                cursor: "grab",
                paddingBottom: 8,
                borderBottom: "1px solid #1a1a1a",
                touchAction: "none",
              }}
            >
              <span className="sys-label" style={{ flex: 1, minWidth: 0 }}>
                {item.title || item.type}
              </span>
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
            <div style={{ flex: 1, minHeight: 0, marginTop: 8 }}>
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
  );
}
