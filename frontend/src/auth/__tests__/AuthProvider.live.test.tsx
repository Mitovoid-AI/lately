import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { createMemoryStore } from "../../test/memoryStore";
import { AuthProvider, PROVIDER_CHECK_MS, providerEnabled, sessionFromRedirect, useAuth } from "../AuthProvider";
import { emitAuthEvent, mockSupabase, resetMockSupabase, SESSION } from "../../test/fakeSupabase";

jest.mock("../supabase", () => ({ getSupabase: () => jest.requireActual("../../test/fakeSupabase").mockSupabase }));
jest.mock("expo-linking", () => ({
  createURL: (p: string) => `lately://${p}`,
  getInitialURL: async () => null,
  addEventListener: () => ({ remove() {} }),
}));
jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: () => {},
  openAuthSessionAsync: jest.fn(async () => ({ type: "success", url: "lately://auth-callback?code=google-code" })),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider mode="live" storage={createMemoryStore()}>
      {children}
    </AuthProvider>
  );
}

beforeEach(() => {
  resetMockSupabase();
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: true } }) })) as unknown as typeof fetch;
});

test("a ?code= redirect is exchanged for a session (PKCE)", async () => {
  await sessionFromRedirect(mockSupabase as never, "lately://auth-callback?code=abc123");
  expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
});

test("raw tokens in a redirect are not trusted (PKCE never sends them)", async () => {
  await sessionFromRedirect(mockSupabase as never, "lately://auth-callback#access_token=x&refresh_token=y");
  expect(mockSupabase.auth.setSession).not.toHaveBeenCalled();
});

test("a PKCE code that fails is an invalid_code error", async () => {
  mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({
    data: { session: null },
    error: { name: "AuthApiError", message: "invalid flow state, no valid flow state found", status: 400 },
  });
  await expect(sessionFromRedirect(mockSupabase as never, "lately://auth-callback?code=bad")).rejects.toMatchObject({
    reason: "invalid_code",
  });
});

test("Google sign-in finishes through the PKCE code exchange", async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.status).toBe("signed-out"));
  await act(() => result.current.signInWithGoogle());
  expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("google-code");
});

describe("the check before the Google window", () => {
  afterEach(() => jest.useRealTimers());

  test("gives up after 5 s on a slow network and lets the window open", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const result = providerEnabled("google");
    let settled: boolean | null | undefined;
    void result.then((v) => (settled = v));
    await act(async () => {
      jest.advanceTimersByTime(PROVIDER_CHECK_MS - 1);
    });
    expect(settled).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(settled).toBeNull();
    // The request itself is called off too.
    expect(signal?.aborted).toBe(true);
  });

  test("a provider switched off is still reported in time", async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ external: { google: false } }) })) as unknown as typeof fetch;
    await expect(providerEnabled("google")).resolves.toBe(false);
  });

  test("Google sign-in goes on to the window when the check hangs", async () => {
    globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    jest.useFakeTimers();
    let done = false;
    void result.current.signInWithGoogle().then(() => (done = true));
    await act(async () => {
      jest.advanceTimersByTime(PROVIDER_CHECK_MS);
    });
    jest.useRealTimers();
    await waitFor(() => expect(done).toBe(true));
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("google-code");
  });
});

test("the email 6-digit code still verifies with verifyOtp", async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.status).toBe("signed-out"));
  await act(() => result.current.verifyCode("a@b.co", "123456"));
  expect(mockSupabase.auth.verifyOtp).toHaveBeenCalledWith({ email: "a@b.co", token: "123456", type: "email" });
});

test("token auto-refresh runs only while the app is in the foreground", async () => {
  const addListener = AppState.addEventListener as unknown as jest.Mock;
  const before = addListener.mock.calls.length;
  await renderHook(() => useAuth(), { wrapper: Wrapper });
  const listeners = addListener.mock.calls
    .slice(before)
    .filter(([type]) => type === "change")
    .map(([, fn]) => fn as (s: string) => void);
  await act(async () => listeners.forEach((fn) => fn("background")));
  expect(mockSupabase.auth.stopAutoRefresh).toHaveBeenCalled();
  await act(async () => listeners.forEach((fn) => fn("active")));
  expect(mockSupabase.auth.startAutoRefresh).toHaveBeenCalled();
});

const RETRYABLE = { name: "AuthRetryableFetchError", message: "Network request failed", status: 0 };

async function signedIn() {
  mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: SESSION }, error: null });
  const hook = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(hook.result.current.status).toBe("signed-in"));
  return hook;
}

test("a token refresh that fails on the network is NETWORK and keeps the session", async () => {
  const { result } = await signedIn();
  mockSupabase.auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: RETRYABLE });
  await expect(result.current.refreshAccessToken()).rejects.toMatchObject({ code: "NETWORK" });
  expect(await result.current.getAccessToken()).toBe("access-1");
  expect(result.current.status).toBe("signed-in");
});

test("a refresh the server refuses gives no token (the caller then signs out)", async () => {
  const { result } = await signedIn();
  mockSupabase.auth.refreshSession.mockResolvedValueOnce({
    data: { session: null },
    error: { name: "AuthApiError", message: "Invalid Refresh Token: Refresh Token Not Found", status: 400 },
  });
  await expect(result.current.refreshAccessToken()).resolves.toBeNull();
});

test("a successful refresh replaces the token", async () => {
  const { result } = await signedIn();
  mockSupabase.auth.refreshSession.mockResolvedValueOnce({
    data: { session: { ...SESSION, access_token: "access-2" } },
    error: null,
  });
  await expect(result.current.refreshAccessToken()).resolves.toBe("access-2");
  expect(await result.current.getAccessToken()).toBe("access-2");
});

test("sign-out is local to this device and checks the result", async () => {
  const { result } = await signedIn();
  await act(() => result.current.signOut());
  expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(result.current.status).toBe("signed-out");
});

describe("cold start offline with an expired access token", () => {
  function offlineStart() {
    const store = createMemoryStore({ "sb-test-auth-token": JSON.stringify(SESSION) });
    mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: RETRYABLE });
    const OfflineWrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider mode="live" storage={store}>
        {children}
      </AuthProvider>
    );
    return renderHook(() => useAuth(), { wrapper: OfflineWrapper });
  }

  test("keeps the stored session and reports offline instead of signing out", async () => {
    const { result } = await offlineStart();
    await waitFor(() => expect(result.current.status).toBe("signed-in"));
    expect(result.current.offline).toBe(true);
    expect(result.current.user?.email).toBe("a@b.co");
    expect(await result.current.getAccessToken()).toBe("access-1");
  });

  test("the empty initial-session event that follows does not sign out", async () => {
    const { result } = await offlineStart();
    await waitFor(() => expect(result.current.status).toBe("signed-in"));
    await act(async () => emitAuthEvent("INITIAL_SESSION", null));
    expect(result.current.status).toBe("signed-in");
  });

  test("a later refresh clears the offline state", async () => {
    const { result } = await offlineStart();
    await waitFor(() => expect(result.current.offline).toBe(true));
    await act(async () => emitAuthEvent("TOKEN_REFRESHED", { ...SESSION, access_token: "access-2" }));
    expect(result.current.offline).toBe(false);
    expect(await result.current.getAccessToken()).toBe("access-2");
  });

  test("a refused session at start still signs out", async () => {
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { name: "AuthApiError", message: "Invalid Refresh Token", status: 400 },
    });
    const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.offline).toBe(false);
  });
});

test("a stored session signs in on start", async () => {
  mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: SESSION }, error: null });
  const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.status).toBe("signed-in"));
  expect(await result.current.getAccessToken()).toBe("access-1");
});
