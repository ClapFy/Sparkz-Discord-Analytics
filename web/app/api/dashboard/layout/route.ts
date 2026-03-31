import { NextResponse } from "next/server";
import { getClickHouse } from "@/lib/clickhouse";
import { getWebEnv } from "@/lib/env";
import { getSession } from "@/lib/session";
import { z } from "zod";

const bodySchema = z.object({
  layout: z.object({
    items: z.array(
      z.object({
        i: z.string(),
        type: z.enum(["stat", "timeseries", "bar", "table"]),
        title: z.string().optional(),
        config: z.record(z.unknown()),
      })
    ),
    layouts: z.record(
      z.array(
        z.object({
          i: z.string(),
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
          minW: z.number().optional(),
          minH: z.number().optional(),
        })
      )
    ),
  }),
});

const defaultLayout = {
  items: [] as unknown[],
  layouts: { lg: [], md: [], sm: [], xs: [], xxs: [] },
};

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const env = getWebEnv();
  const ch = getClickHouse();
  const q = `
    SELECT layout_json
    FROM ${env.CLICKHOUSE_DATABASE}.dashboard_layouts
    WHERE username = {u:String}
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const r = await ch.query({
    query: q,
    query_params: { u: session.username },
    format: "JSONEachRow",
  });
  const rows = (await r.json()) as { layout_json?: string }[];
  if (!rows.length || !rows[0]?.layout_json) {
    return NextResponse.json({ layout: defaultLayout });
  }
  try {
    const parsed = JSON.parse(rows[0].layout_json);
    return NextResponse.json({ layout: parsed });
  } catch {
    return NextResponse.json({ layout: defaultLayout });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const json = await req.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const env = getWebEnv();
  const ch = getClickHouse();
  await ch.insert({
    table: `${env.CLICKHOUSE_DATABASE}.dashboard_layouts`,
    values: [
      {
        username: session.username,
        layout_json: JSON.stringify(parsed.data.layout),
        updated_at: new Date(),
      },
    ],
    format: "JSONEachRow",
  });
  return NextResponse.json({ ok: true });
}
