import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, useReducedMotion, type CSSAnimationKeyframes, type CSSStyle } from "react-native-reanimated";

import { useTheme, type Scheme } from "../theme/ThemeProvider";
import { sheens } from "../theme/tokens";

// A light band sweeping left → right on a 1.2 s loop (the design system's skeleton spec).
// A Reanimated CSS animation: it runs on the UI thread and never touches React.
const SWEEP: CSSAnimationKeyframes = {
  from: { transform: [{ translateX: "-100%" }] },
  to: { transform: [{ translateX: "170%" }] },
};

function bandFor(sheen: string) {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "60%",
    ...(Platform.OS === "web" ? { backgroundImage: sheen } : { experimental_backgroundImage: sheen }),
    animationName: SWEEP,
    animationDuration: "1.2s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  } as CSSStyle<ViewStyle>;
}
const BAND: Record<Scheme, CSSStyle<ViewStyle>> = { light: bandFor(sheens.light), dark: bandFor(sheens.dark) };

/** Loading placeholder: a raised block with a soft shimmer (still when Reduce Motion is on). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const { colors, scheme } = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: colors.raised }, style]}>
      {reduced ? null : <Animated.View style={BAND[scheme]} />}
    </View>
  );
}

/**
 * Wraps a group of skeletons: it fades in only after 150 ms, so a fast load never flashes a
 * placeholder before the real content arrives.
 */
export function SkeletonGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={GROUP_IN} style={style}>
      {children}
    </Animated.View>
  );
}
const GROUP_IN = FadeIn.duration(220).delay(150);

/** A ReelCard-shaped placeholder: square media, two title lines, a meta line. */
function SkeletonCard({ width }: { width: number }) {
  return (
    <View style={{ width }}>
      <Skeleton style={{ aspectRatio: 1, borderRadius: 12 }} />
      <Skeleton style={[styles.line, { marginTop: 10, width: "92%" }]} />
      <Skeleton style={[styles.line, { marginTop: 6, width: "64%" }]} />
      <Skeleton style={[styles.meta, { marginTop: 8, width: "48%" }]} />
    </View>
  );
}

/** A list-row placeholder: small thumbnail, title, a line of chips. */
export function SkeletonRow() {
  return (
    <View className="flex-row py-3">
      <Skeleton style={{ width: 64, aspectRatio: 64 / 80, borderRadius: 10 }} />
      <View className="ml-3 flex-1">
        <Skeleton style={[styles.line, { width: "85%" }]} />
        <Skeleton style={[styles.line, { marginTop: 6, width: "55%" }]} />
        <Skeleton style={[styles.meta, { marginTop: 12, width: "40%", borderRadius: 999 }]} />
      </View>
    </View>
  );
}

/** A grid of card placeholders laid out like the real grid. */
export function SkeletonGrid({
  columns,
  itemWidth,
  rows = 2,
  gap = 12,
  maxWidth = 1280,
}: {
  columns: number;
  itemWidth: number;
  rows?: number;
  gap?: number;
  maxWidth?: number;
}) {
  return (
    <SkeletonGroup style={{ width: "100%", maxWidth, alignSelf: "center", paddingHorizontal: 16, gap: 20, marginTop: 4 }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {Array.from({ length: columns }, (_, c) => (
            <SkeletonCard key={c} width={itemWidth} />
          ))}
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  block: { overflow: "hidden" },
  line: { height: 14, borderRadius: 7 },
  meta: { height: 11, borderRadius: 6 },
});
