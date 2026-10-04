import "../../global.css";

import { Inter_400Regular, Inter_400Regular_Italic, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { Lora_400Regular } from "@expo-google-fonts/lora";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from "@expo-google-fonts/newsreader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { createDemoApi } from "../api/demo";
import { createHttpApi } from "../api/http";
import { ApiProvider, createApi } from "../api/index";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { ToastProvider } from "../components/Toast";
import { config } from "../config";
import { colors } from "../theme/tokens";

function AppProviders({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { getAccessToken, refreshAccessToken } = auth;
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 2, staleTime: 30_000 }, mutations: { retry: 0 } },
      }),
  );
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
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}

function RootStack() {
  const { status } = useAuth();
  if (status === "loading") return <View className="flex-1 bg-canvas" />;
  const signedIn = status === "signed-in";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
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
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <AppProviders>
          <RootStack />
        </AppProviders>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
