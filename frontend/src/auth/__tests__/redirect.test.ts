import { AuthFlowError, failureFrom } from "../AuthProvider";
import { authErrorMessage } from "../messages";
import { authParamsFromUrl, isAuthRedirect } from "../redirect";

test("implicit-flow tokens come from the fragment of an Expo Go link", () => {
  const url =
    "exp://10.0.0.5:8081/--/auth-callback#access_token=abc.def&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink";
  const p = authParamsFromUrl(url);
  expect(p.access_token).toBe("abc.def");
  expect(p.refresh_token).toBe("r1");
  expect(p.type).toBe("magiclink");
  expect(isAuthRedirect(url)).toBe(true);
});

test("a PKCE code and an email token hash come from the query", () => {
  expect(authParamsFromUrl("lately://auth-callback?code=xyz").code).toBe("xyz");
  const p = authParamsFromUrl("lately://auth-callback?token_hash=th%201&type=signup");
  expect(p.token_hash).toBe("th 1");
  expect(p.type).toBe("signup");
});

test("Supabase errors in the redirect are read, plain deep links are not sign-ins", () => {
  const url = "exp://x/--/auth-callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
  const p = authParamsFromUrl(url);
  expect(p.error_code).toBe("otp_expired");
  expect(p.error_description).toBe("Email link is invalid or has expired");
  expect(isAuthRedirect(url)).toBe(true);
  expect(isAuthRedirect("lately://reel/123")).toBe(false);
});

test("Supabase Auth errors map to what the screens say", () => {
  expect(failureFrom({ name: "AuthApiError", message: "email rate limit exceeded", status: 429 } as Error)).toBe("rate_limited");
  expect(failureFrom(new Error("Unsupported provider: provider is not enabled"))).toBe("provider_disabled");
  expect(failureFrom(new Error("Token has expired or is invalid"))).toBe("invalid_code");

  expect(authErrorMessage(new AuthFlowError("cancelled"), "google")).toBe("");
  expect(authErrorMessage(new AuthFlowError("provider_disabled"), "google")).toBe("Google sign-in isn't available right now. Use email instead.");
  expect(authErrorMessage(new AuthFlowError("rate_limited"), "email")).toBe("Too many emails just now. Wait a minute, then try again.");
  expect(authErrorMessage(new AuthFlowError("invalid_code"), "code")).toBe("That code has expired or isn't right. Try again or resend.");
  expect(authErrorMessage(new Error("boom"), "email")).toBe("Couldn't send the link. Try again.");
});

test("a Google window that never came back explains the fix in development builds only", () => {
  const closed = new AuthFlowError("cancelled", undefined, "exp://192.168.1.5:8081/--/auth-callback");
  expect(authErrorMessage(closed, "google", true)).toBe(
    "Didn't come back from Google? Add exp://192.168.1.5:8081/--/auth-callback to Supabase → Authentication → URL Configuration → Redirect URLs.",
  );
  expect(authErrorMessage(closed, "google", false)).toBe("");
  expect(authErrorMessage(new AuthFlowError("cancelled"), "google", true)).toBe("");
});
