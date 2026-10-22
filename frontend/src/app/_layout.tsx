import "../../global.css";

import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import { Inter_400Regular, Inter_400Regular_Italic, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Lora_400Regular } from "@expo-google-fonts/lora";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from "@expo-google-fonts/newsreader";
import { QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, LogBox, Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createDemoApi } from "../api/demo";
import { createHttpApi } from "../api/http";
import { ApiProvider, createApi } from "../api/index";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { BillingProvider } from "../billing/BillingProvider";
import { ToastProvider } from "../components/Toast";
import { Button } from "../components/Button";
import { OfflineBanner } from "../components/OfflineBanner";
import { config } from "../config";
import { apiBaseUrl } from "../lib/apiUrl";
import { wireAppFocus } from "../lib/appFocus";
import { createAppQueryClient } from "../lib/queryClient";
import { loadThemePreference, useThemeLoaded } from "../theme/preference";
import { ThemeProvider, useTheme } from "../theme/ThemeProvider";
import { ThemeSync } from "../theme/ThemeSync";
import { ShareRouter } from "../share/ShareRouter";
import { SaveQueueProvider } from "../hooks/useSaveQueue";

// Queries (and their polling) pause while the app is in the background.
wireAppFocus();
// The theme this phone showed last, read while the fonts load.
void loadThemePreference();
// supabase-js warns once per Google sign-in that Hermes has no WebCrypto, so the PKCE
// challenge is "plain" (which Supabase accepts). It still prints in Metro; on screen the
// warning bar covered the bottom of the email sheet and its Send button.
LogBox.ignoreLogs(["WebCrypto API is not supported"]);

/** Where the query client reports a dead session; AppProviders points it at the current sign-out. */
const sessionExpired = { handler: () => {} };

function AppProviders({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { getAccessToken, refreshAccessToken, signOut, status } = auth;
  // A request that still fails with 401 after the token refresh means the session is gone.
  useEffect(() => {
    sessionExpired.handler = () => {
      if (status === "signed-in") void signOut();
    };
  }, [signOut, status]);
  const [client] = useState(() => createAppQueryClient(() => sessionExpired.handler()));
  // The demo store lives for the whole session; the HTTP client uses the auth callbacks (stable).
  const [demo] = useState(() => createDemoApi());
  const api = useMemo(
    () =>
      createApi({
        mode: config.apiMode,
        demo,
        http: createHttpApi({ baseUrl: apiBaseUrl(), getToken: getAccessToken, refreshToken: refreshAccessToken }),
      }),
    [demo, getAccessToken, refreshAccessToken],
  );
  useEffect(() => {
    if (auth.status === "signed-out") client.clear();
  }, [auth.status, client]);

  return (
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        {status === "signed-in" ? <ThemeSync /> : null}
        <BillingProvider>
          <ToastProvider>
            <SaveQueueProvider>{children}</SaveQueueProvider>
          </ToastProvider>
        </BillingProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

/** Instagram's share sheet → Lately: hand the shared text to the share router. */
function ShareIntake({ children }: { children: ReactNode }) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const incoming = hasShareIntent ? (shareIntent.text ?? shareIntent.webUrl ?? null) : null;
  const consume = useCallback(() => resetShareIntent(), [resetShareIntent]);
  return (
    <ShareRouter incoming={incoming} onConsumed={consume}>
      {children}
    </ShareRouter>
  );
}

function RootStack() {
  const { status } = useAuth();
  const { colors } = useTheme();
  // Navigation keeps the platform's own transitions (and the iOS back swipe); with Reduce
  // Motion every push becomes a cross-fade.
  const reduced = useReducedMotion();
  // Restoring the saved session: a centered, named spinner rather than a blank screen.
  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color={colors.ink2} accessibilityLabel="Loading Lately" />
      </View>
    );
  }
  const signedIn = status === "signed-in";
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
        animation: reduced ? "fade" : "default",
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reel/[id]" />
        <Stack.Screen name="stack/[id]" />
        {/* Opens from Home's "See all"; Search is a tab now, so it has no stack entry. */}
        <Stack.Screen name="curated" />
        <Stack.Screen name="account" />
        {/* Lately Pro: slides up over whatever sent you here (the save sheet, Account, Home). */}
        <Stack.Screen name="pro" options={{ presentation: "modal", animation: reduced ? "fade" : "slide_from_bottom" }} />
        <Stack.Screen
          name="save-sheet"
          options={{ presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Privacy Policy and Terms are readable before and after sign-in. */}
      <Stack.Screen name="legal/[doc]" />
      {/* Email links and Google sign-in land here whether or not a session exists yet. */}
      <Stack.Screen name="auth-callback" options={{ animation: "fade" }} />
    </Stack>
  );
}

/** Last-resort screen when a route throws while rendering (expo-router picks this export up). */
export function ErrorBoundary({ retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <ThemeProvider>
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center font-display text-display-md text-ink">Something went wrong</Text>
        <Text className="mt-2 text-center font-sans text-body text-ink-2">Lately hit a snag showing this screen.</Text>
        <Button title="Try again" onPress={() => void retry()} className="mt-6 w-full max-w-[320px]" />
      </View>
    </ThemeProvider>
  );
}

/** The app's outer frame in the active theme: root background and status bar icons. */
function ThemedRoot({ children }: { children: ReactNode }) {
  const { colors, scheme } = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {children}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    // Display face: screen, sheet and card titles. Newsreader stays the default reading font.
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Inter_400Regular,
    Inter_400Regular_Italic,
    Inter_500Medium,
    Inter_600SemiBold,
    Lora_400Regular,
  });
  const themeLoaded = useThemeLoaded();
  if (!loaded || !themeLoaded) return null;
  return (
    <ThemeProvider>
      <ThemedRoot>
        {/* Android only: iOS would need a share extension (disabled in the config plugin). */}
        <ShareIntentProvider options={{ disabled: Platform.OS !== "android", resetOnBackground: true }}>
          <AuthProvider>
            <AppProviders>
              <ShareIntake>
                <RootStack />
                <OfflineBanner />
              </ShareIntake>
            </AppProviders>
          </AuthProvider>
        </ShareIntentProvider>
      </ThemedRoot>
    </ThemeProvider>
  );
}
