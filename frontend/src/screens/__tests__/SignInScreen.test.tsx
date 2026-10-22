import { fireEvent, screen } from "@testing-library/react-native";

import { PendingShareContext } from "../../share/ShareRouter";
import { renderWithProviders } from "../../test/render";
import { CheckEmailScreen } from "../CheckEmailScreen";
import { SignInScreen } from "../SignInScreen";

let mockCanGoBack = true;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockCanGoBack = true;
});

test("shows the sign-in options and switches to sign up", async () => {
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out" } });
  expect(screen.getByText("Continue with Google")).toBeTruthy();
  expect(screen.getByText("Save reels from Instagram.\nFind them again by typing what you remember.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "Sign up" }));
  expect(screen.getByText("Sign up with Google")).toBeTruthy();
  expect(screen.getByText("Private to your account")).toBeTruthy();
});

test("demo mode: any provider signs in as the demo user", async () => {
  const { auth } = await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "demo" } });
  await fireEvent.press(screen.getByText("Continue with Google"));
  expect(auth.signInDemo).toHaveBeenCalledTimes(1);
});

test("live mode: a double tap on Google opens one sign-in", async () => {
  const signInWithGoogle = jest.fn(() => new Promise<void>(() => {}));
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live", signInWithGoogle } });
  await fireEvent.press(screen.getByText("Continue with Google"));
  await fireEvent.press(screen.getByText("Continue with Google"));
  expect(signInWithGoogle).toHaveBeenCalledTimes(1);
});

test("live mode: Google can be tried again after it fails", async () => {
  const signInWithGoogle = jest.fn(async () => Promise.reject(new Error("cancelled")));
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live", signInWithGoogle } });
  await fireEvent.press(screen.getByText("Continue with Google"));
  await fireEvent.press(screen.getByText("Continue with Google"));
  expect(signInWithGoogle).toHaveBeenCalledTimes(2);
});

test("only the sign-in methods that work are offered (no Instagram or Facebook)", async () => {
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live" } });
  expect(screen.queryByText(/with Instagram/)).toBeNull();
  expect(screen.queryByText(/Facebook/)).toBeNull();
  await fireEvent.press(screen.getByRole("tab", { name: "Sign up" }));
  expect(screen.queryByText(/with Instagram/)).toBeNull();
  expect(screen.queryByText("Facebook")).toBeNull();
  expect(screen.getByText("Sign up with email")).toBeTruthy();
});

test("live mode: email sends a link and opens the code screen", async () => {
  const { auth } = await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live" } });
  await fireEvent.press(screen.getByText("Continue with email"));
  const input = screen.getByPlaceholderText("you@example.com");
  await fireEvent.changeText(input, "me@");
  expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeDisabled();
  await fireEvent.changeText(input, "me@x.com");
  await fireEvent.press(screen.getByText("Send sign-in link"));
  expect(auth.signInWithEmail).toHaveBeenCalledWith("me@x.com");
  expect(mockRouter.push).toHaveBeenCalledWith("/check-email?email=me%40x.com");
});

test("check email: Verify needs six digits", async () => {
  mockParams = { email: "me@x.com" };
  const { auth } = await renderWithProviders(<CheckEmailScreen />, { auth: { status: "signed-out", mode: "live" } });
  expect(screen.getByText(/We sent a sign-in link to me@x\.com/)).toBeTruthy();
  const verify = screen.getByRole("button", { name: "Verify" });
  expect(verify).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("000000"), "123456");
  await fireEvent.press(screen.getByText("Verify"));
  expect(auth.verifyCode).toHaveBeenCalledWith("me@x.com", "123456");
});

test("check email: back with no history returns to sign in", async () => {
  mockCanGoBack = false;
  mockParams = { email: "me@x.com" };
  await renderWithProviders(<CheckEmailScreen />, { auth: { status: "signed-out", mode: "live" } });
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith("/sign-in");
});

test("a reel shared before signing in is mentioned", async () => {
  await renderWithProviders(
    <PendingShareContext.Provider value="https://www.instagram.com/reel/ABC/">
      <SignInScreen />
    </PendingShareContext.Provider>,
    { auth: { status: "signed-out", mode: "live" } },
  );
  expect(screen.getByText("Sign in to finish saving the reel you shared.")).toBeTruthy();
});

test("no share, no mention", async () => {
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live" } });
  expect(screen.queryByText("Sign in to finish saving the reel you shared.")).toBeNull();
});

test("sign-in links to the terms and privacy policy", async () => {
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live" } });
  await fireEvent.press(screen.getByRole("link", { name: "Terms" }));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/terms");
  await fireEvent.press(screen.getByRole("link", { name: "Privacy Policy" }));
  expect(mockRouter.push).toHaveBeenCalledWith("/legal/privacy");
});
