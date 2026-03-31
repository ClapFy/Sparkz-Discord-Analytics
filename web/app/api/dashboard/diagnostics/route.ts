import { NextResponse } from "next/server";
import { gatherClickhouseDiagnostics } from "@/lib/gather-clickhouse-diagnostics";
import { getWebEnv } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getWebEnv();
  const result = await gatherClickhouseDiagnostics(env);
  return NextResponse.json(result);
}
