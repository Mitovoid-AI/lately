import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { colors } from "../theme/tokens";
import { Icon } from "./Icon";
import { IconButton } from "./motion/IconButton";
import { IMAGE_FADE } from "./Thumb";

export const LOGO = require("../../assets/stitch/logo.png");

/**
 * The bottom hairline of a top bar. Given the screen's scroll offset it appears only once
 * content slides beneath the bar; without one it is always drawn.
 */
export function ScrollHairline({ scrollY }: { scrollY?: SharedValue<number> }) {
  const resting = useSharedValue(12);
  const y = scrollY ?? resting;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, 12], [0, 1], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.hairline, style]} />;
}

/** The Library-style app bar: logo + wordmark, bookmark, avatar. */
export function Header({
  avatarUrl,
  initial = "A",
  onAvatar,
  onBookmark,
  scrollY,
}: {
  avatarUrl?: string | null;
  initial?: string;
  onAvatar?: () => void;
  onBookmark?: () => void;
  scrollY?: SharedValue<number>;
}) {
  return (
    <View className="h-16 flex-row items-center justify-between bg-canvas px-4">
      <View className="flex-row items-center">
        <Image source={LOGO} style={{ width: 32, height: 32, borderRadius: 8 }} />
        <Text className="ml-2 font-display-regular text-display-md text-ink">Lately</Text>
      </View>
      <View className="-mr-2 flex-row items-center">
        <IconButton label="Stacks" onPress={onBookmark}>
          <Icon name="bookmark-border" size={22} color={colors.ink2} />
        </IconButton>
        <IconButton label="Account" onPress={onAvatar}>
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              transition={IMAGE_FADE}
              style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline }}
            />
          ) : (
            <View className="h-8 w-8 items-center justify-center rounded-full bg-raised">
              <Text className="font-sans-semibold text-meta text-ink">{initial}</Text>
            </View>
          )}
        </IconButton>
      </View>
      <ScrollHairline scrollY={scrollY} />
    </View>
  );
}

const styles = StyleSheet.create({
  hairline: {
    pointerEvents: "none",
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: colors.hairline,
  },
});
