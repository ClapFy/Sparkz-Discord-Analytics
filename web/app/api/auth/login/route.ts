import { NextResponse } from "next/server";
import { z } from "zod";
import { safeEqualString } from "@/lib/auth-compare";
import { getWebEnv } from "@/lib/env";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/session";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { username, password } = parsed.data;
  let env;
  try {
    env = getWebEnv();
  } catch {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const userOk = safeEqualString(username.trim(), env.ADMIN_USERNAME);
  const passOk = safeEqualString(password, env.ADMIN_PASSWORD);
  if (!userOk || !passOk) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const token = await createSessionToken(env.ADMIN_USERNAME);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
