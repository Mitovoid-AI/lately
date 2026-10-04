import { ActivityIndicator, Text, View } from "react-native";

import { colors } from "../../theme/tokens";
import { Icon } from "../Icon";

const STEPS = ["Saved", "Getting the preview", "Writing the summary"];

/** Processing card: Saved ✓ → Getting the preview (spinner) → Writing the summary. */
export function ProgressTracker({ current = 1 }: { current?: number }) {
  return (
    <View className="rounded-2xl border border-hairline bg-card p-4">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={label} className={`flex-row items-center ${i > 0 ? "mt-4" : ""}`}>
            <View className="h-6 w-6 items-center justify-center">
              {done ? (
                <Icon name="check-circle" size={22} color={colors.accent} />
              ) : active ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Icon name="radio-button-unchecked" size={22} color={colors.ink3} />
              )}
            </View>
            <Text
              className={`ml-3 text-body ${done ? "font-sans-medium text-ink" : active ? "font-sans-semibold text-ink" : "font-sans text-ink-3"}`}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
