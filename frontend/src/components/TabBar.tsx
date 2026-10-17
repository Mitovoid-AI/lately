import { Tabs } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { haptic } from "../lib/haptics";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../theme/motion";
import { colors } from "../theme/tokens";
import type { IconName } from "./Icon";
import { AnimatedIcon } from "./motion/AnimatedIcon";
import { PressableScale } from "./motion/PressableScale";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, { name: IconName; active?: IconName }> = {
  curated: { name: "auto-stories" },
  index: { name: "grid-view" },
  save: { name: "add-circle-outline", active: "add-circle" },
  stacks: { name: "folder-special" },
};
const MARK_W = 20;
/** Bar height above the home indicator (native tab bars are 49-56 pt). */
export const TAB_BAR_HEIGHT = 56;

function TabItem({
  label,
  icon,
  focused,
  onPress,
  onLayout,
}: {
  label: string;
  icon: { name: IconName; active?: IconName };
  focused: boolean;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
}) {
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(focused ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
  }, [focused, on]);
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(on.get(), [0, 1], [colors.ink2, colors.accent]) }));

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.9}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      className="min-h-12 min-w-16 items-center justify-center"
    >
      <AnimatedIcon
        active={focused}
        name={icon.name}
        activeName={icon.active ?? icon.name}
        color={colors.ink2}
        activeColor={colors.accent}
        size={24}
      />
      <Animated.Text style={[styles.label, focused ? styles.labelOn : null, labelStyle]}>{label}</Animated.Text>
    </PressableScale>
  );
}

/**
 * Bottom tabs from "02 Library — light": Curated · Library · Save · Stacks.
 * Tabs are peers, so the screens swap without sliding; the bar itself answers the tap:
 * the icon dips, its colour dissolves to marigold and a short marker glides to it.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const markX = useSharedValue(0);
  const markOn = useSharedValue(0);
  const placed = useRef(false);
  const activeKey = state.routes[state.index]?.key;

  useEffect(() => {
    const l = activeKey ? layouts[activeKey] : undefined;
    if (!l) return;
    const target = l.x + l.width / 2 - MARK_W / 2;
    if (!placed.current) {
      placed.current = true;
      markX.set(target);
      markOn.set(withTiming(1, { duration: DURATION.enter, easing: EASE_OUT }));
      return;
    }
    markX.set(withTiming(target, { duration: 260, easing: EASE_IN_OUT }));
  }, [activeKey, layouts, markX, markOn]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOn.get(),
    transform: [{ translateX: markX.get() }],
  }));

  return (
    <View
      className="flex-row items-center justify-around border-t border-hairline bg-canvas"
      style={{ paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }}
    >
      <Animated.View style={[styles.mark, markStyle]} />
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = descriptors[route.key].options.title ?? route.name;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (route.name === "save") haptic.light();
          else if (!focused) haptic.selection();
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TabItem
            key={route.key}
            label={label}
            icon={ICONS[route.name] ?? { name: "circle" }}
            focused={focused}
            onPress={onPress}
            onLayout={(x, width) =>
              setLayouts((prev) =>
                prev[route.key]?.x === x && prev[route.key]?.width === width ? prev : { ...prev, [route.key]: { x, width } },
              )
            }
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    pointerEvents: "none",
    position: "absolute",
    top: -1,
    left: 0,
    width: MARK_W,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  label: { marginTop: 3, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 13 },
  labelOn: { fontFamily: "Inter_600SemiBold" },
});
