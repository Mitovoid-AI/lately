import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { LatelyApi } from "../api/contract";
import { createDemoApi } from "../api/demo";
import { ApiProvider } from "../api/index";
import { AuthContext, type AuthValue } from "../auth/AuthProvider";
import { ToastProvider } from "../components/Toast";
import { NOW } from "./fixtures";
import { createMemoryStore } from "./memoryStore";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

export function demoApi(now = () => NOW): LatelyApi {
  return createDemoApi({ now, storage: createMemoryStore() });
}

export function fakeAuth(overrides: Partial<AuthValue> = {}): AuthValue {
  return {
    status: "signed-in",
    mode: "demo",
    user: { id: "demo-user", email: "aanya.sharma@example.com", name: "Aanya Sharma", avatarUrl: null },
    signInDemo: jest.fn(async () => {}),
    signInWithEmail: jest.fn(async () => {}),
    verifyCode: jest.fn(async () => {}),
    signInWithGoogle: jest.fn(async () => {}),
    signOut: jest.fn(async () => {}),
    getAccessToken: jest.fn(async () => null),
    refreshAccessToken: jest.fn(async () => null),
    ...overrides,
  };
}

/** Renders a screen with every provider the app root sets up. */
export async function renderWithProviders(
  ui: ReactElement,
  o: { api?: LatelyApi; auth?: Partial<AuthValue> } = {},
) {
  // gcTime Infinity: no garbage-collection timers left running after a test.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const api = o.api ?? demoApi();
  const auth = fakeAuth(o.auth);
  const view = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>
          <AuthContext.Provider value={auth}>
            <ToastProvider>{ui}</ToastProvider>
          </AuthContext.Provider>
        </ApiProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  return { ...view, api, auth, client };
}
