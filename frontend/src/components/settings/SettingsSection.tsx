import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "../../theme/tokens";
import { Icon, type IconName } from "../Icon";

/** Section heading (Newsreader + accent icon) and its white card. */
export function SettingsSection({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center">
        <Icon name={icon} size={22} color={colors.accent} />
        <Text className="ml-2 flex-1 font-display text-ink" style={{ fontSize: 20, lineHeight: 26 }}>
          {title}
        </Text>
      </View>
      <View className="rounded-2xl border border-hairline bg-card p-4">{children}</View>
    </View>
  );
}

/** A settings row: icon tile, title + subtitle, and an optional right side. */
export function SettingsRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  children,
  divider = false,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  right?: ReactNode;
  onPress?: () => void;
  children?: ReactNode;
  divider?: boolean;
}) {
  return (
    <View className={divider ? "mt-4 border-t border-hairline pt-4" : ""}>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        disabled={!onPress}
        onPress={onPress}
        className="flex-row items-center active:opacity-80"
      >
        <View className="h-11 w-11 items-center justify-center rounded-xl bg-raised">
          <Icon name={icon} size={20} color={colors.ink2} />
        </View>
        <View className="ml-3 flex-1">
          <Text className="font-sans-semibold text-body text-ink">{title}</Text>
          <Text numberOfLines={1} className="font-sans text-meta text-ink-2">
            {subtitle}
          </Text>
        </View>
        {right}
      </Pressable>
      {children}
    </View>
  );
}
