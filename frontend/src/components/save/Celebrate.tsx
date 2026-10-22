import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { EASE_OUT, SPRING } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";

/** How far the ring travels past the mark, as a share of the mark's size. */
const RING_GROWTH = 0.6;

/**
 * A marigold check that scales in with a ring that opens out and fades. It marks one moment: the
 * first card a person ever saves turning ready. No confetti, no sound. With Reduce Motion on it
 * is just the check, already in place, and no ring.
 */
export function Celebrate({ size = 56 }: { size?: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.4);
  const ring = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    scale.set(withSpring(1, SPRING.pop));
    ring.set(withDelay(100, withTiming(1, { duration: 620, easing: EASE_OUT })));
  }, [reduced, scale, ring]);

  const markStyle = useAnimatedStyle(() => ({ opacity: Math.min(scale.get() * 2.5, 1), transform: [{ scale: scale.get() }] }));
  // The ring starts as wide as the mark, opens out to RING_GROWTH wider, and is gone by the end.
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 0.7 * (1 - ring.get()),
    transform: [{ scale: 1 + RING_GROWTH * ring.get() }],
  }));

  return (
    // The words next to it say what happened; this is only for the eye.
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Animated.View
        style={[styles.fill, { borderRadius: size / 2, borderWidth: 2, borderColor: colors.accentText }, ringStyle]}
      />
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
          markStyle,
        ]}
      >
        <Icon name="check" size={Math.round(size * 0.55)} color={colors.onAccent} />
      </Animated.View>
    </View>
  );
}

/** The same check, still: "saved", with no ring and no scale. */
export function SavedCheck({ size = 56 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name="check" size={Math.round(size * 0.55)} color={colors.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none" },
});
