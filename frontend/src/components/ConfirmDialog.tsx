import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Button } from "./Button";
import { usePresence } from "./motion/usePresence";

/**
 * Centered confirm dialog (RN's Alert does nothing on web). The backdrop dims in while the card
 * settles from 96% scale; it leaves faster than it came.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const progress = useSharedValue(0);
  const mounted = usePresence(visible, progress, { enter: 240, exit: 160 });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: 0.96 + 0.04 * progress.get() }],
  }));
  if (!visible && !mounted) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center px-6">
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable accessibilityLabel="Dismiss" onPress={onCancel} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <View className="w-full rounded-2xl border border-hairline bg-card p-6">
            <Text className="font-display text-display-sm text-ink">{title}</Text>
            <Text className="mt-2 font-sans text-body text-ink-2">{message}</Text>
            <View className="mt-6 flex-row gap-3">
              <Button title="Cancel" variant="secondary" onPress={onCancel} className="flex-1" />
              <Button title={confirmLabel} variant="danger" onPress={onConfirm} loading={busy} className="flex-1" />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(28,26,23,0.35)" },
  cardWrap: { width: "100%", maxWidth: 340 },
});
