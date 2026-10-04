import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { DEMO_USER } from "../api/demo";
import { config } from "../config";
import { deviceStore, type KeyValueStore } from "../lib/storage";
import { getSupabase } from "./supabase";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthValue {
  status: "loading" | "signed-out" | "signed-in";
  user: AuthUser | null;
  mode: "demo" | "live";
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
    avatarUrl: (meta.avatar_url as string) || null,
  };
}

function webOrigin(): string | undefined {
  return Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : undefined;
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
  const session = useRef<Session | null>(null);

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
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mode, storage]);

  const signInDemo = useCallback(async () => {
    await storage.setItem(DEMO_KEY, "1").catch(() => {});
    setUser(DEMO_AUTH_USER);
    setStatus("signed-in");
  }, [storage]);

  const signInWithEmail = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({ email, options: { emailRedirectTo: webOrigin() } });
    if (error) throw error;
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: webOrigin() },
    });
    if (error) throw error;
  }, []);

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
      signInDemo,
      signInWithEmail,
      verifyCode,
      signInWithGoogle,
      signOut,
      getAccessToken,
      refreshAccessToken,
    }),
    [status, user, mode, signInDemo, signInWithEmail, verifyCode, signInWithGoogle, signOut, getAccessToken, refreshAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
