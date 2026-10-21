import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { PlanSync } from "../api/contract";
import { useBilling } from "../billing/BillingProvider";
import { openManageSubscription } from "../billing/manage";
import { ctaLabel, disclosure, planName, PRO_CONFIRMING, priceLine, savingsPercent, trialLabel } from "../billing/plans";
import { BillingError, ENTITLEMENT_PENDING, UNAVAILABLE_MESSAGE, type PlanId, type PlanOffer } from "../billing/types";
import { Button } from "../components/Button";
import { HEADER_HEIGHT } from "../components/Header";
import { Icon, type IconName } from "../components/Icon";
import { IconButton } from "../components/motion/IconButton";
import { PressableScale } from "../components/motion/PressableScale";
import { PopIn, Reveal } from "../components/motion/Reveal";
import { Skeleton, SkeletonGroup } from "../components/Skeleton";
import { useMe } from "../hooks/useSaves";
import { haptic } from "../lib/haptics";
import { goBack } from "../lib/navigation";
import { useTheme } from "../theme/ThemeProvider";

const MAX_WIDTH = 560;
/** Bricolage at hero size: the paywall's one loud line. */
const HERO = { fontSize: 30, lineHeight: 34, letterSpacing: -0.8 } as const;

const PENDING_TEXT = "Your payment is pending. Pro turns on when Google Play confirms it.";
const GENERIC_ERROR = "Something went wrong. Try again.";

const BENEFITS: { icon: IconName; text: string }[] = [
  { icon: "all-inclusive", text: "Unlimited saves, every month" },
  { icon: "calendar-today", text: "No monthly reset to wait for" },
  { icon: "folder-special", text: "Search, cards and stacks stay the same" },
];

type Notice = { tone: "error" | "info"; text: string; retry?: "buy" | "restore" };

const messageOf = (e: unknown) => (e instanceof BillingError ? e.message : GENERIC_ERROR);

const NOT_YET_TEXT = "Not on yet. Try again in a minute.";

/** The server answered and has Pro on (null: it couldn't be reached). */
const serverHasPro = (synced: PlanSync | null) => synced !== null && synced.plan !== "free";

/** Screen readers don't read a notice just because it appeared: say it when it does. */
function useAnnounce(text: string | null | undefined) {
  useEffect(() => {
    if (text) AccessibilityInfo.announceForAccessibility(text);
  }, [text]);
}

function TopBar({ onClose, onRestore, restoring }: { onClose: () => void; onRestore?: () => void; restoring?: boolean }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center justify-between px-1" style={{ height: HEADER_HEIGHT }}>
      <IconButton icon="close" size={24} color={colors.ink} label="Close" onPress={onClose} />
      {onRestore ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: restoring, busy: restoring }}
          disabled={restoring}
          onPress={onRestore}
          scaleTo={0.94}
          highlightColor={colors.raised}
          containerClassName="mr-3"
          className="h-11 min-w-[72px] items-center justify-center rounded-full px-3"
        >
          {restoring ? (
            <ActivityIndicator color={colors.accentText} accessibilityLabel="Restoring" />
          ) : (
            <Text className="font-sans-semibold text-body text-accent-text">Restore</Text>
          )}
        </PressableScale>
      ) : null}
    </View>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <View className={`h-6 w-6 items-center justify-center rounded-full border-2 ${checked ? "border-accent" : "border-ink-2"}`}>
      {checked ? <View className="h-3 w-3 rounded-full bg-accent" /> : null}
    </View>
  );
}

function PlanCard({ plan, checked, savePercent, onPress }: { plan: PlanOffer; checked: boolean; savePercent: number | null; onPress: () => void }) {
  const yearly = plan.id === "yearly";
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      haptic="selection"
      scaleTo={0.98}
      className={`flex-row items-center rounded-2xl border-[1.5px] bg-card p-4 ${checked ? "border-accent" : "border-hairline"}`}
    >
      <Radio checked={checked} />
      <View className="ml-3 flex-1">
        <View className="flex-row flex-wrap items-center">
          <Text className="font-sans-semibold text-body text-ink">{planName(plan)}</Text>
          {yearly && savePercent ? (
            <View className="ml-2 rounded-full bg-warm px-2 py-0.5">
              <Text className="font-sans-semibold text-caption text-accent-text">{`Save ${savePercent}%`}</Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-0.5 font-sans text-meta text-ink-2">
          {yearly && plan.perMonth ? `${priceLine(plan)} · ${plan.perMonth}/month` : priceLine(plan)}
        </Text>
        {plan.trialDays ? <Text className="mt-0.5 font-sans-medium text-meta text-accent-text">{trialLabel(plan.trialDays)}</Text> : null}
      </View>
    </PressableScale>
  );
}

function LegalLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={6} className="px-3 py-2.5">
      <Text className="font-sans-medium text-meta text-ink-2 underline">{label}</Text>
    </Pressable>
  );
}

/**
 * The "You're on Pro" sheet: right after subscribing, and whenever Pro is already on. While
 * the store says Pro but the server doesn't yet (it enforces the limit), it says Pro is
 * turning on instead, with a way to ask the server again.
 */
function ProState({
  lifetime,
  problem,
  confirming,
  onManage,
  onSave,
  onDone,
}: {
  lifetime: boolean;
  /** Why Manage subscription didn't open, when it didn't. */
  problem: string | null;
  /** Set while the server hasn't caught up with the store. */
  confirming?: { checking: boolean; notYet: boolean; onCheck: () => void };
  onManage?: () => void;
  /** Saves the reel that was waiting on Pro (the save sheet sent it along). */
  onSave?: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  useAnnounce(problem ?? (confirming?.notYet ? NOT_YET_TEXT : null));
  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <TopBar onClose={onDone} />
      <View className="flex-1 items-center justify-center px-6">
        <PopIn>
          <View className="h-20 w-20 items-center justify-center rounded-full bg-warm">
            <Icon name={confirming ? "schedule" : "check"} size={38} color={colors.accentText} />
          </View>
        </PopIn>
        <Reveal index={1}>
          <Text className="mt-6 text-center font-display-heavy text-ink" style={HERO}>
            {confirming ? "Turning Pro on" : "You're on Pro"}
          </Text>
          <Text className="mt-2 text-center font-sans text-body text-ink-2">{confirming ? PRO_CONFIRMING : "Unlimited saves are on."}</Text>
          {lifetime ? <Text className="mt-1 text-center font-sans text-meta text-ink-3">Lifetime plan</Text> : null}
          {confirming?.notYet ? <Text className="mt-4 text-center font-sans text-meta text-ink-2">{NOT_YET_TEXT}</Text> : null}
          {problem ? (
            <Text accessibilityRole="alert" className="mt-4 text-center font-sans text-meta text-danger">
              {problem}
            </Text>
          ) : null}
        </Reveal>
      </View>
      <View className="w-full self-center px-5" style={{ maxWidth: MAX_WIDTH, paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        {onManage ? <Button title="Manage subscription" variant="secondary" onPress={onManage} className="mb-3" /> : null}
        {confirming ? (
          <>
            <Button title="Check again" size="lg" onPress={confirming.onCheck} loading={confirming.checking} />
            <Button title="Done" variant="ghost" onPress={onDone} className="mt-1" />
          </>
        ) : onSave ? (
          <>
            <Button title="Save that reel" size="lg" onPress={onSave} />
            <Button title="Done" variant="ghost" onPress={onDone} className="mt-1" />
          </>
        ) : (
          <Button title="Done" size="lg" onPress={onDone} />
        )}
      </View>
    </View>
  );
}

export function PaywallScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { text: textParam } = useLocalSearchParams<{ text?: string }>();
  // The reel that hit the free limit, when the save sheet sent us here: Pro is bought to save it.
  const reelText = typeof textParam === "string" && textParam ? textParam : undefined;
  const { client, proActive, syncPlan } = useBilling();
  const meQuery = useMe();
  const me = meQuery.data;
  const plansQuery = useQuery({ queryKey: ["billing-plans", client.kind], queryFn: () => client.getPlans(), staleTime: 60_000 });

  const [picked, setPicked] = useState<PlanId>("yearly");
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [justSubscribed, setJustSubscribed] = useState(false);
  // The server (which enforces the limit) said Pro is on; /me may lag behind this answer.
  const [syncedPro, setSyncedPro] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [manageProblem, setManageProblem] = useState<string | null>(null);
  const working = useRef(false);
  const recheckLatch = useRef(false);

  const close = useCallback(() => goBack(router), [router]);

  // The store says Pro but the server still says free (a purchase made on this phone a moment
  // ago, or in another session): tell the server once. The screen says Pro is turning on, not
  // that it is on, until the server agrees.
  const healed = useRef(false);
  useEffect(() => {
    if (proActive && me?.plan === "free" && !healed.current) {
      healed.current = true;
      void syncPlan();
    }
  }, [proActive, me?.plan, syncPlan]);

  const plans = plansQuery.data ?? [];
  const selected = plans.find((p) => p.id === picked) ?? plans[0];
  const yearly = plans.find((p) => p.id === "yearly");
  const monthly = plans.find((p) => p.id === "monthly");
  const savePercent = yearly && monthly ? savingsPercent(yearly, monthly) : null;
  const unavailable = client.kind === "unavailable";
  const limit = me?.saves_limit ?? 20;

  async function run(kind: "buy" | "restore", step: () => Promise<boolean>) {
    if (working.current) return;
    working.current = true;
    setBusy(kind);
    setNotice(null);
    try {
      if (await step()) {
        const agreed = serverHasPro(await syncPlan());
        if (agreed) haptic.success();
        setSyncedPro(agreed);
        setJustSubscribed(true);
      }
    } catch (e) {
      if (e instanceof BillingError && e.code === ENTITLEMENT_PENDING) {
        // Google Play took the payment and Pro just isn't on yet: not a failure, and not a
        // reason to buy a second time. Restore picks it up; so does the server's own sync.
        setNotice({ tone: "info", text: e.message, retry: "restore" });
        void syncPlan();
      } else {
        haptic.error();
        setNotice({ tone: "error", text: messageOf(e), retry: kind });
      }
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  const subscribe = () =>
    selected &&
    run("buy", async () => {
      const result = await client.purchase(selected.id);
      if (result === "pending") setPending(true);
      return result === "purchased";
    });

  const restore = () =>
    run("restore", async () => {
      const found = await client.restore();
      if (!found) setNotice({ tone: "info", text: "We couldn't find a Pro subscription to restore." });
      return found;
    });

  async function checkAgain() {
    if (recheckLatch.current) return;
    recheckLatch.current = true;
    setRechecking(true);
    setNotYet(false);
    const agreed = serverHasPro(await syncPlan());
    if (agreed) haptic.success();
    setSyncedPro(agreed);
    setNotYet(!agreed);
    recheckLatch.current = false;
    setRechecking(false);
  }

  async function manage() {
    setManageProblem(null);
    try {
      await openManageSubscription(client);
    } catch {
      setManageProblem("Couldn't open Google Play. Open it and go to Subscriptions.");
    }
  }

  useAnnounce(notice?.text ?? (pending ? PENDING_TEXT : null));

  // Pro is on, or turning on: no picker. (The store can report Pro a beat before a purchase
  // finishes; Manage subscription waits for it, so it doesn't flash up and vanish.)
  const lifetime = me?.plan === "lifetime";
  if (me?.plan === "pro" || lifetime || syncedPro) {
    const saveReel = reelText ? () => router.replace({ pathname: "/save-sheet", params: { text: reelText } }) : undefined;
    return (
      <ProState
        lifetime={lifetime}
        problem={manageProblem}
        onManage={justSubscribed || lifetime || busy ? undefined : manage}
        onSave={saveReel}
        onDone={close}
      />
    );
  }
  // The store says Pro and the server doesn't yet. A purchase still in progress stays on the picker.
  if ((proActive || justSubscribed) && !busy && !meQuery.isPending) {
    return (
      <ProState
        lifetime={false}
        problem={null}
        confirming={{ checking: rechecking, notYet, onCheck: checkAgain }}
        onDone={close}
      />
    );
  }

  const checking = meQuery.isPending;
  const loading = checking || plansQuery.isPending;

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <TopBar onClose={close} onRestore={unavailable ? undefined : restore} restoring={busy === "restore"} />

      <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View className="w-full self-center px-5" style={{ maxWidth: MAX_WIDTH }}>
          <Reveal index={0}>
            <Text className="mt-2 font-display-heavy text-ink" style={HERO}>
              Save without limits
            </Text>
            <Text className="mt-2 font-sans text-body text-ink-2">{`Free covers ${limit} saves a month. Pro removes the cap.`}</Text>
          </Reveal>

          <Reveal index={1}>
            <View className="mt-6 gap-3">
              {BENEFITS.map((b) => (
                <View key={b.text} className="flex-row items-center">
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-raised">
                    <Icon name={b.icon} size={18} color={colors.accentText} />
                  </View>
                  <Text className="ml-3 flex-1 font-sans-medium text-body text-ink">{b.text}</Text>
                </View>
              ))}
            </View>
          </Reveal>

          <Reveal index={2}>
            <View className="mt-7">
              {loading ? (
                <SkeletonGroup style={{ gap: 12 }}>
                  <Skeleton style={{ height: 92, borderRadius: 16 }} />
                  <Skeleton style={{ height: 68, borderRadius: 16 }} />
                </SkeletonGroup>
              ) : plansQuery.isError ? (
                <View className="rounded-2xl border border-hairline bg-card p-4">
                  <Text className="font-sans-semibold text-body text-ink">{"Couldn't load the plans"}</Text>
                  <Text className="mt-0.5 font-sans text-meta text-ink-2">
                    {plansQuery.error instanceof BillingError ? plansQuery.error.message : "Check your connection and try again."}
                  </Text>
                  <Button title="Try again" variant="secondary" onPress={() => plansQuery.refetch()} loading={plansQuery.isRefetching} className="mt-3" />
                </View>
              ) : (
                <View accessibilityRole="radiogroup" className="gap-3">
                  {plans.map((p) => (
                    <PlanCard key={p.id} plan={p} checked={selected?.id === p.id} savePercent={savePercent} onPress={() => setPicked(p.id)} />
                  ))}
                </View>
              )}
            </View>
          </Reveal>
        </View>
      </ScrollView>

      <View className="border-t border-hairline bg-canvas" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <View className="w-full self-center px-5 pt-3" style={{ maxWidth: MAX_WIDTH }}>
          {notice ? (
            <View className={`mb-3 rounded-xl px-3 py-2.5 ${notice.tone === "error" ? "bg-danger-soft" : "bg-raised"}`}>
              <Text accessibilityRole="alert" className={`font-sans text-meta ${notice.tone === "error" ? "text-danger" : "text-ink-2"}`}>
                {notice.text}
              </Text>
              {notice.retry ? (
                <Button title="Try again" variant="ghost" onPress={notice.retry === "buy" ? subscribe : restore} className="mt-1 self-start" />
              ) : null}
            </View>
          ) : null}
          {pending ? (
            <>
              <View className="mb-3 rounded-xl bg-raised px-3 py-2.5">
                <Text accessibilityRole="alert" className="font-sans text-meta text-ink-2">
                  {PENDING_TEXT}
                </Text>
              </View>
              <Button title="Done" size="lg" onPress={close} />
            </>
          ) : (
            <>
              <Button
                title={selected && !loading ? ctaLabel(selected) : "Continue"}
                size="lg"
                onPress={subscribe}
                loading={busy === "buy"}
                disabled={loading || !selected || unavailable || busy === "restore"}
              />
              <View style={{ minHeight: 56 }}>
                {unavailable ? (
                  <Text className="mt-3 text-center font-sans text-meta text-ink-2">{UNAVAILABLE_MESSAGE}</Text>
                ) : selected && !loading ? (
                  <Text className="mt-3 text-center font-sans text-meta text-ink-2">{disclosure(selected)}</Text>
                ) : null}
              </View>
            </>
          )}
          <View className="flex-row items-center justify-center">
            <LegalLink label="Terms" onPress={() => router.push("/legal/terms")} />
            <Text className="font-sans text-meta text-ink-3">·</Text>
            <LegalLink label="Privacy" onPress={() => router.push("/legal/privacy")} />
          </View>
        </View>
      </View>
    </View>
  );
}
