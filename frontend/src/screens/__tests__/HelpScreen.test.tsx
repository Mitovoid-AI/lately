import { fireEvent, screen } from "@testing-library/react-native";

import type { InstagramLink } from "../../api/contract";
import { demoApi, renderWithProviders } from "../../test/render";
import { HelpScreen } from "../HelpScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

beforeEach(() => jest.clearAllMocks());

const link = (over: Partial<InstagramLink>): InstagramLink => ({
  enabled: true,
  handle: "lately.app",
  linked: false,
  linked_at: null,
  code: null,
  code_expires_at: null,
  ...over,
});

test("the ways to save: share to Lately, paste a link, and (when offered) send it in a message", async () => {
  await renderWithProviders(<HelpScreen />);
  expect(screen.getByText("How to save from Instagram")).toBeTruthy();
  expect(screen.getByText("In Instagram, tap Share, then Share to… (on some phones, More), then Lately.")).toBeTruthy();
  expect(screen.getByText(/tap Save \(the \+ at the bottom\) and paste it/)).toBeTruthy();
  expect(await screen.findByText("Send it in a message")).toBeTruthy();
  expect(screen.getByText(/send the reel to @lately\.app and it's saved to your library/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Connect Instagram" }));
  expect(mockRouter.push).toHaveBeenCalledWith("/instagram");
});

test("once connected, the message way needs no setup", async () => {
  await renderWithProviders(<HelpScreen />, { api: { ...demoApi(), getInstagramLink: async () => link({ linked: true }) } });
  expect(await screen.findByText("In Instagram, send the reel to @lately.app. It's saved to your library.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Connect Instagram" })).toBeNull();
});

test("not offered (or not answered): only the share and paste ways", async () => {
  const view = await renderWithProviders(<HelpScreen />, {
    api: { ...demoApi(), getInstagramLink: async () => link({ enabled: false, handle: null }) },
  });
  await screen.findByText("Paste a link");
  expect(screen.queryByText("Send it in a message")).toBeNull();
  await view.unmount();

  await renderWithProviders(<HelpScreen />, { api: { ...demoApi(), getInstagramLink: () => Promise.reject(new Error("down")) } });
  await screen.findByText("Paste a link");
  expect(screen.queryByText("Send it in a message")).toBeNull();
});
