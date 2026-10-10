import { Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { DURATION } from "../theme/motion";
import { colors } from "../theme/tokens";
import { Icon } from "./Icon";

/**
 * A slim strip at the top while the app runs on a stored session it couldn't refresh (opened
 * offline). Everything cached still shows; it disappears once the session refreshes.
 */
export function OfflineBanner() {
  const { offline, status } = useAuth();
  const insets = useSafeAreaInsets();
  if (!offline || status !== "signed-in") return null;
  return (
    <Animated.View
      entering={FadeIn.duration(DURATION.state)}
      exiting={FadeOut.duration(DURATION.state)}
      pointerEvents="none"
      style={{ position: "absolute", top: insets.top + 4, left: 0, right: 0, alignItems: "center", zIndex: 10 }}
    >
      <View accessibilityRole="alert" className="h-8 flex-row items-center rounded-full border border-hairline bg-raised px-3">
        <Icon name="cloud-off" size={16} color={colors.ink2} />
        <Text className="ml-1.5 font-sans-medium text-meta text-ink-2">{"You're offline. Showing what's on this phone."}</Text>
      </View>
    </Animated.View>
  );
}
