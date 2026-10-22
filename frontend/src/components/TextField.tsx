import { useCallback, type ReactNode, type Ref } from "react";
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { DURATION, EASE_OUT } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Text input with the design system's focus state: the outline (3:1 `control` at rest, so the
 * field is findable on white) deepens to the dark marigold, accent-text, and a soft marigold
 * ring blooms around it (180 ms, UI thread, no re-render on focus). Plain marigold would be
 * 2.4:1 on white, too faint for a focus indicator.
 */
export function TextField({
  className,
  size = "md",
  tone = "canvas",
  inputClassName = "",
  inputStyle,
  leading,
  trailing,
  multiline,
  onFocus,
  onBlur,
  ref,
  ...props
}: Omit<TextInputProps, "style"> & {
  /** Layout classes for the field (margins, flex). */
  className?: string;
  size?: "md" | "lg";
  /** canvas inside sheets and cards, card on the canvas. */
  tone?: "canvas" | "card";
  inputClassName?: string;
  inputStyle?: StyleProp<TextStyle>;
  leading?: ReactNode;
  trailing?: ReactNode;
  ref?: Ref<TextInput>;
}) {
  const { colors } = useTheme();
  const focus = useSharedValue(0);
  const to = useCallback(
    (v: number) => focus.set(withTiming(v, { duration: DURATION.state, easing: EASE_OUT })),
    [focus],
  );

  const boxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.get(), [0, 1], [colors.control, colors.accentText]),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: focus.get(),
    transform: [{ scale: 0.985 + 0.015 * focus.get() }],
  }));

  return (
    <View className={className}>
      <Animated.View style={[styles.ring, { borderColor: colors.focusRing }, ringStyle]} />
      <Animated.View
        style={[
          styles.box,
          { minHeight: size === "lg" ? 56 : 48, backgroundColor: tone === "card" ? colors.card : colors.canvas },
          multiline ? styles.multiline : null,
          boxStyle,
        ]}
      >
        {leading}
        <TextInput
          ref={ref}
          {...props}
          multiline={multiline}
          placeholderTextColor={props.placeholderTextColor ?? colors.ink3}
          onFocus={(e) => {
            to(1);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            to(0);
            onBlur?.(e);
          }}
          className={`flex-1 font-sans text-body text-ink ${multiline ? "" : "self-stretch"} ${inputClassName}`}
          style={[multiline ? styles.multilineInput : styles.input, inputStyle]}
        />
        {trailing}
      </Animated.View>
    </View>
  );
}

// `outlineStyle: "none"` is what react-native-web needs to drop the browser's focus outline; React
// Native's own outline types do not list it, hence the cast.
const WEB_NO_OUTLINE: TextStyle =
  Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } as unknown as TextStyle) : {};

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  multiline: { alignItems: "flex-start", paddingHorizontal: 12, paddingVertical: 12 },
  ring: {
    pointerEvents: "none",
    position: "absolute",
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderRadius: 15,
    borderWidth: 3,
  },
  // The field draws its own focus ring, so the browser's outline is switched off on web.
  input: { paddingVertical: 0, ...WEB_NO_OUTLINE },
  multilineInput: { paddingVertical: 0, textAlignVertical: "top", minHeight: 24, ...WEB_NO_OUTLINE },
});
