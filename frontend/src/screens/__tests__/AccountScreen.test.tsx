import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { demoApi, renderWithProviders } from "../../test/render";
import { AccountScreen } from "../AccountScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
});

/** Let preference mutations finish so their cache updates happen inside the test. */
const settled = (client: QueryClient) => waitFor(() => expect(client.isMutating()).toBe(0));

async function open() {
  const api = demoApi();
  const updatePreferences = jest.spyOn(api, "updatePreferences");
  const requestExport = jest.spyOn(api, "requestExport");
  const view = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  return { ...view, updatePreferences, requestExport };
}

test("shows the profile from the API", async () => {
  await open();
  expect(screen.getByText("@aanya · aanya.sharma@example.com")).toBeTruthy();
  expect(screen.getByText("13 Saved Reels")).toBeTruthy();
  expect(screen.getByText("6 Collections")).toBeTruthy();
  expect(screen.getByText("Vault Member (Oct 2023)")).toBeTruthy();
  expect(screen.getByText("Instagram (@aanya.archive)")).toBeTruthy();
});

test("reading font and text size are saved", async () => {
  const { updatePreferences, client } = await open();
  await fireEvent.press(screen.getByText("Lora"));
  expect(updatePreferences).toHaveBeenCalledWith({ reading_font: "lora" });
  expect(screen.getByText("Default (16px)")).toBeTruthy();
  await fireEvent.press(screen.getByText("20px"));
  expect(updatePreferences).toHaveBeenCalledWith({ text_size: 20 });
  expect(await screen.findByText("Extra large (20px)")).toBeTruthy();
  await settled(client);
});

test("dark theme says it is coming", async () => {
  const { client } = await open();
  await fireEvent.press(screen.getByText("Dark"));
  expect(await screen.findByText("Dark theme is coming soon — Lately stays light for now.")).toBeTruthy();
  await settled(client);
});

test("download archive asks for an export", async () => {
  const { requestExport } = await open();
  await fireEvent.press(screen.getByText("Download Vault Archive"));
  await waitFor(() => expect(requestExport).toHaveBeenCalled());
  expect(await screen.findByText("We'll email your archive when it's ready")).toBeTruthy();
});

test("digests can be turned off", async () => {
  const { updatePreferences, client } = await open();
  await fireEvent.press(screen.getByText("Push Digests"));
  expect(updatePreferences).toHaveBeenCalledWith({ push_digests: false });
  await settled(client);
});

test("log out and back", async () => {
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Log Out of Lately"));
  expect(auth.signOut).toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

test("back with no history goes to the Library", async () => {
  mockCanGoBack = false;
  await open();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
});

test("deleting the account asks twice, deletes, then signs out", async () => {
  const api = demoApi();
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  const { auth } = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  await fireEvent.press(screen.getByText("Delete account"));
  expect(screen.getByText("Delete your account?")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("This can't be undone")).toBeTruthy();
  expect(deleteAccount).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
});

test("a failed account deletion keeps you signed in and says so", async () => {
  const api = { ...demoApi(), deleteAccount: jest.fn(async () => Promise.reject(new Error("down"))) };
  const { auth } = await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  expect(await screen.findByText("Couldn't delete your account. Try again.")).toBeTruthy();
  expect(auth.signOut).not.toHaveBeenCalled();
});

test("cancelling the first step deletes nothing", async () => {
  const api = demoApi();
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(deleteAccount).not.toHaveBeenCalled();
});
