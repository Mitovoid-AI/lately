import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { Category } from "../api/contract";
import type { HapticKind } from "../lib/haptics";
import { categoryColor, categoryPill } from "../theme/categories";
import { DURATION, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { PressableScale } from "./motion/PressableScale";

type Shared = {
  onPress?: () => void;
  haptic?: HapticKind;
  /** Layout classes (margins, flex). */
  className?: string;
};

type FilterProps = Shared & {
  variant?: "filter";
  label: string;
  active?: boolean;
  /** A category's dot, shown before the label. `category` fills it in when this is not given. */
  dotColor?: string;
  category?: Category;
};

type CategoryProps = Shared & {
  variant: "category";
  category: Category;
  /** Defaults to the category's name. */
  label?: string;
  size?: PillSize;
};

/**
 * Two kinds of chip. `filter` (the default): a 32 high pill with a raised fill, marigold with
 * on-accent text when active; selecting it dissolves fill, border, text and dot together in
 * 180 ms, and the label keeps the width of its bold form so switching weight never nudges the
 * chips beside it. `category`: the tinted label (category tint, deep ink) used on card detail
 * and search results; static unless it gets an `onPress`.
 */
export function Chip(props: FilterProps | CategoryProps) {
  return props.variant === "category" ? <CategoryPill {...props} /> : <FilterChip {...props} />;
}

function FilterChip({ label, active = false, dotColor, category, onPress, haptic, className = "" }: FilterProps) {
  const { colors, scheme } = useTheme();
  const dot = dotColor ?? (category ? categoryColor(category, scheme) : undefined);
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
    backgroundColor: interpolateColor(on.get(), [0, 1], [dot ?? colors.ink3, colors.onAccentDot]),
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
        {dot ? <Animated.View style={[styles.dot, dotStyle]} /> : null}
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

type PillSize = "sm" | "md";

/**
 * A category as a tinted label: the category's pale tint behind its deep ink (a dark tint and a
 * lifted ink on espresso), 6.7:1 or better in both themes. The colour is wayfinding; the words
 * carry the meaning, so it never relies on hue alone. `sm` (22 high, 11 pt) sits on a card tile;
 * `md` (26 high, 12 pt) on card detail and search results.
 */
export function CategoryPill({
  category,
  label = category,
  size = "md",
  onPress,
  haptic,
  className = "",
  maxFontSizeMultiplier,
}: Omit<CategoryProps, "variant"> & {
  /** A fixed-size host (a tile) caps how far the system text size may grow the label. */
  maxFontSizeMultiplier?: number;
}) {
  const { scheme } = useTheme();
  const { bg, ink } = categoryPill(category, scheme);
  const small = size === "sm";
  const pill = (
    <View style={[styles.tint, small ? styles.tintSm : styles.tintMd, { backgroundColor: bg }]}>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        className="font-sans-semibold"
        style={[small ? styles.labelSm : styles.labelMd, { color: ink }]}
      >
        {label}
      </Text>
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityRole="text" accessibilityLabel={label} className={className}>
        {pill}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic={haptic}
      scaleTo={0.95}
      containerClassName={className}
    >
      {pill}
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
  tint: { alignSelf: "flex-start", justifyContent: "center", borderRadius: 999 },
  tintSm: { height: 22, paddingHorizontal: 8 },
  tintMd: { height: 26, paddingHorizontal: 10 },
  // Android: no font padding, so the label sits optically centred in the pill.
  labelSm: { fontSize: 11, lineHeight: 14, includeFontPadding: false },
  labelMd: { fontSize: 12, lineHeight: 16, includeFontPadding: false },
});
