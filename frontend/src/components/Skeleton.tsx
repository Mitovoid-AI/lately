import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "../theme/tokens";

/** Loading placeholder: raised → hairline pulse on a 1.2 s loop (still when reduced motion is on). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (reduced || cancelled) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(t, { toValue: 1, duration: 600, useNativeDriver: false }),
            Animated.timing(t, { toValue: 0, duration: 600, useNativeDriver: false }),
          ]),
        );
        loop.start();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [t]);
  const backgroundColor = t.interpolate({ inputRange: [0, 1], outputRange: [colors.raised, colors.hairline] });
  return <Animated.View style={[{ backgroundColor }, style]} />;
}
