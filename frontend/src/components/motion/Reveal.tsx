import { useEffect, useState, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT, SPRING, STAGGER_MAX, STAGGER_MS } from "../../theme/motion";

// Entrances are driven by shared values rather than layout `entering` animations: identical on
// iOS, Android and web (Reanimated's web build pins custom entering keyframes in place once
// they finish), and they never re-run on re-render.

/**
 * Content the user is waiting on rises 10 px and fades in, `index` × 40 ms after its
 * siblings. Indexes past the first screenful share the last delay. Only plays on mount.
 */
export function Reveal({
  index = 0,
  enabled = true,
  style,
  children,
}: {
  index?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [animate] = useState(enabled && !reduced);
  const t = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) return;
    const delay = Math.min(index, STAGGER_MAX) * STAGGER_MS;
    t.set(withDelay(delay, withTiming(1, { duration: DURATION.enter, easing: EASE_OUT })));
  }, [animate, index, t]);

  const rise = useAnimatedStyle(() => ({
    opacity: t.get(),
    transform: [{ translateY: 10 * (1 - t.get()) }],
  }));

  return <Animated.View style={[style, rise]}>{children}</Animated.View>;
}

/**
 * A success mark landing: from half size it overshoots a touch and settles. Reserved for rare
 * moments (a save confirmed, an error explained).
 */
export function PopIn({ delay = 120, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduced = useReducedMotion();
  const [animate] = useState(!reduced);
  const scale = useSharedValue(animate ? 0.5 : 1);
  const opacity = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) return;
    opacity.set(withDelay(delay, withTiming(1, { duration: 140, easing: EASE_OUT })));
    scale.set(withDelay(delay, withSpring(1, SPRING.pop)));
  }, [animate, delay, opacity, scale]);

  const pop = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  return <Animated.View style={[style, pop]}>{children}</Animated.View>;
}

/**
 * True for a short window after `key` changes (first data, a new filter, a new query).
 * List rows mounted inside the window stagger in; rows mounted later by scrolling don't,
 * so a virtualized list never flickers as the user scrolls.
 */
export function useEntranceWindow(key: unknown, ready: boolean, ms = 700): boolean {
  const [open, setOpen] = useState(true);
  const [prev, setPrev] = useState(key);
  if (prev !== key) {
    setPrev(key);
    setOpen(true);
  }
  useEffect(() => {
    if (!ready || !open) return;
    const t = setTimeout(() => setOpen(false), ms);
    return () => clearTimeout(t);
  }, [ready, open, ms, key]);
  return open;
}
