import { Text, View } from "react-native";

import { countOf } from "../../lib/counts";
import { useTheme } from "../../theme/ThemeProvider";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { IconButton } from "../motion/IconButton";
import { PressableScale } from "../motion/PressableScale";
import { Reveal } from "../motion/Reveal";

/** "1 save needs another try", "2 saves need another try". */
export const attentionText = (count: number) => `${countOf(count, "save")} ${count === 1 ? "needs" : "need"} another try`;

/**
 * Saves whose cards came out partial or never finished: tapping it shows just those saves, the
 * cross hides it. Only saves another try could help are counted (the caller decides which).
 */
export function AttentionBanner({ count, onShow, onDismiss }: { count: number; onShow: () => void; onDismiss: () => void }) {
  const { colors } = useTheme();
  return (
    <Reveal>
      <View className="mt-3 flex-row items-center rounded-2xl border border-hairline bg-card pr-1">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${attentionText(count)}. Show ${count === 1 ? "it" : "them"}`}
          onPress={onShow}
          scaleTo={0.98}
          highlightColor={colors.raised}
          containerClassName="flex-1"
          className="min-h-14 flex-row items-center rounded-2xl py-2 pl-4 pr-2"
        >
          <Icon name="refresh" size={22} color={colors.ink2} />
          <View className="ml-3 flex-1">
            <Text className="font-sans-semibold text-body text-ink">{attentionText(count)}</Text>
            <Text className="font-sans text-meta text-ink-2">{`Tap to see ${count === 1 ? "it" : "them"}.`}</Text>
          </View>
        </PressableScale>
        <IconButton icon="close" size={20} label="Hide this notice" onPress={onDismiss} />
      </View>
    </Reveal>
  );
}

/** Saves made offline, waiting on the device for a connection. */
export function QueuedBanner({ count, busy, onRetry }: { count: number; busy: boolean; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <Reveal>
      <View className="mt-3 flex-row items-center rounded-2xl border border-hairline bg-card py-2 pl-4 pr-2">
        <Icon name="cloud-upload" size={22} color={colors.ink2} />
        <View className="ml-3 flex-1">
          <Text className="font-sans-semibold text-body text-ink">{`${countOf(count, "reel")} waiting to save`}</Text>
          <Text className="font-sans text-meta text-ink-2">
            {`Lately will send ${count === 1 ? "it" : "them"} as soon as it can.`}
          </Text>
        </View>
        <Button title="Retry" variant="ghost" onPress={onRetry} loading={busy} />
      </View>
    </Reveal>
  );
}

/** How few free saves left makes Home mention Pro. */
export const QUOTA_BANNER_AT = 3;

/** The free plan running low: a slim nudge toward Pro (never shown on Pro or Lifetime). */
export function QuotaBanner({ left, onUpgrade }: { left: number; onUpgrade: () => void }) {
  const { colors } = useTheme();
  return (
    <Reveal>
      <View className="mt-3 flex-row items-center rounded-2xl border border-hairline bg-card py-1 pl-4 pr-2">
        <Icon name={left > 0 ? "info-outline" : "lock-outline"} size={20} color={colors.ink2} />
        <Text className="ml-3 flex-1 font-sans-semibold text-body text-ink">
          {left > 0 ? `${countOf(left, "free save")} left this month` : "You've used this month's free saves"}
        </Text>
        <Button title="Upgrade to Pro" variant="ghost" onPress={onUpgrade} />
      </View>
    </Reveal>
  );
}
