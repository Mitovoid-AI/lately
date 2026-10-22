import { Linking, Text, View } from "react-native";

import type { Place } from "../../api/contract";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";
import { mapsUrl } from "./facts";

export function PlaceCard({ place }: { place: Place }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center rounded-2xl border border-hairline bg-card p-4">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
        <Icon name="place" size={20} color={colors.accentText} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-sans-semibold text-body text-ink">{place.name}</Text>
        <Text className="font-sans text-meta text-ink-2">{place.address}</Text>
      </View>
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={`Open ${place.name} in Maps`}
        onPress={() => Linking.openURL(mapsUrl(place))}
        highlightColor={colors.raised}
        className="ml-2 h-11 items-center justify-center rounded-ctl border border-accent-text px-3"
      >
        <Text className="font-sans-semibold text-meta text-accent-text">Open in Maps</Text>
      </PressableScale>
    </View>
  );
}
