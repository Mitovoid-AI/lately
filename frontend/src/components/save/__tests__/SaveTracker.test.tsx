import { fireEvent, screen } from "@testing-library/react-native";

import { TRACKER_ESTIMATE } from "../../../lib/saveOutcome";
import { renderWithProviders } from "../../../test/render";
import { Celebrate, SavedCheck } from "../Celebrate";
import { SaveTracker } from "../SaveTracker";

test("a pending card shows its four steps with the real one in progress, what Lately is doing, and no Open card yet", async () => {
  const onOpenCard = jest.fn();
  await renderWithProviders(<SaveTracker status="pending" stage="vision" onOpenCard={onOpenCard} />);
  expect(screen.getByLabelText("Got the reel, done")).toBeTruthy();
  expect(screen.getByLabelText("Listening to it, in progress")).toBeTruthy();
  expect(screen.getByLabelText("Finding places and steps, up next")).toBeTruthy();
  expect(screen.getByLabelText("Card ready, up next")).toBeTruthy();
  expect(screen.getByText(TRACKER_ESTIMATE)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open card" })).toBeNull();
  // No percentage and no time anywhere: only named steps.
  expect(screen.queryByText(/%/)).toBeNull();
  expect(screen.queryByText(/\d+ ?s/)).toBeNull();
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
  expect(screen.queryByText(TRACKER_ESTIMATE)).toBeNull();
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

test("without an Open card handler (the card's own screen) a ready tracker has no button", async () => {
  await renderWithProviders(<SaveTracker status="enriched" stage={null} />);
  expect(screen.getByText("Your card is ready.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open card" })).toBeNull();
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
  // Each of the two hides itself and everything inside it. (Icon glyphs hide themselves too, with
  // plain "no", so they are not counted here.)
  expect(tree.match(/"importantForAccessibility":"no-hide-descendants"/g)).toHaveLength(2);
  expect(tree.match(/"accessibilityElementsHidden":true/g)?.length).toBeGreaterThanOrEqual(2);
});
