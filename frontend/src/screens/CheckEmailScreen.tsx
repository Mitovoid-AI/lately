import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { colors } from "../theme/tokens";

export function CheckEmailScreen() {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const auth = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true);
    try {
      await auth.verifyCode(email, code);
    } catch {
      toast.show("That code didn't work. Try again or resend.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await auth.signInWithEmail(email);
      toast.show("New link sent");
    } catch {
      toast.show("Couldn't send the link. Try again.");
    }
  }

  return (
    <View className="flex-1 items-center bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="w-full max-w-[440px] flex-1 px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="h-12 w-12 items-center justify-center"
        >
          <Icon name="arrow-back" color={colors.ink} />
        </Pressable>
        <View className="mt-8 items-center">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-raised">
            <Icon name="mail-outline" size={30} color={colors.accent} />
          </View>
          <Text className="mt-5 font-display text-display-lg text-ink">Check your inbox</Text>
          <Text className="mt-2 text-center font-sans text-body text-ink-2">
            {`We sent a sign-in link to ${email}. Open it on this phone, or enter the 6-digit code below.`}
          </Text>
        </View>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          placeholderTextColor={colors.ink3}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          className="mt-8 h-14 rounded-ctl border border-hairline bg-card text-center font-sans-semibold text-ink"
          style={{ fontSize: 24, letterSpacing: 8 }}
        />
        <Button title="Verify" onPress={verify} disabled={code.length !== 6} loading={busy} className="mt-4" />
        <Button title="Resend link" variant="ghost" onPress={resend} className="mt-2" />
        <Button title="Use a different email" variant="ghost" onPress={() => router.back()} />
      </View>
    </View>
  );
}
