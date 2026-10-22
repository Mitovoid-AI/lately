import { Text, View } from "react-native";

import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import type { Fact } from "./facts";

/**
 * The few things worth knowing before reading on: where, how much, one tip. Plain chips, not
 * buttons (Directions in the action bar is the place's tap target), so they are fill only: a
 * border would make them look tappable. They are at least 32 high and grow with the text size.
 */
export function FactChips({ facts }: { facts: Fact[] }) {
  const { colors } = useTheme();
  if (facts.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {facts.map((fact) => (
        <View
          key={fact.kind}
          className="min-h-8 max-w-full flex-row items-center rounded-full bg-raised px-3 py-1"
        >
          {fact.kind === "place" ? (
            <View className="mr-1.5">
              <Icon name="place" size={14} color={colors.ink2} />
            </View>
          ) : null}
          <Text numberOfLines={1} className="shrink font-sans-medium text-meta text-ink">
            {fact.text}
          </Text>
        </View>
      ))}
    </View>
  );
}
