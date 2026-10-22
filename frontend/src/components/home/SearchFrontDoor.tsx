import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { SEARCH_EXAMPLES } from "../../lib/searchExamples";
import { DURATION, EASE_OUT } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";

/** How long each example stays up before the next one fades in. */
export const EXAMPLE_MS = 3500;

/**
 * Home's front door: a tall search field that is really a button to the Search tab. The grey
 * line inside shows a real kind of query and swaps to the next every 3.5 s (a short fade, no
 * movement); with Reduce Motion on it stays on the first. Screen readers hear one stable
 * label, not the rotating text.
 */
export function SearchFrontDoor({
  onPress,
  examples = SEARCH_EXAMPLES,
}: {
  onPress: () => void;
  examples?: readonly string[];
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const fade = useSharedValue(1);
  const rotating = !reduced && examples.length > 1;

  useEffect(() => {
    if (!rotating) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      fade.set(withTiming(0, { duration: DURATION.state, easing: EASE_OUT }));
      // The text changes while it is invisible, then the next one fades up.
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % examples.length);
        fade.set(withTiming(1, { duration: DURATION.state, easing: EASE_OUT }));
      }, DURATION.state);
    }, EXAMPLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(swap);
      fade.set(1);
    };
  }, [rotating, examples.length, fade]);

  const exampleStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const example = examples[index % Math.max(examples.length, 1)];

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Search your saves"
      onPress={onPress}
      scaleTo={0.985}
      highlightColor={colors.hairline}
      className="h-[52px] flex-row items-center rounded-2xl border border-control bg-raised px-4"
    >
      <Icon name="search" size={20} color={colors.ink2} />
      <View className="ml-3 flex-1 flex-row items-center">
        <Text className="font-sans-medium text-body text-ink-2">Search</Text>
        {example ? (
          <Animated.View style={[{ flexShrink: 1, marginLeft: 4 }, exampleStyle]}>
            <Text numberOfLines={1} className="font-sans text-body text-ink-3">
              {`“${example}”`}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </PressableScale>
  );
}
