import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text } from "react-native";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "./Button";
import { TextField } from "./TextField";
import { useToast } from "./Toast";

/** Name field + Create; refreshes the stacks list and hands back the new stack. */
export function NewStackForm({ onCreated }: { onCreated: (stack: Stack) => void | Promise<void> }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function create() {
    // Enter twice / a double tap: the second press lands while the first is still out.
    if (inFlight.current || !name.trim()) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const stack = await api.createStack(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["stacks"] });
      setName("");
      await onCreated(stack);
    } catch {
      toast.show("Couldn't create the stack. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Text className="font-display text-display-md text-ink">New stack</Text>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder="e.g. Cafes to try"
        maxLength={60}
        autoFocus
        onSubmitEditing={create}
        className="mt-4"
      />
      <Button title="Create" onPress={create} disabled={!name.trim()} loading={busy} className="mt-4" />
    </>
  );
}
