import FontAwesome from "@expo/vector-icons/FontAwesome";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ConnectedAccount, Me, Preferences } from "../api/contract";
import { useApi } from "../api/index";
import { useAuth } from "../auth/AuthProvider";
import { useBilling } from "../billing/BillingProvider";
import { HEADER_HEIGHT, LOGO, ScrollHairline } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { Checkbox } from "../components/settings/Checkbox";
import { OptionCard } from "../components/settings/OptionCard";
import { PlanSection } from "../components/settings/PlanSection";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { TextSizeControl } from "../components/settings/TextSizeControl";
import { IMAGE_FADE } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useExport, type ExportPhase } from "../hooks/useExport";
import { usePreferences } from "../hooks/usePreferences";
import { useMe } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { monthYear } from "../lib/dates";
import { forgetDeviceData } from "../lib/deviceData";
import { haptic } from "../lib/haptics";
import { DURATION } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { goBack } from "../lib/navigation";
import { ConfirmDialog } from "../components/ConfirmDialog";

const SIZES: { size: Preferences["text_size"]; name: string }[] = [
  { size: 14, name: "Small" },
  { size: 16, name: "Default" },
  { size: 18, name: "Large" },
  { size: 20, name: "Extra large" },
];

const NOTE_IN = FadeIn.duration(DURATION.state);

/**
 * Deleting the account doesn't stop a Google Play subscription: say so before it happens.
 * Plainly when the server or the store says Pro; as an "if" for anyone else on a build that can
 * sell (not lifetime), since a subscription still being synced, or in account hold, reads as free.
 */
function subscriptionNote(plan: Me["plan"] | undefined, storeSaysPro: boolean, canSubscribe: boolean): string {
  if (plan === "pro" || storeSaysPro) return " Deleting your account doesn't cancel your Google Play subscription. Cancel it in Google Play first.";
  if (plan !== "lifetime" && canSubscribe) return " If you subscribed to Lately Pro, deleting your account doesn't cancel it. Cancel it in Google Play first.";
  return "";
}

const PROVIDER_NAME: Record<ConnectedAccount["provider"], string> = {
  instagram: "Instagram",
  google: "Google",
  email: "Email",
};

function InfoChip({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View className="h-8 flex-row items-center rounded-full bg-raised px-3">
      <Icon name={icon} size={16} color={colors.ink2} />
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
  const { colors } = useTheme();
  const router = useRouter();
  const api = useApi();
  const auth = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const billing = useBilling();
  const { prefs, update } = usePreferences();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  const live = auth.mode === "live";
  const name = (live ? auth.user?.name : me?.name) ?? me?.name ?? "";
  const email = (live ? auth.user?.email : me?.email) ?? "";
  const handle = me?.handle ?? email.split("@")[0];
  const avatar = (live ? auth.user?.avatarUrl : me?.avatar_url) ?? null;
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

  const cancelNote = subscriptionNote(me?.plan, billing.proActive, billing.client.kind === "store");

  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deletingAccount, setDeletingAccount] = useState(false);
  async function deleteAccount() {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      await api.deleteAccount();
      haptic.medium();
      setDeleteStep(0);
      await forgetDeviceData(auth.user?.id);
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
      <View className="flex-row items-center px-1" style={{ height: HEADER_HEIGHT }}>
        <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router)} />
        <Text className="ml-1 flex-1 font-display text-display-sm text-ink">Account and settings</Text>
        <ScrollHairline scrollY={scrollY} />
      </View>

      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[560px] self-center px-4">
          <Reveal index={0}>
            <View className="items-center pt-4">
              <View>
                {avatar ? (
                  <Image
                    source={{ uri: avatar }}
                    transition={IMAGE_FADE}
                    style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: colors.card }}
                  />
                ) : (
                  <View className="items-center justify-center rounded-full bg-raised" style={{ width: 84, height: 84 }}>
                    <Text className="font-display text-display-lg text-ink">{name[0] ?? "?"}</Text>
                  </View>
                )}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Change photo"
                  onPress={() => toast.show("Changing your photo isn't available yet.")}
                  scaleTo={0.88}
                  containerClassName="absolute bottom-0 right-0"
                  className="h-8 w-8 items-center justify-center rounded-full border-2 border-canvas bg-accent"
                >
                  <Icon name="photo-camera" size={15} color={colors.onAccent} />
                </PressableScale>
              </View>
              <Text className="mt-3 font-display-medium text-display-md text-ink">{name}</Text>
              <Text numberOfLines={1} className="mt-0.5 font-sans text-meta text-ink-2">{`@${handle} · ${email}`}</Text>
              {me ? (
                <Animated.View entering={NOTE_IN} style={{ alignItems: "center" }}>
                  <View className="mt-3 flex-row flex-wrap justify-center gap-2">
                    <InfoChip icon="bookmark-border" text={countOf(me.total_saves, "saved reel")} />
                    <InfoChip icon="folder-open" text={countOf(me.stacks_count, "stack")} />
                  </View>
                  <Text className="mt-3 font-sans text-meta text-ink-3">{`Member since ${monthYear(me.member_since)}`}</Text>
                </Animated.View>
              ) : null}
            </View>
          </Reveal>

          {me ? (
            <Animated.View entering={NOTE_IN}>
              <PlanSection me={me} />
            </Animated.View>
          ) : null}

          <Reveal index={2}>
            <SettingsSection icon="menu-book" title="Reading and appearance">
              <Text className="font-sans-semibold text-body text-ink">Reading font</Text>
              <Text className="font-sans text-meta text-ink-2">Serif or sans-serif for summaries and notes</Text>
              <View className="mt-3 flex-row gap-2">
                <OptionCard
                  selected={prefs.reading_font === "newsreader"}
                  onPress={() => update({ reading_font: "newsreader" })}
                  top={<Text numberOfLines={1} className="text-center font-newsreader text-ink" style={{ fontSize: 16 }}>Newsreader</Text>}
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
                  <Text className="font-sans-semibold text-body text-ink">Text size</Text>
                  <Text className="font-sans text-meta text-ink-2">How large summaries and notes read</Text>
                </View>
                <View className="rounded-full border border-hairline bg-canvas px-3 py-1">
                  <Text className="font-sans-medium text-meta text-ink">{`${sizeName} (${prefs.text_size}px)`}</Text>
                </View>
              </View>
              <TextSizeControl sizes={SIZES} value={prefs.text_size} onChange={(size) => update({ text_size: size })} />

              <Text className="mt-6 font-sans-semibold text-body text-ink">Theme</Text>
              <Text className="font-sans text-meta text-ink-2">Light, dark, or match your phone</Text>
              <View className="mt-3 flex-row gap-2">
                {(
                  [
                    { theme: "light", icon: "light-mode", title: "Light", label: "Daylight" },
                    { theme: "dark", icon: "dark-mode", title: "Dark", label: "Espresso" },
                    { theme: "system", icon: "brightness-medium", title: "System", label: "Matches phone" },
                  ] as const
                ).map((t) => (
                  <OptionCard
                    key={t.theme}
                    check
                    selected={prefs.theme === t.theme}
                    onPress={() => update({ theme: t.theme })}
                    top={
                      <View>
                        <Icon name={t.icon} size={20} color={prefs.theme === t.theme ? colors.accentText : colors.ink2} />
                        <Text className="mt-2 font-sans-medium text-body text-ink">{t.title}</Text>
                      </View>
                    }
                    label={t.label}
                  />
                ))}
              </View>
            </SettingsSection>
          </Reveal>

          <Reveal index={3}>
            <SettingsSection icon="shield" title="Sign-in and data">
              <SettingsRow icon="link" title="Sign-in methods" subtitle="How you sign in to Lately">
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
                        {a.status === "active" ? "Active" : "Verified"}
                      </Text>
                    </View>
                  ))}
                </View>
              </SettingsRow>
              <SettingsRow
                icon="cloud-download"
                title="Download your archive"
                subtitle={ARCHIVE_SUBTITLE[archive.phase]}
                onPress={onArchivePress}
                right={
                  archive.phase === "preparing" || archive.phase === "sharing" ? (
                    <ActivityIndicator color={colors.ink2} accessibilityLabel="Preparing your archive" />
                  ) : archive.phase === "ready" ? (
                    <Text className="font-sans-semibold text-meta text-accent-text">Download</Text>
                  ) : (
                    <Icon name="chevron-right" size={20} color={colors.ink2} />
                  )
                }
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={4}>
            <SettingsSection icon="tune" title="Notifications and offline">
              {/* Not built yet: shown as coming soon, switched off and not pressable. */}
              <SettingsRow
                icon="notifications-none"
                title="Weekly digest"
                subtitle="A weekly reminder of reels you saved"
                right={<ComingSoon label="Weekly digest" />}
              />
              <SettingsRow
                icon="offline-pin"
                title="Offline reading"
                subtitle="Recent cards, available offline"
                right={<ComingSoon label="Offline reading" />}
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={5}>
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

          <Reveal index={6}>
            <PressableScale
              accessibilityRole="button"
              onPress={async () => {
                await forgetDeviceData(auth.user?.id);
                await auth.signOut();
              }}
              highlightColor={colors.dangerPressed}
              containerClassName="mt-8"
              className="flex-row items-center justify-center rounded-2xl bg-danger-soft px-4 py-5"
            >
              <Icon name="logout" size={22} color={colors.danger} />
              <View className="ml-3">
                <Text className="font-sans-semibold text-body text-danger">Log out</Text>
                <Text className="font-sans text-meta text-danger">Ends your session on this phone</Text>
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
            </View>
          </Reveal>
        </View>
      </Animated.ScrollView>

      <ConfirmDialog
        visible={deleteStep === 1}
        title="Delete your account?"
        message={`Your saved reels, notes, cards and stacks will be deleted, and you'll be signed out. Want a copy? Download your archive (a JSON file) first.${cancelNote}`}
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
        message={`Everything in your account is removed for good.${cancelNote}`}
        confirmLabel="Delete forever"
        busy={deletingAccount}
        onConfirm={deleteAccount}
        onCancel={() => setDeleteStep(0)}
      />
    </View>
  );
}
