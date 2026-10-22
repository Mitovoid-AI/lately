import { Tabs } from "expo-router";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { haptic } from "../lib/haptics";
import { DURATION, EASE_IN_OUT, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import type { IconName } from "./Icon";
import { Icon } from "./Icon";
import { AnimatedIcon } from "./motion/AnimatedIcon";
import { PressableScale } from "./motion/PressableScale";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Home, Search, Save, Stacks. The active place swaps to its filled twin and takes the accent
// ink; the marker above it slides along.
const ICONS: Record<string, { name: IconName; active?: IconName }> = {
  index: { name: "home", active: "home-filled" },
  search: { name: "search", active: "search-filled" },
  save: { name: "add" },
  stacks: { name: "folder-special", active: "folder-special-filled" },
};
const MARK_W = 20;
/** Bar height above the home indicator (native tab bars are 49-56 pt). */
export const TAB_BAR_HEIGHT = 56;
/** On a tablet the four tabs stay a phone-sized group in the middle, not spread across the screen. */
const BAR_MAX_WIDTH = 640;
/** Labels grow with the text size, but not past this: at 2x the fourth tab would leave the bar. */
const LABEL_MAX_SCALE = 1.2;

function TabItem({
  label,
  icon,
  focused,
  action = false,
  onPress,
  onLayout,
}: {
  label: string;
  icon: { name: IconName; active?: IconName };
  focused: boolean;
  /** An action tab (Save) is never "selected": it shows as a marigold plus and opens a sheet. */
  action?: boolean;
  onPress: () => void;
  onLayout: (x: number, width: number) => void;
}) {
  const { colors } = useTheme();
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(focused ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
  }, [focused, on]);
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(on.get(), [0, 1], [colors.ink2, colors.accentText]) }));

  return (
    <PressableScale
      accessibilityRole={action ? "button" : "tab"}
      accessibilityState={action ? undefined : { selected: focused }}
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.9}
      onLayout={(e) => onLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.width)}
      className="min-h-12 min-w-16 items-center justify-center"
    >
      {/* Every icon sits in the same 32 x 56 slot, so all four labels share one baseline. */}
      {action ? (
        // The one filled shape in the bar: saving is what Lately is for.
        <View className="h-8 w-14 items-center justify-center rounded-full bg-accent">
          <Icon name={icon.name} size={24} color={colors.onAccent} />
        </View>
      ) : (
        <View className="h-8 w-14 items-center justify-center">
          <AnimatedIcon
            active={focused}
            name={icon.name}
            activeName={icon.active ?? icon.name}
            color={colors.ink2}
            activeColor={colors.accentText}
            size={23}
          />
        </View>
      )}
      <Animated.Text
        maxFontSizeMultiplier={LABEL_MAX_SCALE}
        style={[styles.label, focused ? styles.labelOn : null, labelStyle]}
      >
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

/**
 * On Android the window shrinks for the keyboard, which would lift this bar to sit on top of it
 * and eat the space the Search tab needs. True while the keyboard is up (Android only: iOS
 * keeps the bar under the keyboard).
 */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * Bottom tabs: Home, Search, Save, Stacks. Save is an action (a marigold plus that opens the
 * save sheet), the other three are places.
 * Tabs are peers, so the screens swap without sliding; the bar itself answers the tap:
 * the icon dips, its colour dissolves to marigold and a short marker glides to it.
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const { colors } = useTheme();
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const markX = useSharedValue(0);
  const markOn = useSharedValue(0);
  const placed = useRef(false);
  const keyboardOpen = useKeyboardOpen();
  const reduced = useReducedMotion();
  const activeKey = state.routes[state.index]?.key;

  useEffect(() => {
    const l = activeKey ? layouts[activeKey] : undefined;
    if (!l) return;
    const target = l.x + l.width / 2 - MARK_W / 2;
    if (!placed.current) {
      placed.current = true;
      markX.set(target);
      markOn.set(reduced ? 1 : withTiming(1, { duration: DURATION.enter, easing: EASE_OUT }));
      return;
    }
    // Reduce Motion: the marker jumps to the new tab instead of gliding.
    markX.set(reduced ? target : withTiming(target, { duration: 260, easing: EASE_IN_OUT }));
  }, [activeKey, layouts, markX, markOn, reduced]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOn.get(),
    transform: [{ translateX: markX.get() }],
  }));

  if (keyboardOpen) return null;

  return (
    <View
      className="border-t border-hairline bg-canvas"
      style={{ paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }}
    >
      <View
        className="w-full flex-1 flex-row items-center justify-around self-center"
        style={{ maxWidth: BAR_MAX_WIDTH }}
      >
        <Animated.View style={[styles.mark, { backgroundColor: colors.accent }, markStyle]} />
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = descriptors[route.key].options.title ?? route.name;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            // Save is an action (light tap); switching tabs is navigation, which stays silent.
            if (route.name === "save") haptic.light();
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };
          return (
            <TabItem
              key={route.key}
              label={label}
              icon={ICONS[route.name] ?? { name: "circle" }}
              focused={focused}
              action={route.name === "save"}
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
  },
  label: { marginTop: 3, fontFamily: "Inter_500Medium", fontSize: 11, lineHeight: 13 },
  labelOn: { fontFamily: "Inter_600SemiBold" },
});
