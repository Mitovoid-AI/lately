import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { AuthContext, type AuthValue } from "../../auth/AuthProvider";
import type { KeyValueStore } from "../../lib/storage";
import { createMemoryStore } from "../../test/memoryStore";
import { fakeAuth } from "../../test/render";
import { PENDING_SHARE_KEY, ShareRouter, usePendingShare } from "../ShareRouter";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockNavKey: string | undefined = "root";
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useRootNavigationState: () => (mockNavKey ? { key: mockNavKey } : undefined),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNavKey = "root";
});

const LINK = "Check this out https://www.instagram.com/reel/ABC123/?igsh=x";

function Hint() {
  const pending = usePendingShare();
  return <Text>{pending ? `pending: ${pending}` : "no share"}</Text>;
}

function tree(auth: AuthValue, incoming: string | null, store: KeyValueStore, onConsumed = jest.fn()) {
  return (
    <AuthContext.Provider value={auth}>
      <ShareRouter incoming={incoming} onConsumed={onConsumed} store={store}>
        <Hint />
      </ShareRouter>
    </AuthContext.Provider>
  );
}

test("a share while signed in opens the save sheet with the shared text", async () => {
  const onConsumed = jest.fn();
  const store = createMemoryStore();
  await render(tree(fakeAuth(), LINK, store, onConsumed));
  await waitFor(() =>
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/save-sheet", params: { text: LINK } }),
  );
  expect(onConsumed).toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledTimes(1);
  await waitFor(async () => expect(await store.getItem(PENDING_SHARE_KEY)).toBeFalsy());
});

test("a share while signed out waits for sign-in, then continues the save", async () => {
  const store = createMemoryStore();
  const view = await render(tree(fakeAuth({ status: "signed-out" }), LINK, store));
  expect(await screen.findByText(`pending: ${LINK}`)).toBeTruthy();
  expect(mockRouter.push).not.toHaveBeenCalled();
  // It survives a restart (the OAuth round trip can relaunch the app).
  expect(await store.getItem(PENDING_SHARE_KEY)).toBe(LINK);

  await view.rerender(tree(fakeAuth({ status: "signed-in" }), null, store));
  await waitFor(() =>
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/save-sheet", params: { text: LINK } }),
  );
  expect(await screen.findByText("no share")).toBeTruthy();
});

test("a share saved before a restart is picked up after sign-in", async () => {
  const store = createMemoryStore({ [PENDING_SHARE_KEY]: LINK });
  await render(tree(fakeAuth(), null, store));
  await waitFor(() =>
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/save-sheet", params: { text: LINK } }),
  );
});

test("nothing navigates until the root navigator is mounted", async () => {
  mockNavKey = undefined;
  const store = createMemoryStore();
  const view = await render(tree(fakeAuth(), LINK, store));
  expect(await screen.findByText(`pending: ${LINK}`)).toBeTruthy();
  expect(mockRouter.push).not.toHaveBeenCalled();
  mockNavKey = "root";
  await view.rerender(tree(fakeAuth(), null, store));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
});

test("blank shares are ignored", async () => {
  const onConsumed = jest.fn();
  await render(tree(fakeAuth(), "   ", createMemoryStore(), onConsumed));
  expect(await screen.findByText("no share")).toBeTruthy();
  expect(mockRouter.push).not.toHaveBeenCalled();
});
