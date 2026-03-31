import { NextResponse } from "next/server";
import { z } from "zod";
import { runWidgetQuery, widgetQuerySchema } from "@/lib/queries";
import { getSession } from "@/lib/session";

const MAX_WIDGETS = 64;

const bodySchema = z.object({
  widgets: z
    .array(
      z.object({
        i: z.string().min(1),
        type: z.enum(["stat", "timeseries", "bar", "table"]),
        config: z.record(z.unknown()),
      })
    )
    .min(0)
    .max(MAX_WIDGETS),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { widgets } = parsed.data;
  const at = Date.now();

  const results = await Promise.all(
    widgets.map(async (w) => {
      const q = widgetQuerySchema.safeParse({ type: w.type, config: w.config });
      if (!q.success) {
        return { i: w.i, ok: false as const, error: "Invalid widget config" };
      }
      try {
        const data = await runWidgetQuery(q.data);
        return { i: w.i, ok: true as const, data };
      } catch (e) {
        console.error("query-batch tile", w.i, e);
        return {
          i: w.i,
          ok: false as const,
          error: e instanceof Error ? e.message : "Query failed",
        };
      }
    })
  );

  return NextResponse.json({ results, at });
}
