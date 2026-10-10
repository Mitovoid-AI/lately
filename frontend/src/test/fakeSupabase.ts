// A stand-in Supabase client for the live-mode AuthProvider tests (not a test file itself).
export const SESSION = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  user: { id: "u1", email: "a@b.co", user_metadata: { full_name: "A B" } },
};

const ok = (session: unknown = SESSION) => ({ data: { session, user: (session as { user?: unknown } | null)?.user ?? null }, error: null });

function makeAuth() {
  return {
    getSession: jest.fn(async () => ({ data: { session: null as unknown }, error: null as unknown })),
    onAuthStateChange: jest.fn((_cb: (event: string, s: unknown) => void) => ({ data: { subscription: { unsubscribe() {} } } })),
    setSession: jest.fn(async (_t: unknown) => ok() as { data: unknown; error: unknown }),
    exchangeCodeForSession: jest.fn(async (_code: string) => ok() as { data: unknown; error: unknown }),
    verifyOtp: jest.fn(async (_p: unknown) => ok() as { data: unknown; error: unknown }),
    signInWithOtp: jest.fn(async (_p: unknown) => ({ data: {}, error: null as unknown })),
    signInWithOAuth: jest.fn(async (_p: unknown) => ({ data: { url: "https://x.supabase.co/auth/v1/authorize" }, error: null as unknown })),
    refreshSession: jest.fn(async () => ok() as { data: { session: unknown }; error: unknown }),
    signOut: jest.fn(async (_o?: unknown) => ({ error: null as unknown })),
    startAutoRefresh: jest.fn(async () => {}),
    stopAutoRefresh: jest.fn(async () => {}),
  };
}

export const mockSupabase = { auth: makeAuth() };

export function resetMockSupabase() {
  mockSupabase.auth = makeAuth();
}
