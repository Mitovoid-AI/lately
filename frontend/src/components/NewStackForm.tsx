import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, TextInput } from "react-native";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { colors } from "../theme/tokens";
import { Button } from "./Button";
import { useToast } from "./Toast";

/** Name field + Create; refreshes the stacks list and hands back the new stack. */
export function NewStackForm({ onCreated }: { onCreated: (stack: Stack) => void | Promise<void> }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const stack = await api.createStack(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["stacks"] });
      setName("");
      await onCreated(stack);
    } catch {
      toast.show("Couldn't create the stack. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Text className="font-display text-display-md text-ink">New stack</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Cafes to try"
        placeholderTextColor={colors.ink3}
        maxLength={60}
        autoFocus
        onSubmitEditing={() => name.trim() && create()}
        className="mt-4 h-12 rounded-ctl border border-hairline bg-canvas px-4 font-sans text-body text-ink"
      />
      <Button title="Create" onPress={create} disabled={!name.trim()} loading={busy} className="mt-4" />
    </>
  );
}
