import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import type { HapticKind } from "../lib/haptics";
import type { Palette } from "../theme/tokens";
import { useTheme } from "../theme/ThemeProvider";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./motion/PressableScale";

type Variant = "primary" | "secondary" | "ghost" | "danger";

// Primary is marigold with a near-black label (7.9:1); secondary is outlined in `control`, the
// 3:1 outline tone, because a hairline would vanish against white.
const BOX: Record<Variant, string> = {
  primary: "bg-accent",
  secondary: "bg-card border border-control",
  ghost: "bg-transparent",
  danger: "bg-danger-soft",
};
const LABEL: Record<Variant, string> = {
  primary: "text-on-accent",
  secondary: "text-ink",
  ghost: "text-ink-2",
  danger: "text-danger",
};
const ICON_COLOR: Record<Variant, keyof Palette> = {
  primary: "onAccent",
  secondary: "ink",
  ghost: "ink2",
  danger: "danger",
};
/** The tone each variant deepens to while pressed. */
const PRESSED: Record<Variant, keyof Palette> = {
  primary: "accentPressed",
  secondary: "raised",
  ghost: "raised",
  danger: "dangerPressed",
};

/** The label may grow with the system text size up to here; past it the button wraps rather than balloons. */
const LABEL_MAX_SCALE = 1.5;

// Label ↔ spinner swap: a quick dissolve instead of a hard cut.
const SWAP_IN = FadeIn.duration(150);

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  loading = false,
  size = "md",
  haptic,
  className = "",
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  size?: "md" | "lg";
  haptic?: HapticKind;
  /** Layout classes (margins, width, flex). */
  className?: string;
}) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  // Dissolve only when loading flips, never on the button's first appearance.
  const [prevLoading, setPrevLoading] = useState(loading);
  const [swapped, setSwapped] = useState(false);
  if (prevLoading !== loading) {
    setPrevLoading(loading);
    setSwapped(true);
  }
  const entering = swapped ? SWAP_IN : undefined;
  return (
    <PressableScale
      accessibilityRole="button"
      // The spinner replaces the label while loading; the button keeps its name for a screen reader.
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      haptic={haptic}
      dimmed={disabled && !loading}
      highlightColor={colors[PRESSED[variant]]}
      containerClassName={className}
      // min-h, not h: a label that wraps (big text, a long name) grows the button instead of being clipped.
      className={`${size === "lg" ? "min-h-14 py-4" : "min-h-12 py-3"} flex-row items-center justify-center rounded-ctl px-4 ${BOX[variant]}`}
    >
      {loading ? (
        <Animated.View key="busy" entering={entering}>
          <ActivityIndicator color={colors[ICON_COLOR[variant]]} />
        </Animated.View>
      ) : (
        <Animated.View key="label" entering={entering} style={{ flexShrink: 1 }}>
          <View className="flex-row items-center justify-center">
            {icon ? (
              <View className="mr-2">
                <Icon name={icon} size={20} color={colors[ICON_COLOR[variant]]} />
              </View>
            ) : null}
            <Text
              maxFontSizeMultiplier={LABEL_MAX_SCALE}
              className={`shrink text-center font-sans-semibold text-body ${LABEL[variant]}`}
            >
              {title}
            </Text>
          </View>
        </Animated.View>
      )}
    </PressableScale>
  );
}
