import { Text, View } from "react-native";

import type { Place } from "../../api/contract";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";

/**
 * A place's name and address. It is information, not a control: Directions in the action bar is
 * the one way into Maps, so the same action is not offered a second and third time.
 */
export function PlaceCard({ place }: { place: Place }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center rounded-2xl border border-hairline bg-card p-4">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-raised">
        <Icon name="place" size={20} color={colors.ink2} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-sans-semibold text-body text-ink">{place.name}</Text>
        <Text className="font-sans text-meta text-ink-2">{place.address}</Text>
      </View>
    </View>
  );
}
