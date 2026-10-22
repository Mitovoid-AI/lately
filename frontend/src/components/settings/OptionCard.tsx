import { useEffect, type ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT } from "../../theme/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { Icon } from "../Icon";
import { PressableScale } from "../motion/PressableScale";

const CHECK_IN = FadeIn.duration(DURATION.state).easing(EASE_OUT);
const CHECK_OUT = FadeOut.duration(140);

/**
 * One of a row of choices (reading font, theme). Selected = raised fill + a dark-marigold check
 * (accent-text, 5.3:1 on the raised fill; plain marigold would be 2.2:1). The fill, border and
 * corner check all dissolve between states. Unselected, the border is the 3:1 `control` tone, so
 * each choice is findable on the canvas (a hairline is 1.3:1).
 */
export function OptionCard({
  selected,
  onPress,
  top,
  label,
  check = false,
}: {
  selected: boolean;
  onPress: () => void;
  top: ReactNode;
  label: string;
  check?: boolean;
}) {
  const { colors } = useTheme();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: DURATION.state, easing: EASE_OUT }));
  }, [selected, on]);
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [colors.canvas, colors.raised]),
    borderColor: interpolateColor(on.get(), [0, 1], [colors.control, colors.ink3]),
  }));

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      haptic={selected ? undefined : "selection"}
      containerClassName="flex-1"
      className="grow"
    >
      <Animated.View style={[styles.box, boxStyle]}>
        {check && selected ? (
          <Animated.View entering={CHECK_IN} exiting={CHECK_OUT} style={styles.check}>
            <Icon name="check-circle-outline" size={18} color={colors.accentText} />
          </Animated.View>
        ) : null}
        {top}
        <Text className="mt-1 font-sans text-caption text-ink-2">{label}</Text>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  box: {
    flexGrow: 1,
    minHeight: 80,
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  check: { position: "absolute", right: 8, top: 8 },
});
