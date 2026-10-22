import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";

import { useTheme } from "../theme/ThemeProvider";
import { Button } from "./Button";
import { usePresence } from "./motion/usePresence";
import { ToastLayer } from "./Toast";

/** The message scrolls past this share of the window, so the buttons below it never leave the screen. */
const MESSAGE_MAX_SHARE = 0.7;

/**
 * Centered confirm dialog (RN's Alert does nothing on web). The backdrop dims in while the card
 * settles from 96% scale (it only fades with Reduce Motion on); it leaves faster than it came.
 * The buttons are stacked, the confirming one on top, so a long label or a big text size never
 * squeezes two side by side. A toast raised while it is open shows above it.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  aside,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** An alternative to confirming, shown above the two buttons (e.g. "Download my archive first"). */
  aside?: { label: string; onPress: () => void };
}) {
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const mounted = usePresence(visible, progress, { enter: 240, exit: 160 });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: reduced ? 1 : 0.96 + 0.04 * progress.get() }],
  }));
  if (!visible && !mounted) return null;
  // While the action runs, nothing may close the dialog out from under it.
  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={cancel}>
      <View className="flex-1 items-center justify-center px-6">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }, backdropStyle]}>
          {/* Tapping outside closes it; screen readers get Cancel instead, so this is not a stop of its own. */}
          <Pressable
            accessible={false}
            importantForAccessibility="no"
            focusable={false}
            accessibilityLabel="Dismiss"
            onPress={cancel}
            disabled={busy}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View style={[styles.cardWrap, cardStyle]}>
          <View className="w-full rounded-2xl border border-hairline bg-card p-6">
            <Text accessibilityRole="header" className="font-display text-display-sm text-ink">
              {title}
            </Text>
            <ScrollView
              style={{ flexGrow: 0, maxHeight: Math.round(windowHeight * MESSAGE_MAX_SHARE) }}
              showsVerticalScrollIndicator={false}
              className="mt-2"
            >
              <Text className="font-sans text-body text-ink-2">{message}</Text>
            </ScrollView>
            {aside ? (
              <Button title={aside.label} variant="secondary" icon="cloud-download" onPress={aside.onPress} disabled={busy} className="mt-5" />
            ) : null}
            <View className={`${aside ? "mt-2" : "mt-6"} gap-2`}>
              <Button title={confirmLabel} variant="danger" onPress={onConfirm} loading={busy} />
              <Button title="Cancel" variant="secondary" onPress={cancel} disabled={busy} />
            </View>
          </View>
        </Animated.View>
      </View>
      {visible ? <ToastLayer /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: "100%", maxWidth: 340 },
});
