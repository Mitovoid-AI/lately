import { useCallback } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { haptic } from "../../lib/haptics";
import { EASE_OUT, SPRING } from "../../theme/motion";

/** A one-shot "landed" bump: dip, then spring past 1 and settle. For success moments only. */
export function usePop() {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const pop = useCallback(
    (delay = 0) => {
      scale.set(
        withDelay(delay, withSequence(withTiming(0.72, { duration: 90, easing: EASE_OUT }), withSpring(1, SPRING.pop))),
      );
    },
    [scale],
  );
  return { style, pop };
}

/** A short horizontal shake with an error haptic: "that didn't work". */
export function useShake() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const shake = useCallback(() => {
    haptic.error();
    x.set(
      withSequence(
        withTiming(-8, { duration: 45, easing: EASE_OUT }),
        withTiming(8, { duration: 70, easing: EASE_OUT }),
        withTiming(-5, { duration: 60, easing: EASE_OUT }),
        withTiming(4, { duration: 55, easing: EASE_OUT }),
        withSpring(0, SPRING.settle),
      ),
    );
  }, [x]);
  return { style, shake };
}
