import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Text } from "react-native";

import type { Stack, StackDetail } from "../api/contract";
import { useApi } from "../api/index";
import { Button } from "./Button";
import { TextField } from "./TextField";

/**
 * Name field + Create; refreshes the stacks list and hands back the new stack. A failure is said
 * on the form itself (under the field, as an alert a screen reader announces), because the form
 * lives in a sheet and the message belongs next to what failed. Given a `stack`, the same form
 * renames it instead (same name rules): it starts with the current name, the button says Save
 * and stays off until the name changes, and the stack's list and detail views take the new name.
 */
export function NewStackForm({
  onCreated,
  stack: renaming,
}: {
  /** Called with the new stack, or with the renamed one when `stack` is given. */
  onCreated: (stack: Stack) => void | Promise<void>;
  stack?: Stack;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(renaming?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const unchanged = !!renaming && name.trim() === renaming.name;

  async function create() {
    // Enter twice / a double tap: the second press lands while the first is still out.
    if (inFlight.current || !name.trim() || unchanged) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (renaming) {
        const stack = await api.renameStack(renaming.id, name.trim());
        // The new name shows at once wherever the stack is; then both views re-read it.
        queryClient.setQueryData<StackDetail>(["stack", stack.id], (old) => (old ? { ...old, name: stack.name } : old));
        queryClient.setQueryData<Stack[]>(["stacks"], (old) =>
          old?.map((s) => (s.id === stack.id ? { ...s, name: stack.name } : s)),
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["stacks"] }),
          queryClient.invalidateQueries({ queryKey: ["stack", stack.id] }),
        ]);
        await onCreated(stack);
        return;
      }
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
        {renaming ? "Rename stack" : "New stack"}
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
          {renaming ? "Couldn't rename the stack. Try again." : "Couldn't create the stack. Try again."}
        </Text>
      ) : null}
      <Button
        title={renaming ? "Save" : "Create"}
        onPress={create}
        disabled={!name.trim() || unchanged}
        loading={busy}
        className="mt-4"
      />
    </>
  );
}
