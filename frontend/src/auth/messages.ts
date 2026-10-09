import { AuthFlowError, type AuthFailure } from "./AuthProvider";

type Step = "google" | "email" | "code";

const FALLBACK: Record<Step, string> = {
  google: "Couldn't sign in with Google. Try again.",
  email: "Couldn't send the link. Try again.",
  code: "That code didn't work. Try again or resend.",
};

/** What to tell someone when a sign-in step fails; "" means say nothing (they cancelled). */
export function authErrorMessage(error: unknown, step: Step): string {
  const reason: AuthFailure = error instanceof AuthFlowError ? error.reason : "failed";
  switch (reason) {
    case "cancelled":
      return "";
    case "provider_disabled":
      return "Google sign-in isn't switched on yet.";
    case "rate_limited":
      return step === "code" ? "Too many tries. Wait a minute, then try again." : "Too many emails just now. Wait a minute, then try again.";
    case "invalid_code":
      return step === "google" ? FALLBACK.google : "That code has expired or isn't right. Try again or resend.";
    case "network":
      return "Couldn't reach the sign-in service. Check your connection.";
    default:
      return FALLBACK[step];
  }
}
