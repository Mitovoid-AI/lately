import type { Stack } from "../api/contract";
import { NewStackForm } from "../components/NewStackForm";
import { Sheet } from "../components/Sheet";

export function NewStackSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (stack: Stack) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <NewStackForm
        onCreated={(stack) => {
          onClose();
          onCreated?.(stack);
        }}
      />
    </Sheet>
  );
}
