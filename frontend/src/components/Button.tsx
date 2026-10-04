import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { colors } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BOX: Record<Variant, string> = {
  primary: "bg-accent",
  secondary: "bg-card border border-hairline",
  ghost: "bg-transparent",
  danger: "bg-danger-soft",
};
const LABEL: Record<Variant, string> = {
  primary: "text-on-accent",
  secondary: "text-ink",
  ghost: "text-ink-2",
  danger: "text-danger",
};
const ICON_COLOR: Record<Variant, string> = {
  primary: colors.onAccent,
  secondary: colors.ink,
  ghost: colors.ink2,
  danger: colors.danger,
};

export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  loading = false,
  className = "",
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      className={`h-12 flex-row items-center justify-center rounded-ctl px-4 ${BOX[variant]} ${
        inactive ? "opacity-50" : "active:opacity-80"
      } ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={ICON_COLOR[variant]} />
      ) : (
        <View className="flex-row items-center">
          {icon ? (
            <View className="mr-2">
              <Icon name={icon} size={20} color={ICON_COLOR[variant]} />
            </View>
          ) : null}
          <Text className={`font-sans-semibold text-body ${LABEL[variant]}`}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}
