import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/Button";
import { LOGO } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { Thumb } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { colors } from "../theme/tokens";

const IMG = {
  trail: require("../../assets/stitch/signin-trail.jpg"),
  desk: require("../../assets/stitch/signin-desk.jpg"),
  cafe: require("../../assets/stitch/signin-cafe.jpg"),
  kyoto: require("../../assets/stitch/signup-kyoto.jpg"),
  toast: require("../../assets/stitch/signup-toast.jpg"),
  living: require("../../assets/stitch/signup-living.jpg"),
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Provider = "google" | "instagram" | "facebook" | "email";

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
    ) : brand === "instagram" ? (
      <FontAwesome name="instagram" size={22} color={tone === "accent" ? colors.onAccent : "#C13584"} />
    ) : brand === "facebook" ? (
      <FontAwesome name="facebook-official" size={22} color="#1877F2" />
    ) : (
      <Icon name="mail-outline" size={22} color={colors.ink2} />
    );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`h-14 flex-row items-center justify-center rounded-ctl px-4 active:opacity-80 ${box} ${className}`}
      style={tone === "plain" ? { shadowColor: "#1C1A17", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } : undefined}
    >
      {icon}
      <Text className={`ml-3 font-sans-semibold text-body ${text}`}>{label}</Text>
    </Pressable>
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

/** The tilted three-reel stack from "01 Sign in — light". */
function ReelStack() {
  return (
    <View className="mt-4 h-[330px] w-full items-center justify-center">
      <View style={{ position: "absolute", left: "8%", top: 24, width: 150, transform: [{ rotate: "-8deg" }] }}>
        <Thumb uri={null} aspect={9 / 16} radius={18}>
          <Image source={IMG.trail} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
          <View className="absolute left-2 top-2">
            <Tag icon="play-circle-outline" text="Reels" />
          </View>
          <Text className="absolute bottom-8 left-3 font-sans-semibold text-meta text-on-accent">@alpine.days</Text>
          <Text className="absolute bottom-3 left-3 font-sans text-caption text-on-accent">♪ Original audio</Text>
        </Thumb>
      </View>
      <View style={{ position: "absolute", right: "8%", top: 24, width: 150, transform: [{ rotate: "8deg" }] }}>
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
      </View>
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
    </View>
  );
}

/** The three-image strip from "00 Sign up — light". */
function ImageStrip() {
  const tiles: { src: number; label: string; icon: IconName; rotate: string }[] = [
    { src: IMG.kyoto, label: "Kyoto", icon: "place", rotate: "-4deg" },
    { src: IMG.toast, label: "Brunch notes", icon: "edit-note", rotate: "0deg" },
    { src: IMG.living, label: "Studio", icon: "home", rotate: "4deg" },
  ];
  return (
    <View className="mt-6 h-[140px] w-full flex-row items-center gap-3 overflow-hidden rounded-2xl bg-raised px-2">
      {tiles.map((t) => (
        <View key={t.label} className="flex-1" style={{ transform: [{ rotate: t.rotate }] }}>
          <Thumb uri={null} aspect={0.9} radius={14}>
            <Image source={t.src} contentFit="cover" style={{ position: "absolute", width: "100%", height: "100%" }} />
            <View className="absolute bottom-2 left-2">
              <Tag icon={t.icon} text={t.label} dark={false} />
            </View>
          </Thumb>
        </View>
      ))}
    </View>
  );
}

export function SignInScreen() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"sign-in" | "sign-up">("sign-in");
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const signUp = tab === "sign-up";

  async function choose(provider: Provider) {
    if (auth.mode === "demo") {
      await auth.signInDemo();
      return;
    }
    if (provider === "instagram") return toast.show("Instagram sign-in is coming soon");
    if (provider === "facebook") return toast.show("Facebook sign-in is coming soon");
    if (provider === "email") return setEmailOpen(true);
    try {
      await auth.signInWithGoogle();
    } catch {
      toast.show("Google sign-in isn't set up yet");
    }
  }

  async function sendLink() {
    const address = email.trim();
    setSending(true);
    try {
      await auth.signInWithEmail(address);
      setEmailOpen(false);
      router.push(`/check-email?email=${encodeURIComponent(address)}`);
    } catch {
      toast.show("Couldn't send the link. Try again.");
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
          <View className="h-8 flex-row items-center rounded-full bg-raised px-4">
            <View className="mr-2 h-1.5 w-1.5 rounded-full bg-accent" />
            <Text className="font-sans-semibold text-label uppercase text-ink-2">Your mindful vault</Text>
          </View>
          <Image
            source={LOGO}
            style={{ width: 76, height: 76, borderRadius: 20, marginTop: 20 }}
            accessibilityLabel="Lately logo"
          />
          <Text className="mt-3 font-display-regular text-ink" style={{ fontSize: 44, lineHeight: 52 }}>
            Lately
          </Text>
          <Text className="mt-2 text-center font-sans text-body text-ink-2">
            {signUp
              ? "Create your personal vault. Save what inspires you across Instagram."
              : "Save it with a reason.\nFind it when you need it."}
          </Text>

          <View className={`mt-6 flex-row rounded-full bg-raised p-1 ${signUp ? "w-full" : "w-[240px]"}`}>
            {(["sign-in", "sign-up"] as const).map((t) => (
              <Pressable
                key={t}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                onPress={() => setTab(t)}
                className={`h-10 flex-1 items-center justify-center rounded-full ${tab === t ? "bg-card" : ""}`}
                style={tab === t ? { shadowColor: "#1C1A17", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 } } : undefined}
              >
                <Text className={`text-body ${tab === t ? "font-sans-semibold text-ink" : "font-sans text-ink-2"}`}>
                  {t === "sign-in" ? "Sign in" : "Sign up"}
                </Text>
              </Pressable>
            ))}
          </View>

          {signUp ? <ImageStrip /> : <ReelStack />}

          {signUp ? null : (
            <View className="mt-2 flex-row gap-2">
              <Pill icon="menu-book" label="Organized reading" />
              <Pill icon="search" label="Instant recall" iconColor={colors.success} />
            </View>
          )}

          <View className="mt-6 w-full gap-3">
            <ProviderButton
              tone="accent"
              brand="google"
              label={signUp ? "Sign up with Google" : "Continue with Google"}
              onPress={() => choose("google")}
            />
            <ProviderButton
              brand="instagram"
              label={signUp ? "Sign up with Instagram" : "Continue with Instagram"}
              onPress={() => choose("instagram")}
            />
            {signUp ? (
              <View className="flex-row gap-3">
                <ProviderButton tone="soft" brand="facebook" label="Facebook" onPress={() => choose("facebook")} className="flex-1" />
                <ProviderButton tone="soft" brand="email" label="With Email" onPress={() => choose("email")} className="flex-1" />
              </View>
            ) : (
              <>
                <ProviderButton brand="facebook" label="Continue with Facebook" onPress={() => choose("facebook")} />
                <ProviderButton brand="email" label="Continue with email" onPress={() => choose("email")} />
              </>
            )}
          </View>

          {signUp ? (
            <View className="mt-6 flex-row flex-wrap justify-center gap-2">
              <Pill icon="check-circle-outline" label="Organized reading" iconColor={colors.success} />
              <Pill icon="bolt" label="Instant recall" iconColor={colors.accent} />
              <Pill icon="lock-outline" label="Private & encrypted" />
            </View>
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
        </View>
      </ScrollView>

      <Sheet visible={emailOpen} onClose={() => setEmailOpen(false)}>
        <Text className="font-display text-display-sm text-ink">Continue with email</Text>
        <Text className="mt-1 font-sans text-body text-ink-2">
          {"We'll email you a sign-in link and a 6-digit code."}
        </Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.ink3}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          className="mt-4 h-12 rounded-ctl border border-hairline bg-canvas px-4 font-sans text-body text-ink"
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
