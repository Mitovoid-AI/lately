import FontAwesome from "@expo/vector-icons/FontAwesome";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ConnectedAccount, Preferences } from "../api/contract";
import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { LOGO, ScrollHairline } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { Checkbox } from "../components/settings/Checkbox";
import { OptionCard } from "../components/settings/OptionCard";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { TextSizeControl } from "../components/settings/TextSizeControl";
import { IMAGE_FADE } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useExport, type ExportPhase } from "../hooks/useExport";
import { usePreferences } from "../hooks/usePreferences";
import { useMe } from "../hooks/useSaves";
import { monthYear } from "../lib/dates";
import { haptic } from "../lib/haptics";
import { DURATION } from "../theme/motion";
import { colors } from "../theme/tokens";
import { goBack } from "../lib/navigation";
import { ConfirmDialog } from "../components/ConfirmDialog";

const SIZES: { size: Preferences["text_size"]; name: string }[] = [
  { size: 14, name: "Small" },
  { size: 16, name: "Default" },
  { size: 18, name: "Large" },
  { size: 20, name: "Extra large" },
];

const NOTE_IN = FadeIn.duration(DURATION.state);

const PROVIDER_NAME: Record<ConnectedAccount["provider"], string> = {
  instagram: "Instagram",
  google: "Google",
  email: "Email",
};

function InfoChip({ icon, text, tone = "plain" }: { icon: IconName; text: string; tone?: "plain" | "warm" }) {
  return (
    <View className={`h-8 flex-row items-center rounded-full px-3 ${tone === "warm" ? "bg-[#EFE3D3]" : "bg-raised"}`}>
      <Icon name={icon} size={16} color={tone === "warm" ? colors.accent : colors.ink2} />
      <Text className="ml-1.5 font-sans-medium text-meta text-ink">{text}</Text>
    </View>
  );
}

/** A setting that isn't built yet: a "Coming soon" pill beside a switched-off, disabled box. */
function ComingSoon({ label }: { label: string }) {
  return (
    <View className="flex-row items-center">
      <View className="mr-2 rounded-full bg-raised px-2 py-0.5">
        <Text className="font-sans-medium text-caption text-ink-2">Coming soon</Text>
      </View>
      <View style={{ opacity: 0.4 }}>
        <Checkbox checked={false} disabled label={label} />
      </View>
    </View>
  );
}

export function AccountScreen() {
  const router = useRouter();
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const { prefs, update } = usePreferences();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  const live = auth.mode === "live";
  const name = (live ? auth.user?.name : me?.name) ?? me?.name ?? "";
  const email = (live ? auth.user?.email : me?.email) ?? "";
  const handle = me?.handle ?? email.split("@")[0];
  const avatar = (live ? auth.user?.avatarUrl : me?.avatar_url) ?? null;
  const instagram = me?.connected_accounts.find((a) => a.provider === "instagram");
  const sizeName = SIZES.find((s) => s.size === prefs.text_size)?.name ?? "Default";
  const version = Constants.expoConfig?.version ?? "1.0.0";

  const archive = useExport();
  const ARCHIVE_SUBTITLE: Record<ExportPhase, string> = {
    idle: "Export your reels, notes and stacks as a JSON file",
    preparing: "Preparing…",
    ready: "Your archive is ready",
    sharing: "Your archive is ready",
  };
  function onArchivePress() {
    if (archive.phase === "idle") void archive.start();
    else if (archive.phase === "ready") void archive.download();
  }

  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deletingAccount, setDeletingAccount] = useState(false);
  async function deleteAccount() {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await api.deleteAccount();
      haptic.medium();
      setDeleteStep(0);
      await auth.signOut();
    } catch {
      haptic.error();
      setDeleteStep(0);
      toast.show("Couldn't delete your account. Try again.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="h-16 flex-row items-center px-2">
        <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router)} />
        <Image source={LOGO} style={{ width: 36, height: 36, borderRadius: 10 }} />
        <View className="ml-2 flex-1">
          <Text className="font-sans-semibold text-caption text-ink-2">LATELY</Text>
          <Text className="font-display text-display-sm text-ink" style={{ lineHeight: 24 }}>
            Account and Settings
          </Text>
        </View>
        <ScrollHairline scrollY={scrollY} />
      </View>

      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[560px] self-center px-4">
          <Reveal index={0}>
            <View className="items-center pt-6">
              <View>
                {avatar ? (
                  <Image
                    source={{ uri: avatar }}
                    transition={IMAGE_FADE}
                    style={{ width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: colors.card }}
                  />
                ) : (
                  <View className="h-28 w-28 items-center justify-center rounded-full bg-raised">
                    <Text className="font-display text-display-lg text-ink">{name[0] ?? "?"}</Text>
                  </View>
                )}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Change photo"
                  onPress={() => toast.show("Photo upload is coming soon")}
                  scaleTo={0.88}
                  containerClassName="absolute bottom-0 right-0"
                  className="h-9 w-9 items-center justify-center rounded-full border-2 border-canvas bg-accent"
                >
                  <Icon name="photo-camera" size={18} color="#FFFFFF" />
                </PressableScale>
              </View>
              <Text className="mt-4 font-display-medium text-display-lg text-ink">{name}</Text>
              <Text className="mt-1 font-sans text-body text-ink-2">{`@${handle} · ${email}`}</Text>
              {me ? (
                <Animated.View entering={NOTE_IN} style={{ alignItems: "center" }}>
                  <View className="mt-4 flex-row flex-wrap justify-center gap-2">
                    <InfoChip icon="bookmark-border" text={`${me.total_saves} Saved Reels`} />
                    <InfoChip icon="folder-open" text={`${me.stacks_count} Collections`} />
                  </View>
                  <View className="mt-2">
                    <InfoChip icon="verified" text={`Vault Member (${monthYear(me.member_since)})`} tone="warm" />
                  </View>
                </Animated.View>
              ) : null}
              {instagram ? (
                <View className="mt-3 h-9 flex-row items-center rounded-full bg-raised px-3">
                  <View className="h-2 w-2 rounded-full bg-success" />
                  <FontAwesome name="instagram" size={16} color={colors.ink2} style={{ marginLeft: 8 }} />
                  <Text className="mx-1.5 font-sans-medium text-meta text-ink">{`Connected to ${instagram.label}`}</Text>
                  <Icon name="check-circle-outline" size={16} color={colors.ink2} />
                </View>
              ) : null}
            </View>
          </Reveal>

          <Reveal index={1}>
            <SettingsSection icon="menu-book" title="Reading Experience & Appearance">
              <Text className="font-sans-semibold text-body text-ink">Reading Font</Text>
              <Text className="font-sans text-meta text-ink-2">Serif or Sans for summaries & notes</Text>
              <View className="mt-3 flex-row gap-2">
                <OptionCard
                  selected={prefs.reading_font === "newsreader"}
                  onPress={() => update({ reading_font: "newsreader" })}
                  top={<Text numberOfLines={1} className="text-center font-display-regular text-ink" style={{ fontSize: 16 }}>Newsreader</Text>}
                  label="Default"
                />
                <OptionCard
                  selected={prefs.reading_font === "inter"}
                  onPress={() => update({ reading_font: "inter" })}
                  top={<Text className="text-center font-sans text-ink" style={{ fontSize: 16 }}>Inter</Text>}
                  label="Modern"
                />
                <OptionCard
                  selected={prefs.reading_font === "lora"}
                  onPress={() => update({ reading_font: "lora" })}
                  top={<Text className="text-center font-lora italic text-ink" style={{ fontSize: 16 }}>Lora</Text>}
                  label="Classic"
                />
              </View>

              <View className="mt-6 flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="font-sans-semibold text-body text-ink">Text Size</Text>
                  <Text className="font-sans text-meta text-ink-2">Adjust editorial text scale</Text>
                </View>
                <View className="rounded-full border border-hairline bg-canvas px-3 py-1">
                  <Text className="font-sans-medium text-meta text-ink">{`${sizeName} (${prefs.text_size}px)`}</Text>
                </View>
              </View>
              <TextSizeControl sizes={SIZES} value={prefs.text_size} onChange={(size) => update({ text_size: size })} />

              <Text className="mt-6 font-sans-semibold text-body text-ink">Theme & Appearance</Text>
              <Text className="font-sans text-meta text-ink-2">Choose your color experience</Text>
              <View className="mt-3 flex-row gap-2">
                {(
                  [
                    { theme: "light", icon: "light-mode", title: "Light", label: "Warm Cream" },
                    { theme: "dark", icon: "dark-mode", title: "Dark", label: "Espresso" },
                    { theme: "system", icon: "brightness-medium", title: "System", label: "Auto matches" },
                  ] as const
                ).map((t) => (
                  <OptionCard
                    key={t.theme}
                    check
                    selected={prefs.theme === t.theme}
                    onPress={() => update({ theme: t.theme })}
                    top={
                      <View>
                        <Icon name={t.icon} size={20} color={prefs.theme === t.theme ? colors.accent : colors.ink2} />
                        <Text className="mt-2 font-sans-medium text-body text-ink">{t.title}</Text>
                      </View>
                    }
                    label={t.label}
                  />
                ))}
              </View>
              {prefs.theme !== "light" ? (
                <Animated.View entering={NOTE_IN}>
                  <Text className="mt-3 font-sans text-meta text-ink-2">
                    Dark theme is coming soon — Lately stays light for now.
                  </Text>
                </Animated.View>
              ) : null}
            </SettingsSection>
          </Reveal>

          <Reveal index={2}>
            <SettingsSection icon="shield" title="Account & Security">
              <SettingsRow icon="link" title="Connected Accounts" subtitle="How you sign in to Lately">
                <View className="ml-14 mt-3 gap-2">
                  {(me?.connected_accounts ?? []).map((a) => (
                    <View key={a.provider} className="h-11 flex-row items-center rounded-xl bg-raised px-3">
                      {a.provider === "instagram" ? (
                        <FontAwesome name="instagram" size={16} color={colors.ink2} />
                      ) : a.provider === "google" ? (
                        <FontAwesome name="google" size={15} color={colors.ink2} />
                      ) : (
                        <Icon name="mail-outline" size={16} color={colors.ink2} />
                      )}
                      <Text numberOfLines={1} className="ml-2 flex-1 font-sans-medium text-meta text-ink">
                        {`${PROVIDER_NAME[a.provider]} (${a.label})`}
                      </Text>
                      <Text className="font-sans-medium text-meta text-success">
                        {a.status === "active" ? "Active" : "Secured"}
                      </Text>
                    </View>
                  ))}
                </View>
              </SettingsRow>
              <SettingsRow
                icon="cloud-download"
                title="Download Vault Archive"
                subtitle={ARCHIVE_SUBTITLE[archive.phase]}
                onPress={onArchivePress}
                right={
                  archive.phase === "preparing" || archive.phase === "sharing" ? (
                    <ActivityIndicator color={colors.ink2} accessibilityLabel="Preparing your archive" />
                  ) : archive.phase === "ready" ? (
                    <Text className="font-sans-semibold text-meta text-accent">Download</Text>
                  ) : (
                    <Icon name="chevron-right" size={20} color={colors.ink2} />
                  )
                }
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={3}>
            <SettingsSection icon="tune" title="Reading Preferences">
              {/* Not built yet: shown as coming soon, switched off and not pressable. */}
              <SettingsRow
                icon="notifications-none"
                title="Push Digests"
                subtitle="Weekly summaries of your curated reels"
                right={<ComingSoon label="Push Digests" />}
              />
              <SettingsRow
                icon="offline-pin"
                title="Offline Reading Storage"
                subtitle="Keep recent transcripts ready offline"
                right={<ComingSoon label="Offline Reading Storage" />}
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={4}>
            <SettingsSection icon="gavel" title="Legal">
              <SettingsRow
                icon="privacy-tip"
                title="Privacy Policy"
                subtitle="What Lately stores and who processes it"
                onPress={() => router.push("/legal/privacy")}
                right={<Icon name="chevron-right" size={20} color={colors.ink2} />}
              />
              <SettingsRow
                icon="description"
                title="Terms of Service"
                subtitle="The rules for using Lately"
                onPress={() => router.push("/legal/terms")}
                right={<Icon name="chevron-right" size={20} color={colors.ink2} />}
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={5}>
            <PressableScale
              accessibilityRole="button"
              onPress={() => auth.signOut()}
              highlightColor="#F9CFCD"
              containerClassName="mt-8"
              className="flex-row items-center justify-center rounded-2xl bg-danger-soft px-4 py-5"
            >
              <Icon name="logout" size={22} color={colors.danger} />
              <View className="ml-3">
                <Text className="font-sans-semibold text-body text-danger">Log Out of Lately</Text>
                <Text className="font-sans text-meta text-danger">Session will safely end on this device</Text>
              </View>
            </PressableScale>

            <PressableScale
              accessibilityRole="button"
              onPress={() => setDeleteStep(1)}
              scaleTo={0.98}
              highlightColor={colors.dangerSoft}
              containerClassName="mt-3"
              className="flex-row items-center justify-center rounded-2xl border border-hairline px-4 py-4"
            >
              <Icon name="delete-forever" size={20} color={colors.danger} />
              <Text className="ml-2 font-sans-semibold text-body text-danger">Delete account</Text>
            </PressableScale>

            <View className="mt-8 items-center">
              <Image source={LOGO} style={{ width: 28, height: 28, borderRadius: 8 }} />
              <Text className="mt-2 font-sans text-meta text-ink-2">{`Lately v${version}`}</Text>
              <Text className="font-sans text-meta text-ink-3">Made for mindful reading & quiet curation</Text>
            </View>
          </Reveal>
        </View>
      </Animated.ScrollView>

      <ConfirmDialog
        visible={deleteStep === 1}
        title="Delete your account?"
        message="Your saved reels, notes, cards and stacks will be deleted, and you'll be signed out. Want a copy? Download your archive (a JSON file) first."
        confirmLabel="Continue"
        aside={{
          label: "Download my archive first",
          onPress: () => {
            setDeleteStep(0);
            if (archive.phase === "idle") void archive.start();
            else if (archive.phase === "ready") void archive.download();
          },
        }}
        onConfirm={() => setDeleteStep(2)}
        onCancel={() => setDeleteStep(0)}
      />
      <ConfirmDialog
        visible={deleteStep === 2}
        title="This can't be undone"
        message="Everything in your Lately is removed for good."
        confirmLabel="Delete forever"
        busy={deletingAccount}
        onConfirm={deleteAccount}
        onCancel={() => setDeleteStep(0)}
      />
    </View>
  );
}
