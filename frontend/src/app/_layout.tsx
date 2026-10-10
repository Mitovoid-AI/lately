import "../../global.css";

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
import { Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createDemoApi } from "../api/demo";
import { createHttpApi } from "../api/http";
import { ApiProvider, createApi } from "../api/index";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { ToastProvider } from "../components/Toast";
import { Button } from "../components/Button";
import { config } from "../config";
import { createAppQueryClient } from "../lib/queryClient";
import { colors } from "../theme/tokens";
import { ShareRouter } from "../share/ShareRouter";
import { SaveQueueProvider } from "../hooks/useSaveQueue";

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
        http: createHttpApi({ baseUrl: config.apiUrl, getToken: getAccessToken, refreshToken: refreshAccessToken }),
      }),
    [demo, getAccessToken, refreshAccessToken],
  );
  useEffect(() => {
    if (auth.status === "signed-out") client.clear();
  }, [auth.status, client]);

  return (
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        <ToastProvider>
          <SaveQueueProvider>{children}</SaveQueueProvider>
        </ToastProvider>
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
  // Navigation keeps the platform's own transitions (and the iOS back swipe); with Reduce
  // Motion every push becomes a cross-fade.
  const reduced = useReducedMotion();
  if (status === "loading") return <View className="flex-1 bg-canvas" />;
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
        <Stack.Screen name="search" options={{ animation: "fade", animationDuration: 220 }} />
        <Stack.Screen name="account" />
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
    <View style={styles.root} className="items-center justify-center px-6">
      <Text className="text-center font-display text-display-md text-ink">Something went wrong</Text>
      <Text className="mt-2 text-center font-sans text-body text-ink-2">Lately hit a snag showing this screen.</Text>
      <Button title="Try again" onPress={() => void retry()} className="mt-6 w-full max-w-[320px]" />
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
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
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {/* Android only: iOS would need a share extension (disabled in the config plugin). */}
        <ShareIntentProvider options={{ disabled: Platform.OS !== "android", resetOnBackground: true }}>
          <AuthProvider>
            <AppProviders>
              <ShareIntake>
                <RootStack />
              </ShareIntake>
            </AppProviders>
          </AuthProvider>
        </ShareIntentProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.canvas } });
