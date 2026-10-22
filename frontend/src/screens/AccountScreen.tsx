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
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { HEADER_HEIGHT, LOGO, ScrollHairline } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { Reveal } from "../components/motion/Reveal";
import { OptionCard } from "../components/settings/OptionCard";
import { PlanSection } from "../components/settings/PlanSection";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { TextSizeControl } from "../components/settings/TextSizeControl";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { IMAGE_FADE } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useExport, type ExportPhase } from "../hooks/useExport";
import { usePreferences } from "../hooks/usePreferences";
import { useMe } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { monthYear } from "../lib/dates";
import { forgetDeviceData } from "../lib/deviceData";
import { haptic } from "../lib/haptics";
import { goBack } from "../lib/navigation";
import { DURATION } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";

const SIZES: { size: Preferences["text_size"]; name: string }[] = [
  { size: 14, name: "Small" },
  { size: 16, name: "Default" },
  { size: 18, name: "Large" },
  { size: 20, name: "Extra large" },
];

const NOTE_IN = FadeIn.duration(DURATION.state);

const ARCHIVE_SUBTITLE: Record<ExportPhase, string> = {
  idle: "Your saves, notes, cards and stacks as a JSON file (links and text, no videos)",
  preparing: "Preparing…",
  ready: "Your archive is ready",
  sharing: "Your archive is ready",
};

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

/** A static fact about the account: fill only, no border, so it doesn't read as a button. */
function InfoChip({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View className="min-h-8 flex-row items-center rounded-full bg-raised px-3 py-1">
      <Icon name={icon} size={16} color={colors.ink2} />
      <Text className="ml-1.5 font-sans-medium text-meta text-ink">{text}</Text>
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
  const meQuery = useMe();
  const me = meQuery.data;
  const billing = useBilling();
  const { prefs, update } = usePreferences();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  const live = auth.mode === "live";
  const name = (live ? auth.user?.name : me?.name) ?? me?.name ?? "";
  const email = (live ? auth.user?.email : me?.email) ?? "";
  const handle = me?.handle ?? email.split("@")[0];
  const identity = [handle ? `@${handle}` : "", email].filter(Boolean).join(" · ");
  const avatar = (live ? auth.user?.avatarUrl : me?.avatar_url) ?? null;
  const sizeName = SIZES.find((s) => s.size === prefs.text_size)?.name ?? "Default";
  const version = Constants.expoConfig?.version ?? "1.0.0";
  // Signed in with Google or email, the name is already known; only the demo waits on /me for it.
  const profileLoading = meQuery.isPending && !name;

  const archive = useExport();
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
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          className="ml-1 flex-1 font-display text-display-sm text-ink"
        >
          Account and settings
        </Text>
        <ScrollHairline scrollY={scrollY} />
      </View>

      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View className="w-full max-w-[560px] self-center px-4">
          <Reveal index={0}>
            <View className="items-center pt-4">
              {profileLoading ? (
                <SkeletonGroup style={{ alignItems: "center", gap: 12 }}>
                  <Skeleton style={{ width: 84, height: 84, borderRadius: 42 }} />
                  <Skeleton style={{ width: 160, height: 24, borderRadius: 12 }} />
                  <Skeleton style={{ width: 220, height: 14, borderRadius: 7 }} />
                </SkeletonGroup>
              ) : (
                <>
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
                  <Text className="mt-3 font-display-medium text-display-md text-ink">{name}</Text>
                  {identity ? (
                    <Text numberOfLines={1} className="mt-0.5 font-sans text-meta text-ink-2">
                      {identity}
                    </Text>
                  ) : null}
                </>
              )}
              {me ? (
                <Animated.View entering={NOTE_IN} style={{ alignItems: "center" }}>
                  <View className="mt-3 flex-row flex-wrap justify-center gap-2">
                    <InfoChip icon="grid-view" text={countOf(me.total_saves, "save")} />
                    <InfoChip icon="folder-special" text={countOf(me.stacks_count, "stack")} />
                  </View>
                  <Text className="mt-3 font-sans text-meta text-ink-3">{`Member since ${monthYear(me.member_since)}`}</Text>
                </Animated.View>
              ) : meQuery.isPending ? (
                <SkeletonGroup style={{ alignItems: "center", gap: 12, marginTop: 12 }}>
                  <Skeleton style={{ width: 240, height: 32, borderRadius: 16 }} />
                  <Skeleton style={{ width: 140, height: 12, borderRadius: 6 }} />
                </SkeletonGroup>
              ) : null}
            </View>
          </Reveal>

          {me ? (
            <Animated.View entering={NOTE_IN}>
              <PlanSection me={me} />
            </Animated.View>
          ) : meQuery.isPending ? (
            <SkeletonGroup style={{ marginTop: 32 }}>
              <Skeleton style={{ height: 196, borderRadius: 16 }} />
            </SkeletonGroup>
          ) : meQuery.isError ? (
            <ErrorState
              title="Couldn't load your plan"
              body="Your plan and saves count didn't load. Check your connection and try again."
              onRetry={() => void meQuery.refetch()}
              retrying={meQuery.isRefetching}
            />
          ) : null}

          <Reveal index={2}>
            <SettingsSection icon="menu-book" title="Reading and appearance">
              <Text className="font-sans-semibold text-body text-ink">Reading font</Text>
              <Text className="font-sans text-meta text-ink-2">Serif or sans-serif for summaries and notes</Text>
              <View className="mt-3 flex-row gap-2">
                <OptionCard
                  selected={prefs.reading_font === "newsreader"}
                  onPress={() => update({ reading_font: "newsreader" })}
                  top={
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      className="text-center font-newsreader text-ink"
                      style={{ fontSize: 15 }}
                    >
                      Newsreader
                    </Text>
                  }
                  label="Default"
                />
                <OptionCard
                  selected={prefs.reading_font === "inter"}
                  onPress={() => update({ reading_font: "inter" })}
                  top={<Text className="text-center font-sans text-ink" style={{ fontSize: 15 }}>Inter</Text>}
                  label="Modern"
                />
                <OptionCard
                  selected={prefs.reading_font === "lora"}
                  onPress={() => update({ reading_font: "lora" })}
                  top={<Text className="text-center font-lora italic text-ink" style={{ fontSize: 15 }}>Lora</Text>}
                  label="Classic"
                />
              </View>

              <View className="mt-6 flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="font-sans-semibold text-body text-ink">Text size</Text>
                  <Text className="font-sans text-meta text-ink-2">How large summaries and notes read</Text>
                </View>
                {/* The current size, by name; a fill with no border, because it is a readout, not a control. */}
                <View className="ml-3 rounded-full bg-raised px-3 py-1">
                  <Text className="font-sans-medium text-meta text-ink">{sizeName}</Text>
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
                    <View key={a.provider} className="min-h-11 flex-row items-center rounded-xl bg-raised px-3 py-2">
                      {a.provider === "instagram" ? (
                        <FontAwesome name="instagram" size={16} color={colors.ink2} />
                      ) : a.provider === "google" ? (
                        <FontAwesome name="google" size={15} color={colors.ink2} />
                      ) : (
                        <Icon name="mail-outline" size={16} color={colors.ink2} />
                      )}
                      {/* No status word: nothing here checks one (the server's "secured" is not a verification). */}
                      <Text numberOfLines={1} className="ml-2 flex-1 font-sans-medium text-meta text-ink">
                        {`${PROVIDER_NAME[a.provider]} (${a.label})`}
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
                    <Text className="font-sans-semibold text-meta text-ink">Download</Text>
                  ) : (
                    <Icon name="chevron-right" size={20} color={colors.ink2} />
                  )
                }
                divider
              />
            </SettingsSection>
          </Reveal>

          {/* Weekly digest and offline reading aren't built, so they aren't listed: no "Coming soon" rows, no dead switches. */}

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
            {/* Signing out is routine and undoable: a plain secondary button. Deleting is the one danger action. */}
            <Button
              title="Sign out"
              variant="secondary"
              icon="logout"
              className="mt-8"
              onPress={async () => {
                await forgetDeviceData(auth.user?.id);
                await auth.signOut();
              }}
            />

            <PressableScale
              accessibilityRole="button"
              onPress={() => setDeleteStep(1)}
              scaleTo={0.98}
              highlightColor={colors.dangerSoft}
              containerClassName="mt-3"
              className="min-h-12 flex-row items-center justify-center rounded-ctl border border-hairline px-4 py-3"
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
        message={`Your saves, notes, cards and stacks will be deleted, and you'll be signed out. Want a copy? Download your archive (a JSON file) first.${cancelNote}`}
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
