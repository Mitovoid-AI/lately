import { useEffect, useMemo, type ComponentProps, type ReactNode } from "react";
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { haptic } from "../lib/haptics";
import { colors } from "../theme/tokens";
import { DURATION, EASE_OUT, EASE_SHEET, SPRING } from "../theme/motion";
import { project, rubberband } from "./motion/physics";
import { usePresence } from "./motion/usePresence";

export const BACKDROP = "rgba(28,26,23,0.35)";

export type SheetMotion = {
  /** 0 = off screen, 1 = presented. */
  progress: SharedValue<number>;
  /** How far the finger has pulled the sheet down, in px. */
  drag: SharedValue<number>;
  /** The panel's measured height. */
  height: SharedValue<number>;
};

function useSheetValues(): SheetMotion {
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const height = useSharedValue(Dimensions.get("window").height);
  return useMemo(() => ({ progress, drag, height }), [progress, drag, height]);
}

/** Shared values for one sheet, plus a backdrop style that dims with it and lifts as it is dragged. */
export function useSheetMotion() {
  const motion = useSheetValues();
  const { progress, drag, height } = motion;
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * interpolate(drag.get(), [0, height.get()], [1, 0], Extrapolation.CLAMP),
  }));
  return { motion, backdropStyle };
}

const snappedHome = () => haptic.light();

/** Height changes ease over 260 ms; the skirt below the card hides the moving edge. */
export const SHEET_RESIZE = LinearTransition.duration(260).easing(EASE_OUT);

/**
 * The sheet card: 24 px top corners and a drag handle. It rises on the iOS sheet curve, and a
 * downward drag or flick dismisses it (velocity decides, not just distance); let go short and it
 * springs home with the finger's velocity. Without `motion` it animates itself in on mount.
 */
export function SheetPanel({
  children,
  motion,
  onDismiss,
  layout,
}: {
  children: ReactNode;
  motion?: SheetMotion;
  onDismiss?: () => void;
  /** A layout transition, so the sheet eases to a new height when its content changes. */
  layout?: ComponentProps<typeof Animated.View>["layout"];
}) {
  const insets = useSafeAreaInsets();
  const own = useSheetValues();
  const { progress, drag, height } = motion ?? own;
  const start = useSharedValue(0);

  useEffect(() => {
    if (!motion) progress.set(withTiming(1, { duration: DURATION.sheet, easing: EASE_SHEET }));
  }, [motion, progress]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!onDismiss)
        .activeOffsetY([-10, 10])
        .failOffsetX([-24, 24])
        .onStart(() => {
          start.set(drag.get());
        })
        .onUpdate((e) => {
          const next = start.get() + e.translationY;
          drag.set(next >= 0 ? next : rubberband(next, height.get()));
        })
        .onEnd((e) => {
          const h = height.get();
          const pulled = drag.get();
          if (pulled + project(e.velocityY) > h * 0.4) {
            drag.set(withSpring(h, { ...SPRING.sheet, dampingRatio: 1, velocity: e.velocityY, overshootClamping: true }));
            if (onDismiss) scheduleOnRN(onDismiss);
          } else {
            drag.set(withSpring(0, { ...SPRING.sheet, velocity: e.velocityY }));
            if (pulled > 24) scheduleOnRN(snappedHome);
          }
        }),
    [onDismiss, start, drag, height],
  );

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * height.get() + drag.get() }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        layout={layout}
        onLayout={(e) => height.set(e.nativeEvent.layout.height)}
        style={[styles.panel, panelStyle]}
      >
        {/* Card-coloured skirt below the sheet: no gap shows while it resizes or is pulled up. */}
        <View style={styles.skirt} />
        <View
          className="w-full rounded-t-sheet border-t border-hairline bg-card px-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <View className="mb-4 mt-3 h-1 w-9 self-center rounded-full bg-hairline" />
          {children}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Bottom sheet in a modal: a backdrop that dims in step with the sheet (tap to close) + SheetPanel. */
export function Sheet({
  visible,
  onClose,
  fluid = false,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Ease the sheet's height when its content changes (e.g. a list turning into a form). */
  fluid?: boolean;
  children: ReactNode;
}) {
  const { motion, backdropStyle } = useSheetMotion();
  const mounted = usePresence(visible, motion.progress);
  if (!visible && !mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      {/* Gestures need their own root inside a Modal on Android. */}
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.end}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: BACKDROP }, backdropStyle]}>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.fill} />
          </Animated.View>
          <SheetPanel motion={motion} onDismiss={onClose} layout={fluid ? SHEET_RESIZE : undefined}>
            {children}
          </SheetPanel>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  end: { flex: 1, justifyContent: "flex-end" },
  panel: { width: "100%", maxWidth: 560, alignSelf: "center" },
  skirt: { pointerEvents: "none", position: "absolute", left: 0, right: 0, top: "50%", height: 1200, backgroundColor: colors.card },
});
