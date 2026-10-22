import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../../test/render";
import { Celebrate, SavedCheck } from "../Celebrate";
import { SaveTracker } from "../SaveTracker";

test("a pending card shows its four steps with the real one in progress, a rough time, and no Open card yet", async () => {
  const onOpenCard = jest.fn();
  await renderWithProviders(<SaveTracker status="pending" stage="vision" onOpenCard={onOpenCard} />);
  expect(screen.getByLabelText("Got the reel, done")).toBeTruthy();
  expect(screen.getByLabelText("Listening to it, in progress")).toBeTruthy();
  expect(screen.getByLabelText("Finding places and steps, up next")).toBeTruthy();
  expect(screen.getByLabelText("Card ready, up next")).toBeTruthy();
  expect(screen.getByText("Usually about 30 s")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open card" })).toBeNull();
  // No percentage anywhere: only named steps and a rough time.
  expect(screen.queryByText(/%/)).toBeNull();
});

test("late stages say almost there", async () => {
  await renderWithProviders(<SaveTracker status="pending" stage="structure" onOpenCard={jest.fn()} />);
  expect(screen.getByLabelText("Finding places and steps, in progress")).toBeTruthy();
  expect(screen.getByText("Almost there")).toBeTruthy();
});

test("a slow card says it keeps filling in", async () => {
  await renderWithProviders(<SaveTracker status="pending" stage="structure" slow onOpenCard={jest.fn()} />);
  expect(screen.getByText("Still working. You can close this; the card keeps filling in.")).toBeTruthy();
});

test("a card whose last check failed does not claim a time", async () => {
  await renderWithProviders(<SaveTracker status="pending" stage="vision" unreachable onOpenCard={jest.fn()} />);
  expect(screen.getByText("Can't check progress right now. The card keeps filling in.")).toBeTruthy();
  expect(screen.queryByText("Usually about 30 s")).toBeNull();
});

test("a ready card finishes every step and offers Open card", async () => {
  const onOpenCard = jest.fn();
  await renderWithProviders(<SaveTracker status="enriched" stage={null} onOpenCard={onOpenCard} />);
  expect(screen.getByLabelText("Found places and steps, done")).toBeTruthy();
  expect(screen.getByLabelText("Card ready, done")).toBeTruthy();
  expect(screen.getByText("Your card is ready.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Open card" }));
  expect(onOpenCard).toHaveBeenCalledTimes(1);
});

test("the first card says so", async () => {
  await renderWithProviders(<SaveTracker status="enriched" stage={null} first onOpenCard={jest.fn()} />);
  expect(screen.getByText("Your first card is ready.")).toBeTruthy();
});

test("a partial card says what happened and still opens", async () => {
  await renderWithProviders(<SaveTracker status="partial" stage={null} first onOpenCard={jest.fn()} />);
  expect(screen.getByText("Lately could only read part of this reel. Open the card to try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open card" })).toBeTruthy();
});

test("the celebration and the plain check are for the eye only: hidden from screen readers", async () => {
  await renderWithProviders(
    <>
      <Celebrate />
      <SavedCheck />
    </>,
  );
  const tree = JSON.stringify(screen.toJSON());
  expect(tree.match(/"accessibilityElementsHidden":true/g)).toHaveLength(2);
});
