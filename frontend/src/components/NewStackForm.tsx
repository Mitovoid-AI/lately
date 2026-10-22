import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text } from "react-native";

import type { Stack } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "./Button";
import { TextField } from "./TextField";

/**
 * Name field + Create; refreshes the stacks list and hands back the new stack. A failure is said
 * on the form itself (under the field, as an alert a screen reader announces), because the form
 * lives in a sheet and the message belongs next to what failed.
 */
export function NewStackForm({ onCreated }: { onCreated: (stack: Stack) => void | Promise<void> }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  async function create() {
    // Enter twice / a double tap: the second press lands while the first is still out.
    if (inFlight.current || !name.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const stack = await api.createStack(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["stacks"] });
      setName("");
      await onCreated(stack);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <Text accessibilityRole="header" className="font-display text-display-md text-ink">
        New stack
      </Text>
      <TextField
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (failed) setFailed(false);
        }}
        placeholder="e.g. Cafes to try"
        accessibilityLabel="Stack name"
        maxLength={60}
        autoFocus
        onSubmitEditing={create}
        className="mt-4"
      />
      {failed ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="mt-2 font-sans text-meta text-danger">
          Couldn&apos;t create the stack. Try again.
        </Text>
      ) : null}
      <Button title="Create" onPress={create} disabled={!name.trim()} loading={busy} className="mt-4" />
    </>
  );
}
