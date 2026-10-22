import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, type AuthFailure } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/motion/Reveal";
import { useTheme } from "../theme/ThemeProvider";

const MESSAGES: Record<AuthFailure, string> = {
  cancelled: "Sign-in was canceled.",
  provider_disabled: "Google sign-in isn't available right now. Use email instead.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  invalid_code: "This sign-in link has expired or was already used. Ask for a new one.",
  network: "Couldn't reach the sign-in service. Check your connection.",
  failed: "That sign-in didn't work. Try again.",
};

/**
 * Where email links and Google sign-in land (/auth-callback). The AuthProvider turns the
 * URL into a session; this screen waits for it, then hands over to the app.
 */
export function AuthCallbackScreen() {
  const { colors } = useTheme();
  const { status, linkError } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  if (status === "signed-in") return <Redirect href="/" />;

  const failed = linkError ?? (slow && status === "signed-out" ? "failed" : null);
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-6" style={{ paddingTop: insets.top }}>
      {failed ? (
        <Reveal style={{ width: "100%", maxWidth: 360, alignItems: "center" }}>
          <View className="h-16 w-16 items-center justify-center rounded-full bg-raised">
            <Icon name="link-off" size={30} color={colors.ink2} />
          </View>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="mt-5 text-center font-display text-display-md text-ink">
            {"Couldn't sign you in"}
          </Text>
          <Text className="mt-2 text-center font-sans text-body text-ink-2">{MESSAGES[failed]}</Text>
          <Button title="Back to sign in" onPress={() => router.replace("/sign-in")} className="mt-6 w-full" />
        </Reveal>
      ) : (
        <>
          <ActivityIndicator color={colors.ink2} accessibilityLabel="Signing you in" />
          <Text className="mt-3 font-sans text-body text-ink-2">Signing you in…</Text>
        </>
      )}
    </View>
  );
}
