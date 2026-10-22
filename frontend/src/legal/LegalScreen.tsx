import { useLocalSearchParams, useRouter } from "expo-router";
import { Fragment, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HEADER_HEIGHT, ScrollHairline } from "../components/Header";
import { IconButton } from "../components/motion/IconButton";
import { Reveal } from "../components/motion/Reveal";
import { goBack } from "../lib/navigation";
import { useTheme } from "../theme/ThemeProvider";
import { LEGAL_DOCS, type LegalDoc } from "./documents";
import { parseMarkdown, type Run } from "./markdown";

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <Fragment key={i}>{r.bold ? <Text className="font-sans-semibold text-ink">{r.text}</Text> : r.text}</Fragment>
      ))}
    </>
  );
}

/** Privacy Policy / Terms of Service, readable signed in or out (/legal/privacy, /legal/terms). */
export function LegalScreen() {
  const { colors } = useTheme();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const key: LegalDoc = doc === "terms" ? "terms" : "privacy";
  const blocks = useMemo(() => parseMarkdown(LEGAL_DOCS[key].markdown), [key]);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => scrollY.set(e.contentOffset.y) });

  return (
    <View className="flex-1 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center px-1" style={{ height: HEADER_HEIGHT }}>
        <IconButton icon="arrow-back" size={24} color={colors.ink} label="Back" onPress={() => goBack(router)} />
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} className="flex-1 font-sans-semibold text-body text-ink">
          Legal
        </Text>
        <ScrollHairline scrollY={scrollY} />
      </View>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Reveal>
          <View className="w-full max-w-[640px] self-center px-4 pt-4">
            {blocks.map((b, i) =>
              b.kind === "h1" ? (
                <Text key={i} accessibilityRole="header" className="font-display text-display-lg text-ink">
                  <Runs runs={b.text} />
                </Text>
              ) : b.kind === "h2" ? (
                <Text key={i} accessibilityRole="header" className="mt-8 font-display text-display-sm text-ink">
                  <Runs runs={b.text} />
                </Text>
              ) : b.kind === "li" ? (
                <View key={i} className="mt-3 flex-row">
                  <Text className="w-5 font-sans text-body text-ink-2">•</Text>
                  <Text className="flex-1 font-sans text-body text-ink-2">
                    <Runs runs={b.text} />
                  </Text>
                </View>
              ) : (
                <Text key={i} className="mt-3 font-sans text-body text-ink-2">
                  <Runs runs={b.text} />
                </Text>
              ),
            )}
          </View>
        </Reveal>
      </Animated.ScrollView>
    </View>
  );
}
