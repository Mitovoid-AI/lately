import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { createMemoryStore } from "../../test/memoryStore";
import { AuthProvider, sessionFromRedirect, useAuth } from "../AuthProvider";
import { mockSupabase, resetMockSupabase, SESSION } from "../../test/fakeSupabase";

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

test("the email 6-digit code still verifies with verifyOtp", async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.status).toBe("signed-out"));
  await act(() => result.current.verifyCode("a@b.co", "123456"));
  expect(mockSupabase.auth.verifyOtp).toHaveBeenCalledWith({ email: "a@b.co", token: "123456", type: "email" });
});

test("a stored session signs in on start", async () => {
  mockSupabase.auth.getSession.mockResolvedValueOnce({ data: { session: SESSION }, error: null });
  const { result } = await renderHook(() => useAuth(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.status).toBe("signed-in"));
  expect(await result.current.getAccessToken()).toBe("access-1");
});
