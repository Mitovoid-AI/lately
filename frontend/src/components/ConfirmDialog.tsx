import { Modal, Pressable, Text, View } from "react-native";

import { Button } from "./Button";

/** Centered confirm dialog (RN's Alert does nothing on web). */
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: "rgba(28,26,23,0.35)" }}>
        <Pressable accessibilityLabel="Dismiss" onPress={onCancel} className="absolute inset-0" />
        <View className="w-full max-w-[340px] rounded-2xl border border-hairline bg-card p-6">
          <Text className="font-display text-display-sm text-ink">{title}</Text>
          <Text className="mt-2 font-sans text-body text-ink-2">{message}</Text>
          <View className="mt-6 flex-row gap-3">
            <Button title="Cancel" variant="secondary" onPress={onCancel} className="flex-1" />
            <Button title={confirmLabel} variant="danger" onPress={onConfirm} loading={busy} className="flex-1" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
