import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";

import { DURATION, EASE_OUT, SPRING } from "../../theme/motion";
import { Icon, type IconName } from "../Icon";

/**
 * Two layered icons that crossfade when `active` flips: outline ↔ filled, grey ↔ marigold.
 * Opacity and scale only, on the UI thread. `pop` adds a springy landing when it turns on
 * (save and bookmark moments, not tabs).
 */
export function AnimatedIcon({
  active,
  name,
  activeName = name,
  color,
  activeColor,
  size = 22,
  pop = false,
}: {
  active: boolean;
  name: IconName;
  activeName?: IconName;
  color: string;
  activeColor: string;
  size?: number;
  pop?: boolean;
}) {
  const on = useSharedValue(active ? 1 : 0);
  const bump = useSharedValue(1);
  const first = useRef(true);

  useEffect(() => {
    on.set(withTiming(active ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
    if (first.current) {
      first.current = false;
      return;
    }
    if (pop && active) bump.set(withSequence(withTiming(0.7, { duration: 90, easing: EASE_OUT }), withSpring(1, SPRING.pop)));
  }, [active, pop, on, bump]);

  const offStyle = useAnimatedStyle(() => ({ opacity: 1 - on.get() }));
  const onStyle = useAnimatedStyle(() => ({
    opacity: on.get(),
    transform: [{ scale: (0.85 + 0.15 * on.get()) * bump.get() }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, offStyle]}>
        <Icon name={name} size={size} color={color} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, onStyle]}>
        <Icon name={activeName} size={size} color={activeColor} />
      </Animated.View>
    </View>
  );
}
