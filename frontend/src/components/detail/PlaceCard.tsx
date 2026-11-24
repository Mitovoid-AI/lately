import { Linking, Text, View } from "react-native";

import type { Place } from "../../api/contract";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { mapsUrl } from "./facts";

/**
 * A place's name and address; tapping it opens that place in Maps (the same link Directions
 * uses), so every place on a card is one tap from Maps, not only the first.
 */
export function PlaceCard({ place }: { place: Place }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`${place.name}, ${place.address}`}
      accessibilityHint="Opens it in Maps"
      onPress={() => Linking.openURL(mapsUrl(place))}
      scaleTo={0.98}
      highlightColor={colors.raised}
      className="flex-row items-center rounded-2xl border border-hairline bg-card p-4"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
        <Icon name="place" size={20} color={colors.ink2} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-sans-semibold text-body text-ink">{place.name}</Text>
        <Text className="font-sans text-meta text-ink-2">{place.address}</Text>
      </View>
      <View className="ml-2">
        <Icon name="open-in-new" size={18} color={colors.ink2} />
      </View>
    </PressableScale>
  );
}
