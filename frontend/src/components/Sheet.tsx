import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const BACKDROP = "rgba(28,26,23,0.35)";

/** The sheet card itself: slides up on mount, 24 px top corners, drag handle. */
export function SheetPanel({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 1,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [slide]);
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });
  // className is not applied to Animated.View, so the animated wrapper only moves
  // and the inner View carries the styling.
  return (
    <Animated.View style={{ transform: [{ translateY }], width: "100%", maxWidth: 560, alignSelf: "center" }}>
      <View
        className="w-full rounded-t-sheet border-t border-hairline bg-card px-4"
        style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        <View className="mb-4 mt-3 h-1 w-9 self-center rounded-full bg-hairline" />
        {children}
      </View>
    </Animated.View>
  );
}

/** Bottom sheet in a modal: dimmed backdrop (tap to close) + SheetPanel. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <Pressable accessibilityLabel="Close" onPress={onClose} className="flex-1" style={{ backgroundColor: BACKDROP }} />
        {visible ? <SheetPanel>{children}</SheetPanel> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
