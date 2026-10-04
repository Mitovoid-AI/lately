import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../test/render";
import { CheckEmailScreen } from "../CheckEmailScreen";
import { SignInScreen } from "../SignInScreen";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

test("shows the sign-in options and switches to sign up", async () => {
  await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out" } });
  expect(screen.getByText("Continue with Google")).toBeTruthy();
  expect(screen.getByText("Save it with a reason.\nFind it when you need it.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "Sign up" }));
  expect(screen.getByText("Sign up with Google")).toBeTruthy();
  expect(screen.getByText("Private & encrypted")).toBeTruthy();
});

test("demo mode: any provider signs in as the demo user", async () => {
  const { auth } = await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "demo" } });
  await fireEvent.press(screen.getByText("Continue with Instagram"));
  expect(auth.signInDemo).toHaveBeenCalledTimes(1);
});

test("live mode: Instagram is not available yet", async () => {
  const { auth } = await renderWithProviders(<SignInScreen />, { auth: { status: "signed-out", mode: "live" } });
  await fireEvent.press(screen.getByText("Continue with Instagram"));
  expect(screen.getByText("Instagram sign-in is coming soon")).toBeTruthy();
  expect(auth.signInDemo).not.toHaveBeenCalled();
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
