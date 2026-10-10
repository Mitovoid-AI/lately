import { fireEvent, render, screen } from "@testing-library/react-native";

import { ConfirmDialog } from "../ConfirmDialog";

function setup(busy: boolean) {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  return render(
    <ConfirmDialog visible title="Delete?" message="Gone for good." confirmLabel="Delete" busy={busy} onCancel={onCancel} onConfirm={onConfirm} />,
  ).then(() => ({ onCancel, onConfirm }));
}

/** The Modal's Android back handler, found by walking up from the dialog's title. */
function backHandler(): () => void {
  type Node = { props: Record<string, unknown>; parent: Node | null };
  let node = screen.getByText("Delete?") as unknown as Node | null;
  while (node && typeof node.props.onRequestClose !== "function") node = node.parent;
  if (!node) throw new Error("no onRequestClose found");
  return node.props.onRequestClose as () => void;
}

test("while busy, Cancel, the backdrop and Back do nothing", async () => {
  const { onCancel } = await setup(true);
  await fireEvent.press(screen.getByText("Cancel"));
  await fireEvent.press(screen.getByLabelText("Dismiss"));
  backHandler()();
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" }).props.accessibilityState).toMatchObject({ disabled: true });
});

test("when idle, Cancel, the backdrop and Back cancel", async () => {
  const { onCancel } = await setup(false);
  await fireEvent.press(screen.getByText("Cancel"));
  await fireEvent.press(screen.getByLabelText("Dismiss"));
  backHandler()();
  expect(onCancel).toHaveBeenCalledTimes(3);
});
