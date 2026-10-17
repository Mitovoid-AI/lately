import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { queueKey } from "../../lib/saveQueue";
import { PENDING_SHARE_KEY } from "../../share/ShareRouter";
import { THEME_KEY } from "../../theme/preference";
import { useTheme } from "../../theme/ThemeProvider";
import { ThemeSync } from "../../theme/ThemeSync";
import { demoApi, renderWithProviders } from "../../test/render";
import { AccountScreen } from "../AccountScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
const mockShare = jest.fn(async (_name: string, _json: string) => {});
jest.mock("../../lib/exportFile", () => ({ shareExportFile: (n: string, j: string) => mockShare(n, j) }));

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

function SchemeProbe() {
  return <Text>{`scheme:${useTheme().scheme}`}</Text>;
}

test("picking Dark saves it, switches the app to Espresso and remembers it on the phone", async () => {
  const api = demoApi();
  const updatePreferences = jest.spyOn(api, "updatePreferences");
  const { client } = await renderWithProviders(
    <>
      <ThemeSync />
      <AccountScreen />
      <SchemeProbe />
    </>,
    { api },
  );
  await screen.findByText("Aanya Sharma");
  expect(screen.getByText("scheme:light")).toBeTruthy();

  await fireEvent.press(screen.getByText("Dark"));
  expect(updatePreferences).toHaveBeenCalledWith({ theme: "dark" });
  expect(await screen.findByText("scheme:dark")).toBeTruthy();
  expect(screen.queryByText(/coming soon\. Lately stays light/)).toBeNull();
  await waitFor(async () => expect(await AsyncStorage.getItem(THEME_KEY)).toBe("dark"));

  await fireEvent.press(screen.getByText("Light"));
  expect(await screen.findByText("scheme:light")).toBeTruthy();
  await settled(client);
});

test("download archive prepares a JSON export in the app, then offers Download", async () => {
  const api = demoApi();
  const requestExport = jest.spyOn(api, "requestExport");
  jest
    .spyOn(api, "downloadExport")
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValue({ status: "ready", filename: "lately-export-20261010.json", json: "{}" });
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  expect(screen.queryByText(/email your archive/i)).toBeNull();
  expect(screen.queryByText(/markdown/i)).toBeNull();
  expect(screen.getByText("Export your reels, notes and stacks as a JSON file")).toBeTruthy();
  await fireEvent.press(screen.getByText("Download Vault Archive"));
  await waitFor(() => expect(requestExport).toHaveBeenCalled());
  expect(screen.getByText("Preparing…")).toBeTruthy();
  await fireEvent.press(await screen.findByText("Download", {}, { timeout: 8000 }));
  await waitFor(() => expect(mockShare).toHaveBeenCalledWith("lately-export-20261010.json", "{}"));
});

test("the delete dialog offers the export first", async () => {
  const api = demoApi();
  const requestExport = jest.spyOn(api, "requestExport");
  const deleteAccount = jest.spyOn(api, "deleteAccount");
  await renderWithProviders(<AccountScreen />, { api });
  await screen.findByText("Aanya Sharma");
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: /Download my archive first/ }));
  await waitFor(() => expect(requestExport).toHaveBeenCalled());
  expect(deleteAccount).not.toHaveBeenCalled();
  expect(screen.queryByText("Delete your account?")).toBeNull();
});

test("no placeholder password row (Lately has no passwords)", async () => {
  await open();
  expect(screen.queryByText("Password & Security")).toBeNull();
  expect(screen.queryByText("Last changed 3 months ago")).toBeNull();
  expect(screen.queryByText("Reset")).toBeNull();
});

test("digests and offline reading are marked coming soon and can't be toggled", async () => {
  const { updatePreferences } = await open();
  expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  await fireEvent.press(screen.getByText("Push Digests"));
  await fireEvent.press(screen.getByText("Offline Reading Storage"));
  expect(updatePreferences).not.toHaveBeenCalled();
  const digests = screen.getByRole("switch", { name: "Push Digests" });
  expect(digests.props.accessibilityState).toEqual({ checked: false, disabled: true });
  expect(screen.getByRole("switch", { name: "Offline Reading Storage" })).toBeTruthy();
});

test("log out and back", async () => {
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Log Out of Lately"));
  expect(auth.signOut).toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});

async function seedDeviceData() {
  await AsyncStorage.setItem("lately.recent-searches", JSON.stringify(["momo"]));
  await AsyncStorage.setItem(queueKey("demo-user"), JSON.stringify([{ id: "q1", text: "x", queued_at: "t" }]));
  await AsyncStorage.setItem(PENDING_SHARE_KEY, "https://www.instagram.com/reel/abc/");
}

async function expectDeviceDataCleared() {
  expect(JSON.parse((await AsyncStorage.getItem("lately.recent-searches")) ?? "[]")).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(queueKey("demo-user"))) ?? "[]")).toEqual([]);
  expect((await AsyncStorage.getItem(PENDING_SHARE_KEY)) ?? "").toBe("");
}

test("logging out forgets recent searches, the offline queue and a pending share", async () => {
  await seedDeviceData();
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Log Out of Lately"));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  await expectDeviceDataCleared();
});

test("deleting the account forgets device data too", async () => {
  await seedDeviceData();
  const { auth } = await open();
  await fireEvent.press(screen.getByText("Delete account"));
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.press(screen.getByRole("button", { name: "Delete forever" }));
  await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  await expectDeviceDataCleared();
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

test("privacy policy and terms open from Account", async () => {
  await open();
  await fireEvent.press(screen.getByText("Privacy Policy"));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/privacy");
  await fireEvent.press(screen.getByText("Terms of Service"));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/terms");
});
