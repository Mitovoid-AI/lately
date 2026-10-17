import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { HapticKind } from "../lib/haptics";
import { DURATION, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { PressableScale } from "./motion/PressableScale";

/**
 * Pill chip: 32 high, raised fill; active = marigold with on-accent text. Selecting it dissolves
 * fill, border, text and dot together in 180 ms. The label keeps the width of its bold form,
 * so switching weight never nudges the chips beside it.
 */
export function Chip({
  label,
  active = false,
  dotColor,
  onPress,
  haptic,
  className = "",
}: {
  label: string;
  active?: boolean;
  dotColor?: string;
  onPress?: () => void;
  haptic?: HapticKind;
  className?: string;
}) {
  const { colors } = useTheme();
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(active ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
  }, [active, on]);

  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [colors.raised, colors.accent]),
    borderColor: interpolateColor(on.get(), [0, 1], [colors.hairline, colors.accent]),
  }));
  const textStyle = useAnimatedStyle(() => ({
    color: interpolateColor(on.get(), [0, 1], [colors.ink, colors.onAccent]),
  }));
  const dotStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [dotColor ?? colors.ink3, colors.onAccentDot]),
  }));

  return (
    <PressableScale
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      disabled={!onPress}
      onPress={onPress}
      haptic={active ? undefined : haptic}
      scaleTo={0.95}
      containerClassName={className}
    >
      <Animated.View style={[styles.pill, pillStyle]}>
        {dotColor ? <Animated.View style={[styles.dot, dotStyle]} /> : null}
        <View>
          {/* Sizer: reserves the semibold width; hidden from screen readers and queries. */}
          <Text aria-hidden className="font-sans-semibold text-meta opacity-0">
            {label}
          </Text>
          <View style={StyleSheet.absoluteFill} className="items-center justify-center">
            <Animated.Text numberOfLines={1} style={[active ? styles.bold : styles.medium, textStyle]}>
              {label}
            </Animated.Text>
          </View>
        </View>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  // Animated.Text takes no className, so the type comes from the same tokens as `text-meta`.
  medium: { fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18 },
  bold: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
});
