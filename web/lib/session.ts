import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "sa_session";

function getSecretKey(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("NEXTAUTH_SECRET or SESSION_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(s);
}

export async function createSessionToken(username: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const sub = payload.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<{ username: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const username = await verifySessionToken(token);
  if (!username) return null;
  return { username };
}

export function sessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}
