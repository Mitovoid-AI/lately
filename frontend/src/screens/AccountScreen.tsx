import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Switch, Text, View } from "react-native";
import Animated, { FadeIn, useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiError, type ConnectedAccount, type Me, type Preferences } from "../api/contract";
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
import { appVersionLabel, reportProblemUrl, supportEmail } from "../components/settings/about";
import { OptionCard } from "../components/settings/OptionCard";
import { PlanSection } from "../components/settings/PlanSection";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { TextSizeControl } from "../components/settings/TextSizeControl";
import { useInstagramLink } from "../components/settings/useInstagramLink";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { IMAGE_FADE } from "../components/Thumb";
import { useToast } from "../components/Toast";
import { useExport, type ExportPhase } from "../hooks/useExport";
import { usePreferences } from "../hooks/usePreferences";
import { useSaveQueue } from "../hooks/useSaveQueue";
import { useMe } from "../hooks/useSaves";
import { countOf } from "../lib/counts";
import { monthYear } from "../lib/dates";
import { forgetDeviceData } from "../lib/deviceData";
import { setDevicePref, useDevicePrefs } from "../lib/devicePrefs";
import { haptic } from "../lib/haptics";
import { goBack } from "../lib/navigation";
import { DURATION } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { checkForUpdatesNow } from "../updates/offer";
import { updateSource } from "../updates/release";

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

type SignInProvider = Exclude<ConnectedAccount["provider"], "instagram">;

// Instagram is never a way to sign in: its connection has its own row (Connected accounts).
const PROVIDER_NAME: Record<SignInProvider, string> = {
  google: "Google",
  email: "Email",
};

const isSignIn = (a: ConnectedAccount): a is ConnectedAccount & { provider: SignInProvider } => a.provider !== "instagram";

/** "2 links haven't been sent yet. Signing out deletes them." */
function unsentNote(n: number): string {
  return n === 1
    ? "1 link hasn't been sent yet. Signing out deletes it."
    : `${n} links haven't been sent yet. Signing out deletes them.`;
}

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

/**
 * Reading and appearance before the account's own settings are in: a quiet placeholder, or what
 * failed and a retry. Never the defaults shown as if chosen (one tap would save them).
 */
function PreferencesPending({ failed, onRetry, retrying }: { failed: boolean; onRetry: () => void; retrying: boolean }) {
  if (!failed) {
    return (
      <SkeletonGroup label="Loading your settings" style={{ gap: 12 }}>
        <Skeleton style={{ width: 140, height: 16, borderRadius: 8 }} />
        <Skeleton style={{ height: 80, borderRadius: 12 }} />
        <Skeleton style={{ height: 80, borderRadius: 12 }} />
      </SkeletonGroup>
    );
  }
  return (
    <View>
      <Text accessibilityLiveRegion="polite" className="font-sans text-body text-ink-2">
        {"Couldn't load your reading and theme settings. Check your connection and try again."}
      </Text>
      <Button title="Try again" variant="secondary" onPress={onRetry} loading={retrying} className="mt-3" />
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
  const { prefs, update, loaded: prefsLoaded, failed: prefsFailed, retry: retryPrefs, retrying: retryingPrefs } = usePreferences();
  const device = useDevicePrefs();
  const queue = useSaveQueue();
  const instagram = useInstagramLink().data;
  const testBuild = updateSource();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  const live = auth.mode === "live";
  const name = (live ? auth.user?.name : me?.name) ?? me?.name ?? "";
  const email = (live ? auth.user?.email : me?.email) ?? "";
  const handle = me?.handle ?? email.split("@")[0];
  const identity = [handle ? `@${handle}` : "", email].filter(Boolean).join(" · ");
  const avatar = (live ? auth.user?.avatarUrl : me?.avatar_url) ?? null;
  const sizeName = SIZES.find((s) => s.size === prefs.text_size)?.name ?? "Default";
  // Signed in with Google or email, the name is already known; only the demo waits on /me for it.
  const profileLoading = meQuery.isPending && !name;
  // The Instagram connection is listed only while the server offers it (hidden when off or unanswered).
  const dm = instagram?.enabled && instagram.handle ? instagram : null;
  const chevron = <Icon name="chevron-right" size={20} color={colors.ink2} />;

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
      try {
        await api.deleteAccount();
      } catch (e) {
        // Not found: an earlier try deleted it and only its reply was lost. That is done, not failed.
        if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
      }
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

  // Links saved offline and not sent yet live only on this phone: signing out deletes them, so ask first.
  const unsent = queue.queued.length;
  const [askSignOut, setAskSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await forgetDeviceData(auth.user?.id);
      await auth.signOut();
    } catch {
      toast.show("Couldn't sign out. Try again.");
    } finally {
      setSigningOut(false);
      setAskSignOut(false);
    }
  }

  const [checkingUpdates, setCheckingUpdates] = useState(false);
  async function checkUpdates() {
    if (checkingUpdates) return;
    setCheckingUpdates(true);
    const result = await checkForUpdatesNow();
    setCheckingUpdates(false);
    // "offered" opens the update dialog itself.
    if (result === "current") toast.show("You're on the newest build");
    else if (result === "failed") toast.show("Couldn't check for updates. Try again.");
  }

  async function reportProblem() {
    try {
      await Linking.openURL(reportProblemUrl());
    } catch {
      const email = supportEmail();
      toast.show(email ? `Couldn't open your email app. Write to ${email}.` : "Couldn't open the page. Try again.");
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
            <SettingsSection
              icon="menu-book"
              title="Reading and appearance"
              placeholder={
                prefsLoaded ? undefined : (
                  <PreferencesPending failed={prefsFailed} onRetry={() => void retryPrefs()} retrying={retryingPrefs} />
                )
              }
            >
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

          {/* Kept on this phone only (devicePrefs): they work signed in or not and never wait on the server. */}
          <Reveal index={3}>
            <SettingsSection icon="bookmark-border" title="Saving">
              <Text className="font-sans-semibold text-body text-ink">After sharing a reel</Text>
              <Text className="font-sans text-meta text-ink-2">What happens once Lately has saved it</Text>
              <View className="mt-3 flex-row gap-2">
                {(
                  [
                    { value: "ask", icon: "edit-note", title: "Ask for a note", label: "Add why you saved it" },
                    { value: "return", icon: "ios-share", title: "Save and go back", label: "Returns right away" },
                  ] as const
                ).map((o) => (
                  <OptionCard
                    key={o.value}
                    check
                    selected={device.afterShare === o.value}
                    onPress={() => void setDevicePref("afterShare", o.value)}
                    top={
                      <View>
                        <Icon name={o.icon} size={20} color={device.afterShare === o.value ? colors.accentText : colors.ink2} />
                        <Text className="mt-2 font-sans-medium text-body text-ink">{o.title}</Text>
                      </View>
                    }
                    label={o.label}
                  />
                ))}
              </View>

              <View className="mt-6 flex-row items-center">
                <View className="mr-3 flex-1">
                  <Text className="font-sans-semibold text-body text-ink">Vibration</Text>
                  <Text className="font-sans text-meta text-ink-2">A light buzz when you save, pick or delete</Text>
                </View>
                <Switch
                  accessibilityLabel="Vibration"
                  value={device.haptics}
                  onValueChange={(on) => {
                    void setDevicePref("haptics", on);
                    // Turned on: the first buzz says it works (setDevicePref applies at once).
                    haptic.light();
                  }}
                  trackColor={{ false: colors.control, true: colors.accent }}
                  thumbColor={device.haptics ? colors.onAccent : colors.card}
                  ios_backgroundColor={colors.control}
                />
              </View>
            </SettingsSection>
          </Reveal>

          {dm ? (
            <Reveal index={4}>
              <SettingsSection icon="link" title="Connected accounts">
                <SettingsRow
                  icon="instagram"
                  title="Save from Instagram DMs"
                  subtitle={dm.linked ? `Connected. Send reels to @${dm.handle}` : `Send reels to @${dm.handle} on Instagram to save them`}
                  onPress={() => router.push("/instagram")}
                  right={chevron}
                />
              </SettingsSection>
            </Reveal>
          ) : null}

          <Reveal index={5}>
            <SettingsSection icon="shield" title="Sign-in and data">
              <SettingsRow icon="link" title="Sign-in methods" subtitle="How you sign in to Lately">
                <View className="ml-14 mt-3 gap-2">
                  {me ? (
                    me.connected_accounts.filter(isSignIn).map((a) => (
                      <View key={a.provider} className="min-h-11 flex-row items-center rounded-xl bg-raised px-3 py-2">
                        {a.provider === "google" ? (
                          <FontAwesome name="google" size={15} color={colors.ink2} />
                        ) : (
                          <Icon name="mail-outline" size={16} color={colors.ink2} />
                        )}
                        {/* No status word: nothing here checks one (the server's "secured" is not a verification). */}
                        <Text numberOfLines={1} className="ml-2 flex-1 font-sans-medium text-meta text-ink">
                          {`${PROVIDER_NAME[a.provider]} (${a.label})`}
                        </Text>
                      </View>
                    ))
                  ) : meQuery.isError ? (
                    // The plan's error above has the one Try again: both come from the same profile request.
                    <View className="min-h-11 flex-row items-center rounded-xl bg-raised px-3 py-2">
                      <Icon name="cloud-off" size={16} color={colors.ink2} />
                      <Text className="ml-2 flex-1 font-sans text-meta text-ink-2">{"Couldn't load these"}</Text>
                    </View>
                  ) : (
                    <SkeletonGroup label="Loading your sign-in methods">
                      <Skeleton style={{ height: 44, borderRadius: 12 }} />
                    </SkeletonGroup>
                  )}
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

          <Reveal index={6}>
            <SettingsSection icon="info-outline" title="Help">
              <SettingsRow
                icon="ios-share"
                title="How to save from Instagram"
                subtitle="Share a reel to Lately, or paste its link"
                onPress={() => router.push("/help")}
                right={chevron}
              />
              <SettingsRow
                icon="mail-outline"
                title="Report a problem"
                subtitle={supportEmail() ? "Email the Lately team" : "Tell us on Lately's GitHub page"}
                onPress={() => void reportProblem()}
                right={<Icon name="open-in-new" size={20} color={colors.ink2} />}
                divider
              />
              {/* Test APKs only: the Play build is updated by the Play Store, never by Lately itself. */}
              {testBuild ? (
                <SettingsRow
                  icon="refresh"
                  title="Check for updates"
                  subtitle={`You're on test build ${testBuild.installedBuild}`}
                  onPress={() => void checkUpdates()}
                  right={
                    checkingUpdates ? <ActivityIndicator color={colors.ink2} accessibilityLabel="Checking for updates" /> : chevron
                  }
                  divider
                />
              ) : null}
            </SettingsSection>
          </Reveal>

          <Reveal index={7}>
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
              <SettingsRow
                icon="description"
                title="Open-source licenses"
                subtitle="The fonts and libraries Lately is built with"
                onPress={() => router.push("/licenses")}
                right={chevron}
                divider
              />
            </SettingsSection>
          </Reveal>

          <Reveal index={8}>
            {/* Signing out is routine and undoable: a plain secondary button. Deleting is the one danger action. */}
            <Button
              title="Sign out"
              variant="secondary"
              icon="logout"
              className="mt-8"
              loading={signingOut && !askSignOut}
              onPress={() => (unsent > 0 ? setAskSignOut(true) : void signOut())}
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
              <Text selectable className="mt-2 font-sans text-meta text-ink-2">
                {appVersionLabel()}
              </Text>
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
            // The share sheet answers a ready archive; anything else gets a word, since its row may be off screen.
            if (archive.phase === "ready") void archive.download();
            else {
              if (archive.phase === "idle") void archive.start();
              toast.show("Preparing your archive…");
            }
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
      <ConfirmDialog
        visible={askSignOut}
        title="Sign out?"
        message={unsentNote(unsent)}
        confirmLabel="Sign out"
        busy={signingOut}
        onConfirm={() => void signOut()}
        onCancel={() => setAskSignOut(false)}
      />
    </View>
  );
}
