import type { AuthError, Session, SupabaseClient } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { DEMO_USER } from "../api/demo";
import { config } from "../config";
import { deviceStore, type KeyValueStore } from "../lib/storage";
import { authParamsFromUrl, authRedirectUrl, isAuthRedirect } from "./redirect";
import { getSupabase } from "./supabase";

// On web the OAuth popup/redirect lands back here; this finishes it (no-op on native).
WebBrowser.maybeCompleteAuthSession();

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

/** Why a sign-in step failed, in terms the sign-in screens can word for people. */
export type AuthFailure =
  | "cancelled" // the person closed the Google window
  | "provider_disabled" // the provider isn't switched on in Supabase
  | "rate_limited" // too many emails / attempts
  | "invalid_code" // wrong or expired 6-digit code / link
  | "network"
  | "failed";

export class AuthFlowError extends Error {
  constructor(
    readonly reason: AuthFailure,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "AuthFlowError";
  }
}

export interface AuthValue {
  status: "loading" | "signed-out" | "signed-in";
  user: AuthUser | null;
  mode: "demo" | "live";
  /** Set when a sign-in link or redirect could not be completed. */
  linkError?: AuthFailure | null;
  signInDemo(): Promise<void>;
  signInWithEmail(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  refreshAccessToken(): Promise<string | null>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

const DEMO_KEY = "lately.demo-session";
const DEMO_AUTH_USER: AuthUser = { id: DEMO_USER.id, email: DEMO_USER.email, name: DEMO_USER.name, avatarUrl: null };

function userFrom(session: Session | null): AuthUser | null {
  const u = session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const email = u.email ?? "";
  return {
    id: u.id,
    email,
    name: (meta.full_name as string) || (meta.name as string) || email.split("@")[0] || "You",
    avatarUrl: (meta.avatar_url as string) || (meta.picture as string) || null,
  };
}

/** Supabase Auth errors → the few outcomes the UI distinguishes. */
export function failureFrom(error: AuthError | Error | null | undefined): AuthFailure {
  if (!error) return "failed";
  const e = error as AuthError & { code?: string; status?: number };
  const text = `${e.code ?? ""} ${e.message ?? ""}`.toLowerCase();
  if (e.status === 429 || text.includes("rate limit") || text.includes("over_email_send")) return "rate_limited";
  if (text.includes("provider is not enabled") || text.includes("unsupported provider")) return "provider_disabled";
  if (text.includes("otp_expired") || text.includes("expired") || text.includes("invalid")) return "invalid_code";
  if (e.name === "AuthRetryableFetchError" || text.includes("network") || text.includes("fetch")) return "network";
  return "failed";
}

/** Is this OAuth provider switched on in the Supabase project? (null = couldn't tell) */
async function providerEnabled(provider: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseKey } });
    if (!res.ok) return null;
    const settings = (await res.json()) as { external?: Record<string, boolean> };
    return settings.external?.[provider] ?? null;
  } catch {
    return null;
  }
}

/**
 * Turns a sign-in redirect into a session: a PKCE `?code=` (Google and email links; the code
 * is useless without the verifier this app kept) or an email `?token_hash=`. Raw tokens in a
 * redirect are ignored: with the PKCE flow Supabase never sends them, so any that arrive over
 * the custom scheme did not come from our own sign-in. Throws AuthFlowError when the redirect
 * carries an error or a dead code.
 */
export async function sessionFromRedirect(sb: SupabaseClient, url: string): Promise<void> {
  const p = authParamsFromUrl(url);
  if (p.error || p.error_description) {
    throw new AuthFlowError(
      p.error_code === "otp_expired" ? "invalid_code" : failureFrom(new Error(`${p.error_code} ${p.error_description}`)),
      p.error_description,
    );
  }
  let error: AuthError | null = null;
  if (p.code) {
    ({ error } = await sb.auth.exchangeCodeForSession(p.code));
  } else if (p.token_hash) {
    const type = p.type === "signup" || p.type === "invite" || p.type === "recovery" ? p.type : "magiclink";
    ({ error } = await sb.auth.verifyOtp({ token_hash: p.token_hash, type }));
  } else {
    return;
  }
  if (error) throw new AuthFlowError(failureFrom(error), error.message);
}

export function AuthProvider({
  mode = config.apiMode,
  storage = deviceStore,
  children,
}: {
  mode?: "demo" | "live";
  storage?: KeyValueStore;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<AuthValue["status"]>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [linkError, setLinkError] = useState<AuthFailure | null>(null);
  const session = useRef<Session | null>(null);
  // A redirect can reach us twice (the Google window's result and the deep link): handle each once.
  const handled = useRef(new Set<string>());

  const completeRedirect = useCallback(async (url: string) => {
    if (handled.current.has(url)) return;
    handled.current.add(url);
    setLinkError(null);
    try {
      await sessionFromRedirect(getSupabase(), url);
    } catch (e) {
      const reason = e instanceof AuthFlowError ? e.reason : "failed";
      // A second copy of a link we already used fails harmlessly once signed in.
      if (!session.current) setLinkError(reason);
      throw e;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (mode === "demo") {
      storage
        .getItem(DEMO_KEY)
        .catch(() => null)
        .then((v) => {
          if (!active) return;
          setUser(v === "1" ? DEMO_AUTH_USER : null);
          setStatus(v === "1" ? "signed-in" : "signed-out");
        });
      return () => {
        active = false;
      };
    }
    const apply = (s: Session | null) => {
      if (!active) return;
      session.current = s;
      setUser(userFrom(s));
      setStatus(s ? "signed-in" : "signed-out");
      if (s) setLinkError(null);
    };
    let unsubscribe = () => {};
    try {
      const sb = getSupabase();
      sb.auth.getSession().then(({ data }) => apply(data.session));
      const { data } = sb.auth.onAuthStateChange((_event, s) => apply(s));
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (e) {
      console.warn(e);
      Promise.resolve().then(() => apply(null));
    }

    // Email links and OAuth redirects open the app at /auth-callback with the session in the URL.
    // (On web, supabase-js reads it from the address bar itself: detectSessionInUrl.)
    let linkSub: { remove(): void } | null = null;
    if (Platform.OS === "web") {
      // supabase-js consumes good links itself; an expired or refused one only needs reporting.
      const here = typeof window !== "undefined" ? window.location.href : "";
      const p = authParamsFromUrl(here);
      if (p.error || p.error_description) {
        const reason = p.error_code === "otp_expired" ? "invalid_code" : failureFrom(new Error(`${p.error_code} ${p.error_description}`));
        Promise.resolve().then(() => {
          if (active) setLinkError(reason);
        });
      }
    } else {
      const onUrl = (url: string | null) => {
        if (url && isAuthRedirect(url)) completeRedirect(url).catch(() => {});
      };
      Linking.getInitialURL().then(onUrl).catch(() => {});
      linkSub = Linking.addEventListener("url", ({ url }) => onUrl(url));
    }
    return () => {
      active = false;
      unsubscribe();
      linkSub?.remove();
    };
  }, [mode, storage, completeRedirect]);

  // Supabase's advice for React Native: refresh tokens only while the app is in the foreground
  // (timers don't run reliably in the background, and a refresh there just fails).
  useEffect(() => {
    if (mode !== "live" || Platform.OS === "web") return;
    let sb: SupabaseClient;
    try {
      sb = getSupabase();
    } catch {
      return;
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void sb.auth.startAutoRefresh();
      else void sb.auth.stopAutoRefresh();
    });
    return () => sub?.remove();
  }, [mode]);

  const signInDemo = useCallback(async () => {
    await storage.setItem(DEMO_KEY, "1").catch(() => {});
    setUser(DEMO_AUTH_USER);
    setStatus("signed-in");
  }, [storage]);

  /** Email sign-in and sign-up are one step: Supabase creates the account on first use. */
  const signInWithEmail = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true },
    });
    if (error) throw new AuthFlowError(failureFrom(error), error.message);
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw new AuthFlowError(failureFrom(error), error.message);
  }, []);

  /**
   * Google through Supabase OAuth. Web: a full-page redirect. Native: an in-app auth browser
   * that returns straight to the app with the session.
   */
  const signInWithGoogle = useCallback(async () => {
    if ((await providerEnabled("google")) === false) {
      throw new AuthFlowError("provider_disabled", "Google is not enabled in Supabase Auth.");
    }
    const redirectTo = authRedirectUrl();
    const { data, error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== "web", queryParams: { prompt: "select_account" } },
    });
    if (error) throw new AuthFlowError(failureFrom(error), error.message);
    if (Platform.OS === "web" || !data?.url) return;

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success") throw new AuthFlowError("cancelled");
    await completeRedirect(result.url);
  }, [completeRedirect]);

  const signOut = useCallback(async () => {
    if (mode === "demo") {
      await storage.setItem(DEMO_KEY, "0").catch(() => {});
    } else {
      await getSupabase().auth.signOut();
    }
    session.current = null;
    setUser(null);
    setStatus("signed-out");
  }, [mode, storage]);

  const getAccessToken = useCallback(async () => session.current?.access_token ?? null, []);

  const refreshAccessToken = useCallback(async () => {
    if (mode === "demo") return null;
    const { data } = await getSupabase().auth.refreshSession();
    session.current = data.session;
    return data.session?.access_token ?? null;
  }, [mode]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      mode,
      linkError,
      signInDemo,
      signInWithEmail,
      verifyCode,
      signInWithGoogle,
      signOut,
      getAccessToken,
      refreshAccessToken,
    }),
    [status, user, mode, linkError, signInDemo, signInWithEmail, verifyCode, signInWithGoogle, signOut, getAccessToken, refreshAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
