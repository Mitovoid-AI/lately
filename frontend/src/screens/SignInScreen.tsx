import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { authErrorMessage } from "../auth/messages";
import { Button } from "../components/Button";
import { ExamplePair } from "../components/ExamplePair";
import { LOGO } from "../components/Header";
import { Icon } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { Sheet } from "../components/Sheet";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import { useTheme } from "../theme/ThemeProvider";
import { usePendingShare } from "../share/ShareRouter";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Room the Example picture needs: its tag, then the card, the taller of the pair (about 225 pt), and a little air. */
const EXAMPLE_HEIGHT = 270;
/** Padding the hero scroller adds around its content, besides the top inset. */
const HERO_PAD_TOP = 8;
const HERO_PAD_BOTTOM = 16;
const EXAMPLE_GAP = 24;

type Provider = "google" | "email";

function ProviderButton({
  label,
  brand,
  onPress,
  tone = "plain",
  className = "",
}: {
  label: string;
  brand: Provider;
  onPress: () => void;
  tone?: "accent" | "plain";
  className?: string;
}) {
  const { colors, shadows } = useTheme();
  const box = tone === "accent" ? "bg-accent" : "bg-card border border-control";
  const text = tone === "accent" ? "text-on-accent" : "text-ink";
  const icon =
    brand === "google" ? (
      <View className="h-7 w-7 items-center justify-center rounded-full bg-card">
        <FontAwesome name="google" size={16} color={colors.google} />
      </View>
    ) : (
      <Icon name="mail-outline" size={22} color={colors.ink2} />
    );
  return (
    <PressableScale
      accessibilityRole="button"
      // The brand glyph is a font character; naming the button keeps it out of what a screen reader says.
      accessibilityLabel={label}
      onPress={onPress}
      highlightColor={tone === "accent" ? colors.accentPressed : colors.raised}
      containerClassName={className}
      className={`min-h-12 flex-row items-center justify-center rounded-ctl px-4 py-3 ${box}`}
      style={tone === "plain" ? { boxShadow: shadows.card } : undefined}
    >
      {icon}
      <Text maxFontSizeMultiplier={1.5} className={`ml-3 shrink font-sans-semibold text-body ${text}`}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** "Terms" / "Privacy Policy" inside the consent sentence: its own pressable, so it can have a real touch target. */
function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} className="py-1">
      <Text className="font-sans-medium text-meta text-ink-2 underline">{label}</Text>
    </Pressable>
  );
}

/**
 * One screen for everyone: Lately's name, one line on what it does, Lately's own reel -> card
 * Example, and Google and email as the two ways in, pinned at the bottom where the thumb is.
 * The Example gives way when the screen is too short for it (small phones, large text).
 */
export function SignInScreen() {
  const { colors } = useTheme();
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sending, setSending] = useState(false);
  const googleInFlight = useRef(false);
  const pendingShare = usePendingShare();
  // Measured, not guessed: the scroller's height and the heading's. Unmeasured (0) shows the Example.
  const [areaHeight, setAreaHeight] = useState(0);
  const [headHeight, setHeadHeight] = useState(0);
  const room = areaHeight - insets.top - HERO_PAD_TOP - HERO_PAD_BOTTOM - headHeight - EXAMPLE_GAP;
  const showExample = areaHeight === 0 || room >= EXAMPLE_HEIGHT;

  async function choose(provider: Provider) {
    if (auth.mode === "demo") {
      await auth.signInDemo();
      return;
    }
    if (provider === "email") {
      setEmailError("");
      return setEmailOpen(true);
    }
    // One Google window at a time: a second tap while it opens is ignored.
    if (googleInFlight.current) return;
    googleInFlight.current = true;
    try {
      await auth.signInWithGoogle();
    } catch (e) {
      const message = authErrorMessage(e, "google");
      if (message) toast.show(message);
    } finally {
      googleInFlight.current = false;
    }
  }

  async function sendLink() {
    const address = email.trim();
    setSending(true);
    setEmailError("");
    try {
      await auth.signInWithEmail(address);
      setEmailOpen(false);
      router.push(`/check-email?email=${encodeURIComponent(address)}`);
    } catch (e) {
      // Inline, in the sheet: a toast would sit behind the sheet's own window.
      setEmailError(authErrorMessage(e, "email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1"
        onLayout={(e) => setAreaHeight(e.nativeEvent.layout.height)}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          paddingTop: insets.top + HERO_PAD_TOP,
          paddingBottom: HERO_PAD_BOTTOM,
        }}
      >
        <View className="w-full max-w-[440px] px-4">
          <View className="items-center" onLayout={(e) => setHeadHeight(e.nativeEvent.layout.height)}>
            <Reveal index={0} style={{ alignItems: "center" }}>
              <Image
                source={LOGO}
                style={{ width: 60, height: 60, borderRadius: 16 }}
                accessibilityLabel="Lately logo"
              />
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.3}
                className="mt-2 font-display-heavy text-ink"
                style={{ fontSize: 36, lineHeight: 42, letterSpacing: -1 }}
              >
                Lately
              </Text>
            </Reveal>
            <Reveal index={1}>
              <Text className="mt-2 text-center font-sans text-body text-ink-2">
                Save reels from Instagram. Find them again by typing what you remember.
              </Text>
            </Reveal>
          </View>

          {showExample ? (
            <Reveal index={2} style={{ marginTop: EXAMPLE_GAP }}>
              <ExamplePair centered />
            </Reveal>
          ) : null}
        </View>
      </ScrollView>

      <Reveal index={3}>
        <View className="w-full max-w-[440px] self-center px-4 pt-3" style={{ paddingBottom: insets.bottom + 16 }}>
          {pendingShare ? (
            <View
              testID="pending-share-notice"
              accessibilityLiveRegion="polite"
              className="mb-3 w-full flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-3"
            >
              <Icon name="ios-share" size={20} color={colors.ink2} />
              <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">Sign in to finish saving the reel you shared.</Text>
            </View>
          ) : null}

          <View className="w-full gap-2.5">
            <ProviderButton tone="accent" brand="google" label="Continue with Google" onPress={() => choose("google")} />
            {/* Google and email are the only sign-ins Lately has; no placeholder providers. */}
            <ProviderButton brand="email" label="Continue with email" onPress={() => choose("email")} />
          </View>

          <View className="mt-3 flex-row flex-wrap items-center justify-center">
            <Text className="mr-1 text-center font-sans text-meta text-ink-3">{"By continuing you agree to Lately's"}</Text>
            <LegalLink label="Terms" onPress={() => router.push("/legal/terms")} />
            <Text className="mx-1 font-sans text-meta text-ink-3">and</Text>
            <LegalLink label="Privacy Policy" onPress={() => router.push("/legal/privacy")} />
            <Text className="font-sans text-meta text-ink-3">.</Text>
          </View>
        </View>
      </Reveal>

      <Sheet visible={emailOpen} onClose={() => setEmailOpen(false)}>
        <Text className="font-display text-display-sm text-ink">Continue with email</Text>
        <Text className="mt-1 font-sans text-body text-ink-2">{"We'll email you a sign-in link and a 6-digit code."}</Text>
        <TextField
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (emailError) setEmailError("");
          }}
          placeholder="you@example.com"
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          className="mt-4"
        />
        {emailError ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="mt-2 font-sans text-meta text-danger">
            {emailError}
          </Text>
        ) : null}
        <Button
          title="Send sign-in link"
          onPress={sendLink}
          disabled={!EMAIL.test(email.trim())}
          loading={sending}
          className="mt-4"
        />
      </Sheet>
    </View>
  );
}
