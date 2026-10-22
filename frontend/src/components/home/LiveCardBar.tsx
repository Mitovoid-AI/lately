import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { Save } from "../../api/contract";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { Reveal } from "../motion/Reveal";
import { Thumb } from "../Thumb";
import { stepLabel, waitHint } from "./stage";

/** At most this many saves get their own row; the rest are counted. */
export const LIVE_ROWS = 2;

/** A small marigold dot that breathes while a card is being written (still with Reduce Motion). */
function LiveDot() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.set(withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1));
    return () => pulse.set(1);
  }, [reduced, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, marginRight: 8, backgroundColor: colors.accent }, style]} />;
}

function LiveRow({ save, now, onOpen }: { save: Save; now: number; onOpen: (id: string) => void }) {
  const { colors } = useTheme();
  const title = save.title ?? "New reel";
  const step = stepLabel(save.stage);
  const hint = waitHint(save.created_at, now);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${step}, ${hint}`}
      onPress={() => onOpen(save.id)}
      scaleTo={0.985}
      highlightColor={colors.raised}
      className="min-h-[64px] flex-row items-center rounded-2xl border border-hairline bg-card p-2.5"
    >
      <View style={{ width: 44 }}>
        <Thumb uri={save.thumbnail_url} aspect={1} radius={10}>
          {save.thumbnail_url ? null : (
            <View className="absolute inset-0 items-center justify-center">
              <Icon name="link" size={20} color={colors.ink3} />
            </View>
          )}
        </Thumb>
      </View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={1} className="font-sans-semibold text-body text-ink">
          {title}
        </Text>
        <View className="mt-0.5 flex-row items-center">
          <LiveDot />
          <Text numberOfLines={1} className="flex-1 font-sans text-meta text-ink-2">
            {`${step} · ${hint}`}
          </Text>
        </View>
      </View>
      <Icon name="chevron-right" size={18} color={colors.ink3} />
    </PressableScale>
  );
}

/**
 * Cards being written right now, above the grid: one compact row per pending save (two at
 * most, then "+n more"), the step the server is on and an honest wait. Tapping opens the card.
 */
export function LiveCardBar({
  saves,
  now,
  onOpen,
}: {
  saves: readonly Save[];
  now: number;
  onOpen: (id: string) => void;
}) {
  if (saves.length === 0) return null;
  const more = saves.length - LIVE_ROWS;
  return (
    <Reveal>
      <View className="mt-3 gap-2">
        {saves.slice(0, LIVE_ROWS).map((s) => (
          <LiveRow key={s.id} save={s} now={now} onOpen={onOpen} />
        ))}
        {more > 0 ? (
          <Text accessibilityLabel={`${more} more cards on the way`} className="px-1 font-sans-medium text-meta text-ink-2">
            {`+${more} more`}
          </Text>
        ) : null}
      </View>
    </Reveal>
  );
}
