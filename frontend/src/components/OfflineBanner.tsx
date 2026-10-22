import { Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { DURATION } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { Icon } from "./Icon";
import { TAB_BAR_HEIGHT } from "./TabBar";

/** A hand's width above the tab bar (the same lane a toast uses), never over the header. */
const GAP_ABOVE_BAR = 8;
/** The most the text grows with the system text size; past it the banner would eat the screen. */
const MAX_FONT_SCALE = 1.3;

/**
 * A slim notice floating just above the tab bar while the app runs on a stored session it
 * couldn't refresh (opened offline). It sits low, not at the top, so it never covers the
 * wordmark, the Back button or the avatar. Everything cached still shows; it disappears once the
 * session refreshes. The text may take two lines and the pill grows with it; it is a polite live
 * region, so a screen reader says it once when it appears.
 */
export function OfflineBanner() {
  const { colors } = useTheme();
  const { offline, status } = useAuth();
  const insets = useSafeAreaInsets();
  if (!offline || status !== "signed-in") return null;
  return (
    <Animated.View
      entering={FadeIn.duration(DURATION.state)}
      exiting={FadeOut.duration(DURATION.state)}
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: insets.bottom + TAB_BAR_HEIGHT + GAP_ABOVE_BAR,
        left: 16,
        right: 16,
        alignItems: "center",
        zIndex: 10,
      }}
    >
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="min-h-8 max-w-[420px] flex-row items-center rounded-2xl border border-hairline bg-raised px-3 py-1.5"
      >
        <Icon name="cloud-off" size={16} color={colors.ink2} />
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          className="ml-1.5 shrink font-sans-medium text-meta text-ink-2"
        >
          {"You're offline. Showing what's on this phone."}
        </Text>
      </View>
    </Animated.View>
  );
}
