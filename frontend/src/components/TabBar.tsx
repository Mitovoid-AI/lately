import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, IconName> = {
  curated: "auto-stories",
  index: "grid-view",
  save: "add-circle-outline",
  stacks: "folder-special",
};

/** Bottom tabs from "02 Library — light": Curated · Library · Save · Stacks. */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  return (
    <View
      className="flex-row items-center justify-around border-t border-hairline bg-canvas"
      style={{ paddingBottom: insets.bottom, height: 64 + insets.bottom }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = descriptors[route.key].options.title ?? route.name;
        const color = focused ? colors.accent : colors.ink2;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={onPress}
            className="min-h-12 min-w-14 items-center justify-center"
          >
            <Icon name={ICONS[route.name] ?? "circle"} size={24} color={color} />
            <Text className={`mt-1 text-caption ${focused ? "font-sans-semibold text-accent" : "font-sans text-ink-2"}`}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
