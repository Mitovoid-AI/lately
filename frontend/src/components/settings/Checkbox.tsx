import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";

/** Marigold checkbox: the fill floods in and the tick springs up from 60%. */
export function Checkbox({ checked, disabled = false, label }: { checked: boolean; disabled?: boolean; label?: string }) {
  const { colors } = useTheme();
  const on = useSharedValue(checked ? 1 : 0);
  const tick = useSharedValue(checked ? 1 : 0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    on.set(withTiming(checked ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
    tick.set(checked ? withSpring(1, { duration: 360, dampingRatio: 0.6 }) : withTiming(0, { duration: 120, easing: EASE_OUT }));
  }, [checked, on, tick]);

  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [colors.card, colors.accent]),
    borderColor: interpolateColor(on.get(), [0, 1], [colors.hairline, colors.accent]),
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: Math.min(tick.get(), 1),
    transform: [{ scale: 0.6 + 0.4 * tick.get() }],
  }));

  return (
    <Animated.View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      style={[styles.box, boxStyle]}
    >
      <Animated.View style={tickStyle}>
        <Icon name="check" size={16} color={colors.onAccent} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
