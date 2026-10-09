import { useEffect, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { haptic as haptics, type HapticKind } from "../../lib/haptics";
import { DURATION, EASE_OUT, SPRING } from "../../theme/motion";

export type PressableScaleProps = Omit<PressableProps, "style" | "children"> & {
  children?: ReactNode;
  /** Classes for the box that scales with the press: background, border, radius, padding. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Layout classes for the touch target itself: flex-1, width, margins. */
  containerClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Scale at full press. Buttons and cards 0.97; small icon targets go deeper. 1 = no scale. */
  scaleTo?: number;
  /** A colour that fades in behind the content while pressed (rows, icon buttons, button press tone). */
  highlightColor?: string;
  /** Inactive look (half opacity), animated in and out. */
  dimmed?: boolean;
  /** Fired with the press, in the same frame as the visual. */
  haptic?: HapticKind;
};

/**
 * The app's one press primitive. Feedback lands on press-in (scale down in ~110 ms), the
 * action commits on release, and the box springs back with a whisper of give. Everything runs
 * on the UI thread; the component never re-renders during a press. With Reduce Motion on, the
 * scale becomes a short opacity dip instead.
 */
export function PressableScale({
  children,
  className,
  style,
  containerClassName,
  containerStyle,
  scaleTo = 0.97,
  highlightColor,
  dimmed = false,
  haptic,
  onPress,
  onPressIn,
  onPressOut,
  hitSlop = 8,
  pressRetentionOffset = 16,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const dim = useSharedValue(dimmed ? 1 : 0);

  useEffect(() => {
    dim.set(withTiming(dimmed ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
  }, [dimmed, dim]);

  const scale = reduced ? 1 : scaleTo;
  const pressFade = reduced && !highlightColor ? 0.2 : 0;

  const boxStyle = useAnimatedStyle(() => {
    const p = pressed.get();
    return {
      opacity: (1 - 0.5 * dim.get()) * (1 - pressFade * Math.max(p, 0)),
      transform: [{ scale: 1 - (1 - scale) * p }],
    };
  });
  const highlightStyle = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(pressed.get(), 0), 1) }));

  function handlePressIn(e: GestureResponderEvent) {
    pressed.set(withTiming(1, { duration: DURATION.press, easing: EASE_OUT }));
    onPressIn?.(e);
  }
  function handlePressOut(e: GestureResponderEvent) {
    pressed.set(withSpring(0, SPRING.release));
    onPressOut?.(e);
  }
  function handlePress(e: GestureResponderEvent) {
    if (haptic) haptics[haptic]();
    onPress?.(e);
  }

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={hitSlop}
      pressRetentionOffset={pressRetentionOffset}
      className={containerClassName}
      style={containerStyle}
    >
      <Animated.View style={[styles.grow, boxStyle]}>
        <View className={className} style={[highlightColor ? styles.clip : null, style]}>
          {highlightColor ? (
            <Animated.View style={[StyleSheet.absoluteFill, styles.passThrough, { backgroundColor: highlightColor }, highlightStyle]} />
          ) : null}
          {children}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  clip: { overflow: "hidden" },
  passThrough: { pointerEvents: "none" },
});
