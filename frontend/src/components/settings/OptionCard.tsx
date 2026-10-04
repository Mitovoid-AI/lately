import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { colors } from "../../theme/tokens";
import { Icon } from "../Icon";

/** One of a row of choices (reading font, theme). Selected = raised fill + accent check. */
export function OptionCard({
  selected,
  onPress,
  top,
  label,
  check = false,
}: {
  selected: boolean;
  onPress: () => void;
  top: ReactNode;
  label: string;
  check?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-20 flex-1 justify-center rounded-xl border px-3 py-3 ${
        selected ? "border-ink-3 bg-raised" : "border-hairline bg-canvas"
      }`}
    >
      {check && selected ? (
        <View className="absolute right-2 top-2">
          <Icon name="check-circle-outline" size={18} color={colors.accent} />
        </View>
      ) : null}
      {top}
      <Text className="mt-1 font-sans text-caption text-ink-2">{label}</Text>
    </Pressable>
  );
}
