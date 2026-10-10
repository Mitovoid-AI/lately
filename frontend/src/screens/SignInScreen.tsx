import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { authErrorMessage } from "../auth/messages";
import { Button } from "../components/Button";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { Sheet } from "../components/Sheet";
import { TextField } from "../components/TextField";
import { Thumb } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { haptic } from "../lib/haptics";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../theme/motion";
import { colors } from "../theme/tokens";
import { usePendingShare } from "../share/ShareRouter";

const IMG = {
  trail: require("../../assets/stitch/signin-trail.jpg"),
  desk: require("../../assets/stitch/signin-desk.jpg"),
  cafe: require("../../assets/stitch/signin-cafe.jpg"),
  kyoto: require("../../assets/stitch/signup-kyoto.jpg"),
  toast: require("../../assets/stitch/signup-toast.jpg"),
  living: require("../../assets/stitch/signup-living.jpg"),
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Provider = "google" | "email";

function Pill({ icon, label, iconColor = colors.ink2 }: { icon: IconName; label: string; iconColor?: string }) {
  return (
    <View className="h-8 flex-row items-center rounded-full bg-raised px-3">
      <Icon name={icon} size={16} color={iconColor} />
      <Text className="ml-1.5 font-sans-medium text-meta text-ink-2">{label}</Text>
    </View>
  );
}

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
  tone?: "accent" | "plain" | "soft";
  className?: string;
}) {
  const box = tone === "accent" ? "bg-accent" : tone === "soft" ? "bg-raised" : "bg-card border border-hairline";
  const text = tone === "accent" ? "text-on-accent" : "text-ink";
  const icon =
    brand === "google" ? (
      <View className="h-7 w-7 items-center justify-center rounded-full bg-card">
        <FontAwesome name="google" size={16} color="#4285F4" />
      </View>
    ) : (
      <Icon name="mail-outline" size={22} color={colors.ink2} />
    );
  return (
    <PressableScale
      accessibilityRole="button"
      onPress={onPress}
      highlightColor={tone === "accent" ? colors.accentPressed : colors.raised}
      containerClassName={className}
      className={`h-14 flex-row items-center justify-center rounded-ctl px-4 ${box}`}
      style={tone === "plain" ? { shadowColor: "#1C1A17", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } : undefined}
    >
      {icon}
      <Text className={`ml-3 font-sans-semibold text-body ${text}`}>{label}</Text>
    </PressableScale>
  );
}

function Tag({ icon, text, dark = true }: { icon?: IconName; text: string; dark?: boolean }) {
  return (
    <View
      className="flex-row items-center rounded-full px-2 py-1"
      style={{ backgroundColor: dark ? "rgba(28,26,23,0.55)" : "rgba(255,254,251,0.9)" }}
    >
      {icon ? <Icon name={icon} size={12} color={dark ? "#FFFFFF" : colors.ink} /> : null}
      <Text className={`ml-1 font-sans-semibold text-caption ${dark ? "text-on-accent" : "text-ink"}`}>{text}</Text>
    </View>
  );
}

/**
 * 0 → 1 once, a beat after mount, on a soft spring: the welcome visuals settle into place.
 * First-run only (the delight budget); with Reduce Motion they start settled.
 */
function useSettle(delay: number) {
  const reduced = useReducedMotion();
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) t.set(withDelay(delay, withSpring(1, { duration: 900, dampingRatio: 0.72 })));
  }, [delay, reduced, t]);
  return t;
}

/** A side reel that fans out from behind the centre one to its tilt. */
function FanCard({ side, style, children }: { side: -1 | 1; style: ViewStyle; children: ReactNode }) {
  const t = useSettle(160);
  const fan = useAnimatedStyle(() => ({
    opacity: Math.min(t.get() * 1.6, 1),
    transform: [{ translateX: -side * 44 * (1 - t.get()) }, { rotate: `${side * 8 * t.get()}deg` }],
  }));
  return <Animated.View style={[style, fan]}>{children}</Animated.View>;
}

/** The centre reel rises into place first. */
function LeadCard({ children }: { children: ReactNode }) {
  const t = useSettle(40);
  const rise = useAnimatedStyle(() => ({
    opacity: Math.min(t.get() * 2, 1),
    transform: [{ translateY: 18 * (1 - t.get()) }, { scale: 0.94 + 0.06 * t.get() }],
  }));
  return <Animated.View style={rise}>{children}</Animated.View>;
}

/** The tilted three-reel stack from "01 Sign in — light". */
function ReelStack() {
  return (
    <View className="mt-4 h-[330px] w-full items-center justify-center">
      <FanCard side={-1} style={{ position: "absolute", left: "8%", top: 24, width: 150 }}>
        <Thumb uri={null} aspect={9 / 16} radius={18}>
          <Image source={IMG.trail} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
          <View className="absolute left-2 top-2">
            <Tag icon="play-circle-outline" text="Reels" />
          </View>
          <Text className="absolute bottom-8 left-3 font-sans-semibold text-meta text-on-accent">@alpine.days</Text>
          <Text className="absolute bottom-3 left-3 font-sans text-caption text-on-accent">♪ Original audio</Text>
        </Thumb>
      </FanCard>
      <FanCard side={1} style={{ position: "absolute", right: "8%", top: 24, width: 150 }}>
        <Thumb uri={null} aspect={9 / 16} radius={18}>
          <Image source={IMG.desk} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
          <View className="absolute right-2 top-2">
            <Tag icon="play-arrow" text="0:34" />
          </View>
          <View className="absolute bottom-12 right-2 items-center">
            <Icon name="favorite-border" size={20} color="#FFFFFF" />
            <Text className="font-sans-semibold text-caption text-on-accent">42.1k</Text>
          </View>
        </Thumb>
      </FanCard>
      <LeadCard>
      <View
        style={{
          width: 178,
          shadowColor: "#1C1A17",
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        }}
      >
        <Thumb uri={null} aspect={9 / 16} radius={20}>
          <Image source={IMG.cafe} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
          <View className="absolute left-2 top-2">
            <Tag icon="play-circle-outline" text="REELS" />
          </View>
          <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(28,26,23,0.55)" }}>
            <Icon name="volume-up" size={14} color="#FFFFFF" />
          </View>
          <View className="absolute right-2 items-center" style={{ top: "44%" }}>
            <Icon name="favorite" size={22} color="#FFFFFF" />
            <Text className="mb-2 font-sans-semibold text-caption text-on-accent">64.2k</Text>
            <Icon name="chat-bubble-outline" size={20} color="#FFFFFF" />
            <Text className="font-sans-semibold text-caption text-on-accent">328</Text>
          </View>
          <View className="absolute bottom-[86px] left-2 flex-row items-center">
            <View className="h-5 w-5 items-center justify-center rounded-full bg-accent">
              <Icon name="local-cafe" size={12} color="#FFFFFF" />
            </View>
            <Text className="ml-1.5 font-sans-semibold text-meta text-on-accent">@cafestory</Text>
          </View>
          <Text numberOfLines={1} className="absolute bottom-[66px] left-2 right-2 font-sans text-caption text-on-accent">
            ♪ Sunday morning jazz • cafestory
          </Text>
          <View className="absolute bottom-2 left-2 right-2 rounded-xl bg-card px-2.5 py-2">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center">
                <Icon name="edit-note" size={14} color={colors.accent} />
                <Text className="ml-1 font-sans-semibold text-caption text-accent">Your Note</Text>
              </View>
              <Text className="font-sans text-caption text-ink-3">2m ago</Text>
            </View>
            <Text numberOfLines={1} className="mt-0.5 font-display-italic text-meta text-ink">
              “Quiet spot for Sunday…”
            </Text>
          </View>
        </Thumb>
      </View>
      </LeadCard>
    </View>
  );
}

function StripTile({ index, rotate, children }: { index: number; rotate: number; children: ReactNode }) {
  const t = useSettle(60 + index * 60);
  const tip = useAnimatedStyle(() => ({
    opacity: Math.min(t.get() * 1.6, 1),
    transform: [{ translateY: 14 * (1 - t.get()) }, { rotate: `${rotate * t.get()}deg` }],
  }));
  return <Animated.View style={[{ flex: 1 }, tip]}>{children}</Animated.View>;
}

/** The three-image strip from "00 Sign up — light". */
function ImageStrip() {
  const tiles: { src: number; label: string; icon: IconName; rotate: number }[] = [
    { src: IMG.kyoto, label: "Kyoto", icon: "place", rotate: -4 },
    { src: IMG.toast, label: "Brunch notes", icon: "edit-note", rotate: 0 },
    { src: IMG.living, label: "Studio", icon: "home", rotate: 4 },
  ];
  return (
    <View className="mt-6 h-[140px] w-full flex-row items-center gap-3 overflow-hidden rounded-2xl bg-raised px-2">
      {tiles.map((t, i) => (
        <StripTile key={t.label} index={i} rotate={t.rotate}>
          <Thumb uri={null} aspect={0.9} radius={14}>
            <Image source={t.src} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
            <View className="absolute bottom-2 left-2">
              <Tag icon={t.icon} text={t.label} dark={false} />
            </View>
          </Thumb>
        </StripTile>
      ))}
    </View>
  );
}

type Mode = "sign-in" | "sign-up";

/**
 * Sign in | Sign up: one white pill glides between the two (ease-in-out, 260 ms) instead of
 * each tab switching its own background.
 */
function ModeToggle({ value, onChange, wide }: { value: Mode; onChange: (m: Mode) => void; wide: boolean }) {
  const [layouts, setLayouts] = useState<Partial<Record<Mode, { x: number; width: number }>>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    const l = layouts[value];
    if (!l) return;
    if (!placed.current) {
      placed.current = true;
      x.set(l.x);
      w.set(l.width);
      return;
    }
    x.set(withTiming(l.x, { duration: 260, easing: EASE_IN_OUT }));
    w.set(withTiming(l.width, { duration: 260, easing: EASE_IN_OUT }));
  }, [value, layouts, x, w]);

  const pill = useAnimatedStyle(() => ({ width: w.get(), transform: [{ translateX: x.get() }] }));

  return (
    <View className={`mt-6 flex-row rounded-full bg-raised p-1 ${wide ? "w-full" : "w-[240px]"}`}>
      <Animated.View style={[styles.modePill, pill]} />
      {(["sign-in", "sign-up"] as const).map((t) => (
        <Pressable
          key={t}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === t }}
          onPress={() => {
            if (value !== t) haptic.selection();
            onChange(t);
          }}
          onLayout={(e) => {
            const { x: lx, width } = e.nativeEvent.layout;
            setLayouts((prev) => (prev[t]?.x === lx && prev[t]?.width === width ? prev : { ...prev, [t]: { x: lx, width } }));
          }}
          className="h-10 flex-1 items-center justify-center rounded-full"
        >
          <Text className={`text-body ${value === t ? "font-sans-semibold text-ink" : "font-sans text-ink-2"}`}>
            {t === "sign-in" ? "Sign in" : "Sign up"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const SWAP_IN = FadeIn.duration(DURATION.enter).easing(EASE_OUT);

export function SignInScreen() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Mode>("sign-in");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const signUp = tab === "sign-up";
  const pendingShare = usePendingShare();

  async function choose(provider: Provider) {
    if (auth.mode === "demo") {
      await auth.signInDemo();
      return;
    }
    if (provider === "email") return setEmailOpen(true);
    try {
      await auth.signInWithGoogle();
    } catch (e) {
      const message = authErrorMessage(e, "google");
      if (message) toast.show(message);
    }
  }

  async function sendLink() {
    const address = email.trim();
    setSending(true);
    try {
      await auth.signInWithEmail(address);
      setEmailOpen(false);
      router.push(`/check-email?email=${encodeURIComponent(address)}`);
    } catch (e) {
      toast.show(authErrorMessage(e, "email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24, alignItems: "center" }}
      >
        <View className="w-full max-w-[440px] items-center px-4">
          <Reveal index={0}>
            <View className="h-8 flex-row items-center rounded-full bg-raised px-4">
              <View className="mr-2 h-1.5 w-1.5 rounded-full bg-accent" />
              <Text className="font-sans-semibold text-label uppercase text-ink-2">Your mindful vault</Text>
            </View>
          </Reveal>
          <Reveal index={1} style={{ alignItems: "center" }}>
            <Image
              source={LOGO}
              style={{ width: 76, height: 76, borderRadius: 20, marginTop: 20 }}
              accessibilityLabel="Lately logo"
            />
            <Text className="mt-3 font-display-regular text-ink" style={{ fontSize: 44, lineHeight: 52 }}>
              Lately
            </Text>
          </Reveal>
          <Reveal index={2}>
            <Animated.View key={tab} entering={SWAP_IN}>
              <Text className="mt-2 text-center font-sans text-body text-ink-2">
                {signUp
                  ? "Create your personal vault. Save what inspires you across Instagram."
                  : "Save it with a reason.\nFind it when you need it."}
              </Text>
            </Animated.View>
          </Reveal>

          <Reveal index={3} style={{ width: "100%", alignItems: "center" }}>
            <ModeToggle value={tab} onChange={setTab} wide={signUp} />
          </Reveal>

          {signUp ? <ImageStrip /> : <ReelStack />}

          {signUp ? null : (
            <Reveal index={5}>
              <View className="mt-2 flex-row gap-2">
                <Pill icon="menu-book" label="Organized reading" />
                <Pill icon="search" label="Instant recall" iconColor={colors.success} />
              </View>
            </Reveal>
          )}

          {pendingShare ? (
            <Reveal index={6} style={{ width: "100%" }}>
              <View className="mt-6 w-full flex-row items-center rounded-2xl border border-hairline bg-card px-4 py-3">
                <Icon name="ios-share" size={20} color={colors.accent} />
                <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">
                  Sign in to finish saving the reel you shared.
                </Text>
              </View>
            </Reveal>
          ) : null}

          <Reveal index={6} style={{ width: "100%" }}>
          <View className="mt-6 w-full gap-3">
            <ProviderButton
              tone="accent"
              brand="google"
              label={signUp ? "Sign up with Google" : "Continue with Google"}
              onPress={() => choose("google")}
            />
            {/* Google and email are the only sign-ins Lately has; no placeholder providers. */}
            <ProviderButton
              brand="email"
              label={signUp ? "Sign up with email" : "Continue with email"}
              onPress={() => choose("email")}
            />
          </View>
          </Reveal>

          {signUp ? (
            <Reveal index={7}>
              <View className="mt-6 flex-row flex-wrap justify-center gap-2">
                <Pill icon="check-circle-outline" label="Organized reading" iconColor={colors.success} />
                <Pill icon="bolt" label="Instant recall" iconColor={colors.accent} />
                <Pill icon="lock-outline" label="Private & encrypted" />
              </View>
            </Reveal>
          ) : null}

          <View className="mt-6 flex-row items-center">
            <Text className="font-sans text-body text-ink-2">
              {signUp ? "Already have an account? " : "Don't have an account? "}
            </Text>
            <Pressable accessibilityRole="link" onPress={() => setTab(signUp ? "sign-in" : "sign-up")}>
              <Text className="font-sans-semibold text-body underline" style={{ color: "#8A5300" }}>
                {signUp ? "Sign in" : "Sign up"}
              </Text>
            </Pressable>
          </View>

          <Text className="mt-4 text-center font-sans text-meta text-ink-3">
            {"By continuing you agree to Lately's "}
            <Text accessibilityRole="link" onPress={() => router.push("/legal/terms")} className="font-sans-medium text-ink-2 underline">
              Terms
            </Text>
            {" and "}
            <Text
              accessibilityRole="link"
              onPress={() => router.push("/legal/privacy")}
              className="font-sans-medium text-ink-2 underline"
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </ScrollView>

      <Sheet visible={emailOpen} onClose={() => setEmailOpen(false)}>
        <Text className="font-display text-display-sm text-ink">Continue with email</Text>
        <Text className="mt-1 font-sans text-body text-ink-2">
          {"We'll email you a sign-in link and a 6-digit code."}
        </Text>
        <TextField
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          className="mt-4"
        />
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

const styles = StyleSheet.create({
  modePill: {
    pointerEvents: "none",
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: 999,
    backgroundColor: colors.card,
    shadowColor: "#1C1A17",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
