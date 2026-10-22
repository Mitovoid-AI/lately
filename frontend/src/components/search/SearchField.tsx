import type { Ref } from "react";
import { Platform, StyleSheet, TextInput, View, type TextStyle } from "react-native";
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
import { IconButton } from "../motion/IconButton";

const CLEAR_IN = FadeIn.duration(DURATION.state);
const CLEAR_OUT = FadeOut.duration(120);

/** The same height as Home's search front door, so the field looks like it moved, not changed. */
export const SEARCH_FIELD_HEIGHT = 52;

/**
 * The Search tab's field: 52 pt, rounded, raised fill (like the one on Home) with a `control`
 * outline at rest (the boundary of a control, 3:1). Focus warms the border to marigold and
 * blooms the soft ring, on the UI thread (no re-render on focus).
 */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  onClear,
  placeholder,
  inputRef,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  placeholder: string;
  inputRef?: Ref<TextInput>;
}) {
  const { colors } = useTheme();
  const focus = useSharedValue(0);
  const to = (v: number) => focus.set(withTiming(v, { duration: DURATION.state, easing: EASE_OUT }));

  const boxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.get(), [0, 1], [colors.control, colors.accentText]),
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: focus.get(),
    transform: [{ scale: 0.985 + 0.015 * focus.get() }],
  }));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.ring, { borderColor: colors.focusRing }, ringStyle]} />
      <Animated.View style={[styles.box, { backgroundColor: colors.raised }, boxStyle]}>
        <Icon name="search" size={20} color={colors.ink2} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          onFocus={() => to(1)}
          onBlur={() => to(0)}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          maxLength={200}
          returnKeyType="search"
          accessibilityLabel="Search your saves"
          className="ml-2 flex-1 self-stretch font-sans text-body text-ink"
          style={styles.input}
        />
        {value ? (
          <Animated.View entering={CLEAR_IN} exiting={CLEAR_OUT}>
            <IconButton icon="close" size={18} color={colors.ink3} label="Clear" onPress={onClear} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

// `outlineStyle: "none"` is web-only (React Native's own type lists solid, dotted and dashed).
const WEB_NO_OUTLINE = (
  Platform.OS === "web" ? { outlineWidth: 0, outlineColor: "transparent", outlineStyle: "none" } : null
) as TextStyle | null;

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  box: {
    height: SEARCH_FIELD_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 4,
  },
  ring: {
    pointerEvents: "none",
    position: "absolute",
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderRadius: 19,
    borderWidth: 3,
  },
  // The box draws the border and the focus ring, so the input itself has neither: no fill, no
  // border, and the browser's own outline is switched off on web.
  input: { paddingVertical: 0, backgroundColor: "transparent", borderWidth: 0, ...WEB_NO_OUTLINE },
});
