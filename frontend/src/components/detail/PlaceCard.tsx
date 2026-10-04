import { Linking, Pressable, Text, View } from "react-native";

import type { Place } from "../../api/contract";
import { colors } from "../../theme/tokens";
import { Icon } from "../Icon";

export function mapsUrl(place: Place): string {
  return (
    place.maps_url ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.name}, ${place.address}`)}`
  );
}

export function PlaceCard({ place }: { place: Place }) {
  return (
    <View className="flex-row items-center rounded-2xl border border-hairline bg-card p-4">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
        <Icon name="place" size={20} color={colors.accent} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-sans-semibold text-body text-ink">{place.name}</Text>
        <Text className="font-sans text-meta text-ink-2">{place.address}</Text>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(mapsUrl(place))}
        className="h-10 items-center justify-center rounded-ctl border border-accent px-3 active:bg-raised"
      >
        <Text className="font-sans-semibold text-meta text-accent">Open in Maps</Text>
      </Pressable>
    </View>
  );
}
