import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";

import { Icon } from "./Icon";

export const LOGO = require("../../assets/stitch/logo.png");

/** The Library-style app bar: logo + wordmark, bookmark, avatar. */
export function Header({
  avatarUrl,
  initial = "A",
  onAvatar,
  onBookmark,
}: {
  avatarUrl?: string | null;
  initial?: string;
  onAvatar?: () => void;
  onBookmark?: () => void;
}) {
  return (
    <View className="h-16 flex-row items-center justify-between border-b border-hairline bg-canvas px-4">
      <View className="flex-row items-center">
        <Image source={LOGO} style={{ width: 32, height: 32, borderRadius: 8 }} />
        <Text className="ml-2 font-display-regular text-display-md text-ink">Lately</Text>
      </View>
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stacks"
          onPress={onBookmark}
          className="h-12 w-12 items-center justify-center rounded-full active:bg-raised"
        >
          <Icon name="bookmark-border" size={22} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={onAvatar}
          className="h-12 w-12 items-center justify-center rounded-full active:bg-raised"
        >
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#E7E1D8" }}
            />
          ) : (
            <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
              <Text className="font-sans-semibold text-meta text-ink">{initial}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}
