import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../../theme/ThemeProvider";
import { Icon, type IconName } from "../Icon";
import { PressableScale } from "../motion/PressableScale";

/** Section heading (display face + accent icon) and its card. */
export function SettingsSection({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center">
        <Icon name={icon} size={22} color={colors.accent} />
        <Text className="ml-2 flex-1 font-display text-ink" style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.3 }}>
          {title}
        </Text>
      </View>
      <View className="rounded-2xl border border-hairline bg-card p-4">{children}</View>
    </View>
  );
}

/**
 * A settings row: icon tile, title + subtitle, and an optional right side. A pressable row
 * doesn't shrink (a full-width row scaling reads as the screen squishing); a raised tint
 * washes in behind it instead.
 */
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
  const { colors } = useTheme();
  return (
    <View className={divider ? "mt-4 border-t border-hairline pt-4" : ""}>
      <PressableScale
        accessibilityRole={onPress ? "button" : undefined}
        disabled={!onPress}
        onPress={onPress}
        scaleTo={1}
        highlightColor={onPress ? colors.raised : undefined}
        className="-m-2 flex-row items-center rounded-xl p-2"
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
      </PressableScale>
      {children}
    </View>
  );
}
