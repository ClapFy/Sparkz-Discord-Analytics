import { NextResponse } from "next/server";
import { gatherInternalDeepDiagnostics } from "@/lib/gather-clickhouse-diagnostics";
import { internalDiagnosticsEnabled, verifyInternalDiagnosticsBearer } from "@/lib/internal-bearer-auth";

/**
 * Operator / agent diagnostics: Bearer token only (no dashboard session).
 * Disabled (404) when INTERNAL_DIAG_TOKEN is unset — avoids advertising the route.
 * Deploy config and secrets only through your GitHub-linked pipeline (e.g. Railway).
 */
export async function GET(req: Request) {
  if (!internalDiagnosticsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!verifyInternalDiagnosticsBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await gatherInternalDeepDiagnostics();
  return NextResponse.json(
    { at: Date.now(), ...payload },
    {
      status: 200,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}
