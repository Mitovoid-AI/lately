// Website auth. Two pieces:
//
//   1. The bot issues a short numeric login code in Telegram DM.
//   2. The user pastes it into the site; we swap it for a session cookie.
//
// Why not the Telegram Login Widget? It requires a registered public domain and
// refuses to run against localhost, which is exactly where we're testing. The
// code flow works locally with no tunnel and is still tied to a real Telegram
// account, because only the bot could have delivered the code.
import { randomBytes, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import {
  LOGIN_CODE_TTL_MINUTES,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
} from "./config";
import type { User } from "./types";

// Creates a 6-digit login code for a user. Uses randomInt (CSPRNG), not
// Math.random, since this code is the only thing standing between a stranger
// and someone's saves.
export async function issueLoginCode(userId: string): Promise<string> {
  const code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(
    Date.now() + LOGIN_CODE_TTL_MINUTES * 60_000,
  ).toISOString();

  const { error } = await db()
    .from("login_codes")
    .insert({ code, user_id: userId, expires_at: expiresAt });
  if (error) throw new Error(`issueLoginCode: ${error.message}`);
  return code;
}

// Exchanges a valid, unused, unexpired code for a session token.
// Returns null on any failure — we deliberately don't say which reason.
export async function redeemLoginCode(code: string): Promise<string | null> {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return null;

  const { data: row } = await db()
    .from("login_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", trimmed)
    .maybeSingle();

  if (!row) return null;
  const rec = row as unknown as {
    user_id: string;
    expires_at: string;
    used_at: string | null;
  };
  if (rec.used_at) return null;
  if (new Date(rec.expires_at).getTime() < Date.now()) return null;

  // Burn the code so it can't be replayed.
  await db()
    .from("login_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", trimmed);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 86_400_000,
  ).toISOString();

  const { error } = await db()
    .from("sessions")
    .insert({ token, user_id: rec.user_id, expires_at: expiresAt });
  if (error) throw new Error(`redeemLoginCode: ${error.message}`);

  return token;
}

// Resolves the signed-in user from the session cookie, or null.
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data: sess } = await db()
    .from("sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!sess) return null;

  const s = sess as unknown as { user_id: string; expires_at: string };
  if (new Date(s.expires_at).getTime() < Date.now()) return null;

  const { data: user } = await db()
    .from("users")
    .select("*")
    .eq("id", s.user_id)
    .maybeSingle();
  return (user as unknown as User) ?? null;
}

export async function destroySession(token: string): Promise<void> {
  await db().from("sessions").delete().eq("token", token);
}
