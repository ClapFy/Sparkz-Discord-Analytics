import { type NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/session";

function secretKey(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    return new Uint8Array();
  }
  return new TextEncoder().encode(s);
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const loginUrl = new URL("/login", request.url);
  if (!token) {
    return NextResponse.redirect(loginUrl);
  }
  const key = secretKey();
  if (key.length === 0) {
    return NextResponse.redirect(loginUrl);
  }
  try {
    await jwtVerify(token, key);
    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(SESSION_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*"],
};
