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

test("the buttons are stacked, the confirming one on top, so a long label never squeezes two side by side", async () => {
  await setup(false);
  const names = screen.getAllByRole("button").map((b) => b.props.accessibilityLabel);
  expect(names).toEqual(["Delete", "Cancel"]);
});

test("an alternative to confirming sits above both, and the title is a heading", async () => {
  await render(
    <ConfirmDialog
      visible
      title="Delete?"
      message="Gone for good."
      confirmLabel="Delete"
      onCancel={() => {}}
      onConfirm={() => {}}
      aside={{ label: "Download first", onPress: () => {} }}
    />,
  );
  expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel)).toEqual(["Download first", "Delete", "Cancel"]);
  expect(screen.getByText("Delete?").props.accessibilityRole).toBe("header");
});

test("the dimmed backdrop closes on a tap but is not a stop for a screen reader", async () => {
  await setup(false);
  const backdrop = screen.getByLabelText("Dismiss");
  expect(backdrop.props.accessible).toBe(false);
  expect(backdrop.props.importantForAccessibility).toBe("no");
});
