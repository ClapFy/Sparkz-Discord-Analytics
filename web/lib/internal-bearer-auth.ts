import { timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LEN = 32;

export function internalDiagnosticsEnabled(): boolean {
  const t = process.env.INTERNAL_DIAG_TOKEN?.trim();
  return Boolean(t && t.length >= MIN_TOKEN_LEN);
}

/** Constant-time compare of Bearer token to INTERNAL_DIAG_TOKEN. */
export function verifyInternalDiagnosticsBearer(authHeader: string | null): boolean {
  const expected = process.env.INTERNAL_DIAG_TOKEN?.trim();
  if (!expected || expected.length < MIN_TOKEN_LEN) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const provided = authHeader.slice(7).trim();
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
