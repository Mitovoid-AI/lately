import { Text, View } from "react-native";

import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import type { Fact } from "./facts";

/**
 * The few things worth knowing before reading on: where, how much, one tip. Plain chips, not
 * buttons (Directions in the action bar is the place's tap target).
 */
export function FactChips({ facts }: { facts: Fact[] }) {
  const { colors } = useTheme();
  if (facts.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {facts.map((fact) => (
        <View
          key={fact.kind}
          className="h-8 max-w-full flex-row items-center rounded-full border border-hairline bg-raised px-3"
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
