import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import type { Me } from "../../api/contract";
import { useBilling } from "../../billing/BillingProvider";
import { openManageSubscription } from "../../billing/manage";
import { PRO_CONFIRMING } from "../../billing/plans";
import { BillingError } from "../../billing/types";
import { countOf } from "../../lib/counts";
import { shortDate } from "../../lib/dates";
import { haptic } from "../../lib/haptics";
import { useTheme } from "../../theme/ThemeProvider";
import { updateSource } from "../../updates/release";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { useToast } from "../Toast";
import { longDate } from "./longDate";
import { SettingsRow, SettingsSection } from "./SettingsSection";

const PLAN_TITLE: Record<Me["plan"], string> = { free: "Free plan", pro: "Lately Pro", lifetime: "Lifetime" };

/** Account > Plan: what the person is on, how much of the free limit is used, and how to change it. */
export function PlanSection({ me }: { me: Me }) {
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { client, syncPlan } = useBilling();
  const [restoring, setRestoring] = useState(false);
  const restoreLatch = useRef(false);
  // Test APKs (GitHub Releases) can't buy: Pro is sold through the Play Store version only.
  const testBuild = updateSource() !== null;
  // Store rows only where a store answers: not on a build without one, not on a test build.
  const storeRows = client.kind !== "unavailable" && !testBuild;
  // The server doesn't say whether the subscription renews or was cancelled, so the line names both.
  const ends = me.plan === "pro" && me.plan_expires_at ? longDate(me.plan_expires_at) : null;

  async function manage() {
    try {
      await openManageSubscription(client);
    } catch {
      toast.show("Couldn't open Google Play. Open it and go to Subscriptions.");
    }
  }

  async function restore() {
    if (restoreLatch.current) return;
    restoreLatch.current = true;
    setRestoring(true);
    try {
      if (await client.restore()) {
        const synced = await syncPlan();
        if (synced && synced.plan !== "free") {
          haptic.success();
          toast.show("Pro restored");
        } else {
          // The store has the subscription but the server (which enforces the limit) doesn't yet.
          toast.show(PRO_CONFIRMING);
        }
      } else {
        toast.show("We couldn't find a Pro subscription to restore.");
      }
    } catch (e) {
      haptic.error();
      toast.show(e instanceof BillingError ? e.message : "Couldn't restore purchases. Try again.");
    } finally {
      restoreLatch.current = false;
      setRestoring(false);
    }
  }

  const chevron = <Icon name="chevron-right" size={20} color={colors.ink2} />;
  // A build with no store has nothing to restore from.
  const restoreRow = storeRows && (
    <SettingsRow
      icon="refresh"
      title="Restore purchases"
      subtitle={me.plan === "free" ? "Already subscribed? Bring Pro back on this phone" : "Use this after switching phones"}
      onPress={restore}
      right={restoring ? <ActivityIndicator color={colors.ink2} accessibilityLabel="Restoring purchases" /> : chevron}
      divider
    />
  );
  const testBuildNote = testBuild && (
    <View className="mt-4 flex-row items-start rounded-xl bg-raised p-3">
      <Icon name="info-outline" size={20} color={colors.ink2} />
      <Text className="ml-2 flex-1 font-sans text-meta text-ink-2">
        This is a test build. Lately Pro is bought in the Play Store version.
      </Text>
    </View>
  );
  const used = me.saves_this_month;
  const limit = Math.max(me.saves_limit, 1);

  // The calendar while saves are capped by the month, the infinity mark once they aren't.
  const planIcon = me.plan === "free" ? "calendar-today" : "all-inclusive";

  return (
    <SettingsSection icon={planIcon} title={PLAN_TITLE[me.plan]}>
      {me.plan === "free" ? (
        <>
          <Text className="font-sans-semibold text-body text-ink">{`${used} of ${countOf(me.saves_limit, "save")} this month`}</Text>
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: limit, now: Math.min(used, limit) }}
            className="mt-2 h-2 overflow-hidden rounded-full bg-hairline"
          >
            <View className="h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </View>
          <Text className="mt-2 font-sans text-meta text-ink-2">{`Resets on ${shortDate(me.resets_on)}`}</Text>
          {testBuild ? testBuildNote : <Button title="Upgrade to Pro" onPress={() => router.push("/pro")} className="mt-4" />}
          {restoreRow}
        </>
      ) : (
        <>
          <Text className="font-sans-semibold text-body text-ink">Unlimited saves</Text>
          {ends ? <Text className="mt-1 font-sans text-meta text-ink-2">{`Renews or ends on ${ends}`}</Text> : null}
          {me.plan === "pro" ? (
            <>
              {storeRows ? (
                <SettingsRow
                  icon="open-in-new"
                  title="Manage subscription"
                  subtitle="Change or cancel in Google Play"
                  onPress={manage}
                  right={chevron}
                  divider
                />
              ) : null}
              {restoreRow}
              {testBuildNote}
            </>
          ) : null}
        </>
      )}
    </SettingsSection>
  );
}
