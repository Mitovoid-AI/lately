import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { authErrorMessage } from "../auth/messages";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PopIn, Reveal } from "../components/motion/Reveal";
import { useShake } from "../components/motion/feedback";
import { TextField } from "../components/TextField";
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
  const shake = useShake();

  async function verify() {
    setBusy(true);
    try {
      await auth.verifyCode(email, code);
    } catch (e) {
      shake.shake();
      toast.show(authErrorMessage(e, "code"));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await auth.signInWithEmail(email);
      toast.show("New code sent");
    } catch (e) {
      toast.show(authErrorMessage(e, "email"));
    }
  }

  return (
    <View className="flex-1 items-center bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="w-full max-w-[440px] flex-1 px-4">
        <IconButton icon="arrow-back" size={22} color={colors.ink} label="Back" onPress={() => router.back()} />
        <View className="mt-8 items-center">
          <PopIn>
            <View className="h-16 w-16 items-center justify-center rounded-full bg-raised">
              <Icon name="mail-outline" size={30} color={colors.accent} />
            </View>
          </PopIn>
          <Reveal index={2} style={{ alignItems: "center" }}>
            <Text className="mt-5 font-display text-display-lg text-ink">Check your inbox</Text>
            <Text className="mt-2 text-center font-sans text-body text-ink-2">
              {`We sent a sign-in link to ${email}. Open it on this phone, or enter the 6-digit code below.`}
            </Text>
          </Reveal>
        </View>
        <Reveal index={4}>
          <Animated.View style={shake.style}>
            <TextField
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              size="lg"
              tone="card"
              inputClassName="text-center font-sans-semibold"
              inputStyle={{ fontSize: 24, letterSpacing: 8 }}
              className="mt-8"
            />
          </Animated.View>
          <Button title="Verify" onPress={verify} disabled={code.length !== 6} loading={busy} className="mt-4" />
          <Button title="Resend link" variant="ghost" onPress={resend} className="mt-2" />
          <Button title="Use a different email" variant="ghost" onPress={() => router.back()} />
        </Reveal>
      </View>
    </View>
  );
}
