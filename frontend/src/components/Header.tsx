import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { useTheme } from "../theme/ThemeProvider";
import { IconButton } from "./motion/IconButton";
import { IMAGE_FADE } from "./Thumb";

export const LOGO = require("../../assets/stitch/logo.png");

/** App bar height: compact, like a native nav bar (44-56 pt). */
export const HEADER_HEIGHT = 52;
/**
 * The bar's content stays in the same column as the screen under it (the 1280 pt grid by
 * default, centred on a wide window), so the wordmark and avatar line up with the first tile's
 * edges instead of the window's. The bar's fill and hairline still run edge to edge.
 */
const CONTENT_MAX_WIDTH = 1280;

/**
 * The bottom hairline of a top bar. Given the screen's scroll offset it appears only once
 * content slides beneath the bar; without one it is always drawn.
 */
export function ScrollHairline({ scrollY }: { scrollY?: SharedValue<number> }) {
  const { colors } = useTheme();
  const resting = useSharedValue(12);
  const y = scrollY ?? resting;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, 12], [0, 1], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.hairline, { backgroundColor: colors.hairline }, style]} />;
}

/**
 * The app bar: logo + wordmark and the avatar (Account). A screen pushed on the stack passes
 * `onBack`: a back button replaces the wordmark (and `title` can name the screen). The tab
 * screens need no shortcut to Stacks: it has its own tab.
 */
export function Header({
  avatarUrl,
  initial = "A",
  onAvatar,
  onBack,
  title,
  scrollY,
  maxWidth = CONTENT_MAX_WIDTH,
}: {
  avatarUrl?: string | null;
  initial?: string;
  onAvatar?: () => void;
  onBack?: () => void;
  title?: string;
  scrollY?: SharedValue<number>;
  /** Width of the column the content sits in; a screen with a narrower column passes its own. */
  maxWidth?: number;
}) {
  const { colors } = useTheme();
  return (
    <View className="bg-canvas" style={{ height: HEADER_HEIGHT }}>
      <View
        className="w-full flex-1 flex-row items-center justify-between self-center px-4"
        style={{ maxWidth }}
      >
        {onBack ? (
          <View className="-ml-3 flex-1 flex-row items-center">
            <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={onBack} />
            {title ? (
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                className="ml-1 flex-1 font-display-medium text-display-sm text-ink"
              >
                {title}
              </Text>
            ) : null}
          </View>
        ) : (
          <View className="flex-row items-center">
            <Image source={LOGO} style={{ width: 26, height: 26, borderRadius: 7 }} />
            <Text maxFontSizeMultiplier={1.3} className="ml-2 font-display-medium text-display-sm text-ink">
              Lately
            </Text>
          </View>
        )}
        <View className="-mr-2 flex-row items-center">
          <IconButton label="Account" onPress={onAvatar}>
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                transition={IMAGE_FADE}
                style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.hairline }}
              />
            ) : (
              <View className="items-center justify-center rounded-full bg-raised" style={{ width: 30, height: 30 }}>
                <Text className="font-sans-semibold text-meta text-ink">{initial}</Text>
              </View>
            )}
          </IconButton>
        </View>
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
  },
});
