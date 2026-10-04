import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Bottom sheet: dimmed backdrop, card surface with 24 px top corners and a drag handle. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      }).start();
    }
  }, [visible, slide]);
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          className="flex-1"
          style={{ backgroundColor: "rgba(28,26,23,0.35)" }}
        />
        <Animated.View
          className="w-full self-center rounded-t-sheet border-t border-hairline bg-card px-4"
          style={{ transform: [{ translateY }], paddingBottom: Math.max(insets.bottom, 16) + 8, maxWidth: 560 }}
        >
          <View className="mb-4 mt-3 h-1 w-9 self-center rounded-full bg-hairline" />
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
