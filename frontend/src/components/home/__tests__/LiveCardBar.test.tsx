import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Save } from "../../../api/contract";
import { buildDemoSeed } from "../../../api/demo-data";
import { NOW } from "../../../test/fixtures";
import { LiveCardBar } from "../LiveCardBar";

const seed = buildDemoSeed(NOW).saves;
const pending = seed.find((s) => s.id === "s-pending")!;

/** A pending save with the fields the bar reads. */
function pendingSave(over: Partial<Save> & { id: string }): Save {
  return { ...pending, title: null, thumbnail_url: null, ...over };
}

test("renders nothing when no save is pending", async () => {
  await render(<LiveCardBar saves={[]} now={NOW} onOpen={() => {}} />);
  expect(screen.queryByText(/about 30 s/)).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

test("a pending save shows 'New reel', the current step and the usual wait", async () => {
  const save = pendingSave({ id: "p1", created_at: new Date(NOW - 20_000).toISOString(), stage: "transcribe" });
  await render(<LiveCardBar saves={[save]} now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("New reel")).toBeTruthy();
  expect(screen.getByText("Listening to it · about 30 s")).toBeTruthy();
});

test("without a stage the step is the generic one", async () => {
  const save = pendingSave({ id: "p1", created_at: new Date(NOW - 20_000).toISOString(), stage: null });
  await render(<LiveCardBar saves={[save]} now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("Writing your card · about 30 s")).toBeTruthy();
});

test("a title the server already knows replaces 'New reel'", async () => {
  const save = pendingSave({ id: "p1", title: "Dumpling place", created_at: new Date(NOW - 5_000).toISOString() });
  await render(<LiveCardBar saves={[save]} now={NOW} onOpen={() => {}} />);
  expect(screen.getByText("Dumpling place")).toBeTruthy();
  expect(screen.queryByText("New reel")).toBeNull();
});

test("only two rows, then a count of the rest", async () => {
  const saves = ["a", "b", "c", "d"].map((id) => pendingSave({ id, created_at: new Date(NOW - 5_000).toISOString() }));
  await render(<LiveCardBar saves={saves} now={NOW} onOpen={() => {}} />);
  expect(screen.getAllByText("New reel")).toHaveLength(2);
  expect(screen.getByText("+2 more")).toBeTruthy();
});

test("tapping a row opens that card", async () => {
  const onOpen = jest.fn();
  const save = pendingSave({ id: "p1", created_at: new Date(NOW - 5_000).toISOString() });
  await render(<LiveCardBar saves={[save]} now={NOW} onOpen={onOpen} />);
  await fireEvent.press(screen.getByRole("button"));
  expect(onOpen).toHaveBeenCalledWith("p1");
});
