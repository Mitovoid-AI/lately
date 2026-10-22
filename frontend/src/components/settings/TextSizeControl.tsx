import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { Preferences } from "../../api/contract";
import { haptic } from "../../lib/haptics";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";

type Size = Preferences["text_size"];

const STOP = 32;
const THUMB = 20;

/**
 * The A — A text-size track: four stops and one thumb that glides to the chosen stop
 * (ease-in-out, 240 ms) with a selection tick.
 *
 * To a screen reader it is one adjustable control ("Text size, Default": swipe up or down to
 * change it), not four unlabelled buttons. The stops stay tappable for everyone else. The size
 * name sits beside the title in Account; the track has no second row of labels.
 */
export function TextSizeControl({
  sizes,
  value,
  onChange,
}: {
  sizes: { size: Size; name: string }[];
  value: Size;
  onChange: (size: Size) => void;
}) {
  const { colors, shadows } = useTheme();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const shown = useSharedValue(0);
  const placed = useRef(false);
  const index = Math.max(0, sizes.findIndex((s) => s.size === value));

  useEffect(() => {
    if (!width) return;
    const step = (width - STOP) / (sizes.length - 1);
    const target = index * step + (STOP - THUMB) / 2;
    if (!placed.current) {
      placed.current = true;
      x.set(target);
      shown.set(withTiming(1, { duration: DURATION.state, easing: EASE_OUT }));
      return;
    }
    x.set(withTiming(target, { duration: 240, easing: EASE_IN_OUT }));
  }, [index, width, sizes.length, x, shown]);

  const thumbStyle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateX: x.get() }] }));

  function pick(size: Size) {
    if (size === value) return;
    haptic.selection();
    onChange(size);
  }

  /** One step along the sizes (the adjustable control's increment and decrement). */
  function nudge(by: 1 | -1) {
    const next = sizes[Math.min(sizes.length - 1, Math.max(0, index + by))];
    if (next) pick(next.size);
  }

  return (
    <View className="mt-4 flex-row items-center">
      <Text
        accessible={false}
        importantForAccessibility="no"
        className="font-newsreader text-ink-2"
        style={{ fontSize: 18 }}
      >
        A
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Text size"
        accessibilityValue={{ text: sizes[index]?.name }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}
        className="mx-3 h-8 flex-1 justify-center"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View className="h-1.5 rounded-full bg-hairline" />
        <Animated.View style={[styles.thumb, { backgroundColor: colors.accentText, boxShadow: shadows.raised }, thumbStyle]} />
        <View className="absolute inset-0 flex-row items-center justify-between">
          {sizes.map((s) => (
            <Pressable
              key={s.size}
              testID={`text-size-${s.size}`}
              accessible={false}
              importantForAccessibility="no"
              onPress={() => pick(s.size)}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center"
            >
              {s.size === value ? null : <View className="h-2.5 w-2.5 rounded-full bg-control" />}
            </Pressable>
          ))}
        </View>
      </View>
      <Text
        accessible={false}
        importantForAccessibility="no"
        className="font-newsreader text-ink"
        style={{ fontSize: 28 }}
      >
        A
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    pointerEvents: "none",
    position: "absolute",
    left: 0,
    top: (STOP - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
  },
});
