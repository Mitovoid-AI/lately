import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { goBack } from "../../lib/navigation";
import { useTheme } from "../../theme/ThemeProvider";
import { HEADER_HEIGHT, ScrollHairline } from "../Header";
import { IconButton } from "../motion/IconButton";
import { Reveal } from "../motion/Reveal";

/**
 * A page opened from Account (Help, Open-source licenses, Instagram): the Legal pages' frame, a
 * back button and a small title over a scrolling column. Back with no history goes to Account.
 */
export function SubScreen({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-1" style={{ height: HEADER_HEIGHT }}>
        <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router, "/account")} />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          className="flex-1 font-sans-semibold text-body text-ink"
        >
          {title}
        </Text>
        <ScrollHairline scrollY={scrollY} />
      </View>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Reveal>
          <View className="w-full max-w-[560px] self-center px-4 pt-4">{children}</View>
        </Reveal>
      </Animated.ScrollView>
    </View>
  );
}
