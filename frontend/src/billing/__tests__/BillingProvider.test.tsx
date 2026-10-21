import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import { Pressable, Text } from "react-native";

import { ApiError, type LatelyApi } from "../../api/contract";
import { ApiProvider } from "../../api/index";
import { AuthContext } from "../../auth/AuthProvider";
import { fakeBilling } from "../../test/fakeBilling";
import { demoApi, fakeAuth, renderWithProviders } from "../../test/render";
import { BillingProvider, chooseClient, useBilling } from "../BillingProvider";
import { createDemoBilling } from "../demo";
import { createUnavailableBilling } from "../unavailable";

function Probe() {
  const { proActive, client } = useBilling();
  return <Text>{`pro:${proActive} kind:${client.kind}`}</Text>;
}

/** Signs in as user-1, and signs out when "sign out" is pressed (or the other way round with `startSignedIn` off). */
function Harness({ client, startSignedIn = true }: { client: ReturnType<typeof fakeBilling>["client"]; startSignedIn?: boolean }) {
  const [user, setUser] = useState<string | null>(startSignedIn ? "user-1" : null);
  const auth = fakeAuth(
    user
      ? { status: "signed-in", user: { id: user, email: "a@b.c", name: "A", avatarUrl: null } }
      : { status: "signed-out", user: null },
  );
  return (
    <AuthContext.Provider value={auth}>
      <BillingProvider client={client}>
        <Probe />
        <Pressable accessibilityRole="button" onPress={() => setUser(null)}>
          <Text>sign out</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setUser("user-2")}>
          <Text>sign in as user-2</Text>
        </Pressable>
      </BillingProvider>
    </AuthContext.Provider>
  );
}

async function renderHarness(o: { api?: LatelyApi; startSignedIn?: boolean; client?: ReturnType<typeof fakeBilling> } = {}) {
  const api = o.api ?? demoApi();
  const fake = o.client ?? fakeBilling();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  await render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider api={api}>
        <Harness client={fake.client} startSignedIn={o.startSignedIn} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { api, fake, invalidate };
}

describe("signing in and out", () => {
  test("the store is told who signed in", async () => {
    const { fake } = await renderHarness();
    await waitFor(() => expect(fake.client.identify).toHaveBeenCalledWith("user-1"));
    expect(fake.client.reset).not.toHaveBeenCalled();
  });

  test("signed out: nothing to identify, the store is reset", async () => {
    const { fake } = await renderHarness({ startSignedIn: false });
    await waitFor(() => expect(fake.client.reset).toHaveBeenCalled());
    expect(fake.client.identify).not.toHaveBeenCalled();
  });

  test("signing out resets the store, and the next user is identified fresh", async () => {
    const { fake } = await renderHarness();
    await waitFor(() => expect(fake.client.identify).toHaveBeenCalledWith("user-1"));
    await fireEvent.press(screen.getByText("sign out"));
    await waitFor(() => expect(fake.client.reset).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText("sign in as user-2"));
    await waitFor(() => expect(fake.client.identify).toHaveBeenCalledWith("user-2"));
  });

  test("proActive starts from what the store says about this user", async () => {
    const fake = fakeBilling({ isProActive: jest.fn(async () => true) });
    await renderHarness({ client: fake });
    expect(await screen.findByText("pro:true kind:store")).toBeTruthy();
    // Signed out, it is off again whatever the store last said.
    await fireEvent.press(screen.getByText("sign out"));
    expect(await screen.findByText("pro:false kind:store")).toBeTruthy();
    await fireEvent.press(screen.getByText("sign in as user-2"));
    expect(await screen.findByText("pro:true kind:store")).toBeTruthy();
  });

  test("a store that fails to identify leaves the app running", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeBilling({ identify: jest.fn(async () => Promise.reject(new Error("no key"))) });
    await renderHarness({ client: fake });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(screen.getByText("pro:false kind:store")).toBeTruthy();
    warn.mockRestore();
  });
});

describe("store changes", () => {
  test("Pro turning on tells the server and refreshes the account", async () => {
    const { api, fake, invalidate } = await renderHarness();
    const syncPlan = jest.spyOn(api, "syncPlan");
    await waitFor(() => expect(fake.listeners.size).toBe(1));
    await act(async () => fake.emit(true));
    expect(await screen.findByText("pro:true kind:store")).toBeTruthy();
    await waitFor(() => expect(syncPlan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"] }));
  });

  test("changes that arrive while a sync is running share it", async () => {
    const { api, fake } = await renderHarness();
    let release: () => void = () => {};
    const syncPlan = jest.spyOn(api, "syncPlan").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ plan: "pro", plan_expires_at: null });
        }),
    );
    await waitFor(() => expect(fake.listeners.size).toBe(1));
    await act(async () => {
      fake.emit(true);
      fake.emit(true);
    });
    expect(syncPlan).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await act(async () => fake.emit(true));
    await waitFor(() => expect(syncPlan).toHaveBeenCalledTimes(2));
  });

  test("Pro turning off only refreshes the account (the server heard it from the store itself)", async () => {
    const { api, fake, invalidate } = await renderHarness();
    const syncPlan = jest.spyOn(api, "syncPlan");
    await waitFor(() => expect(fake.listeners.size).toBe(1));
    await act(async () => fake.emit(false));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"] }));
    expect(syncPlan).not.toHaveBeenCalled();
  });

  test("syncPlan() resolves to the server's answer, or null when it fails, and never throws", async () => {
    const api = demoApi();
    jest
      .spyOn(api, "syncPlan")
      .mockResolvedValueOnce({ plan: "pro", plan_expires_at: "2027-01-01T00:00:00Z" })
      .mockRejectedValueOnce(new ApiError("BILLING_UNAVAILABLE", 502));
    function SyncButton() {
      const { syncPlan } = useBilling();
      const [out, setOut] = useState("none yet");
      return (
        <>
          <Pressable accessibilityRole="button" onPress={async () => setOut(JSON.stringify(await syncPlan()))}>
            <Text>sync</Text>
          </Pressable>
          <Text>{`answer: ${out}`}</Text>
        </>
      );
    }
    await renderWithProviders(<SyncButton />, { api, billing: fakeBilling().client });
    await fireEvent.press(screen.getByText("sync"));
    expect(await screen.findByText('answer: {"plan":"pro","plan_expires_at":"2027-01-01T00:00:00Z"}')).toBeTruthy();
    await fireEvent.press(screen.getByText("sync"));
    expect(await screen.findByText("answer: null")).toBeTruthy();
  });

  test("useBilling outside the provider says so", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(render(<Probe />)).rejects.toThrow(/BillingProvider/);
    error.mockRestore();
  });
});

describe("which client the app uses", () => {
  const api = demoApi();

  test("demo mode uses the demo store, which needs the demo API", () => {
    expect(chooseClient({ mode: "demo", demo: api }).kind).toBe("demo");
    expect(chooseClient({ mode: "demo", demo: null }).kind).toBe("unavailable");
  });

  test("live mode uses Google Play on a real Android app with the public key", () => {
    expect(chooseClient({ mode: "live", platform: "android", androidKey: "goog_abc", expoGo: false, nativeModule: true }).kind).toBe("store");
    expect(chooseClient({ mode: "live", platform: "android", androidKey: "test_abc", expoGo: false, nativeModule: true }).kind).toBe("store");
  });

  test("everything else is the store-less stand-in", () => {
    const cases: Parameters<typeof chooseClient>[0][] = [
      { mode: "live", platform: "android", androidKey: "", expoGo: false }, // no key in this build
      { mode: "live", platform: "android", androidKey: "sk_secret", expoGo: false }, // a secret key pasted by mistake
      { mode: "live", platform: "android", androidKey: "appl_abc", expoGo: false }, // the iOS key
      { mode: "live", platform: "android", androidKey: "goog_abc", expoGo: true }, // Expo Go has no native module
      { mode: "live", platform: "web", androidKey: "goog_abc", expoGo: false },
      { mode: "live", platform: "ios", androidKey: "goog_abc", expoGo: false }, // iOS comes later
      // An older dev build, made before react-native-purchases was added: the key is there, the native module isn't.
      { mode: "live", platform: "android", androidKey: "goog_abc", expoGo: false, nativeModule: false },
    ];
    for (const c of cases) expect(chooseClient(c).kind).toBe("unavailable");
  });

  test("the native module is looked up in this build when the caller doesn't say", () => {
    // Under Jest there is no RNPurchases module, so a keyed Android build still can't sell.
    expect(chooseClient({ mode: "live", platform: "android", androidKey: "goog_abc", expoGo: false }).kind).toBe("unavailable");
  });

  test("without a key in the environment, a live app can't sell anything", () => {
    expect(chooseClient({ mode: "live", platform: "android", expoGo: false }).kind).toBe("unavailable");
  });
});

describe("the stand-in stores", () => {
  test("the demo store 'buys' Pro in the demo API and tells listeners", async () => {
    const api = demoApi();
    const billing = createDemoBilling(api, { delayMs: 0, now: () => Date.parse("2026-10-04T12:00:00Z") });
    const seen: boolean[] = [];
    billing.onChange((active) => seen.push(active));
    expect(await billing.isProActive()).toBe(false);
    expect(await billing.restore()).toBe(false);
    expect(await billing.purchase("yearly")).toBe("purchased");
    expect(seen).toEqual([true]);
    expect(await billing.isProActive()).toBe(true);
    expect(await billing.restore()).toBe(true);
    const me = await api.getMe();
    expect(me.plan).toBe("pro");
    expect(me.plan_expires_at).toBe("2027-10-04T12:00:00.000Z");
    expect(await api.syncPlan()).toEqual({ plan: "pro", plan_expires_at: "2027-10-04T12:00:00.000Z" });
    expect(await billing.managementUrl()).toBeNull();
  });

  test("a lifetime grant isn't a store subscription: nothing for the store to report or restore", async () => {
    const api = demoApi();
    api.setPlan("lifetime");
    const billing = createDemoBilling(api, { delayMs: 0 });
    expect(await billing.isProActive()).toBe(false);
    expect(await billing.restore()).toBe(false);
  });

  test("a demo purchase takes a moment, like the real sheet", async () => {
    jest.useFakeTimers();
    try {
      const api = demoApi();
      const billing = createDemoBilling(api);
      const done = jest.fn();
      void billing.purchase("monthly").then(done);
      await jest.advanceTimersByTimeAsync(500);
      expect(done).not.toHaveBeenCalled();
      expect(api.currentPlan()).toBe("free");
      await jest.advanceTimersByTimeAsync(200);
      expect(done).toHaveBeenCalledWith("purchased");
      expect(api.currentPlan()).toBe("pro");
    } finally {
      jest.useRealTimers();
    }
  });

  test("the demo store lets listeners go", async () => {
    const billing = createDemoBilling(demoApi(), { delayMs: 0 });
    const seen: boolean[] = [];
    const off = billing.onChange((a) => seen.push(a));
    off();
    await billing.purchase("monthly");
    expect(seen).toEqual([]);
  });

  test("the unavailable store shows plans but sells nothing", async () => {
    const billing = createUnavailableBilling();
    expect(billing.kind).toBe("unavailable");
    expect((await billing.getPlans()).map((p) => p.price)).toEqual(["$29.99", "$3.99"]);
    await expect(billing.purchase("yearly")).rejects.toThrow("Purchases aren't available in this build.");
    expect(await billing.restore()).toBe(false);
    expect(await billing.isProActive()).toBe(false);
    expect(await billing.managementUrl()).toBeNull();
    await expect(billing.identify("u")).resolves.toBeUndefined();
    await expect(billing.reset()).resolves.toBeUndefined();
    expect(billing.onChange(() => {})).toEqual(expect.any(Function));
  });
});
