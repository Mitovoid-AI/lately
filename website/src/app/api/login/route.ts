// Exchanges a bot-issued login code for a session cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redeemLoginCode } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/lib/config";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  if (!body.code) {
    return NextResponse.json({ error: "Code required." }, { status: 400 });
  }

  const token = await redeemLoginCode(body.code);
  if (!token) {
    // Deliberately vague: don't reveal whether the code existed, expired, or
    // was already used.
    return NextResponse.json(
      { error: "Invalid or expired code." },
      { status: 401 },
    );
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure is off for local http://localhost testing; enable in production.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  return NextResponse.json({ ok: true });
}
