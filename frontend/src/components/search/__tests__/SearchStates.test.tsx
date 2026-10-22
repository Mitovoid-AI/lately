import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../../test/render";
import { ExampleChips, IdleState, NoResults } from "../SearchStates";

const THREE = ["dinner to try", "hike in june", "food & places"];

test("example chips need at least three: fewer is no row, not a lone chip", async () => {
  await renderWithProviders(<ExampleChips examples={["only", "two"]} onPick={() => {}} />);
  expect(screen.queryByText("Try searching for")).toBeNull();
  expect(screen.queryByText("only")).toBeNull();
});

test("three or more show, and a chip picks its query", async () => {
  const onPick = jest.fn();
  await renderWithProviders(<ExampleChips examples={THREE} onPick={onPick} />);
  expect(screen.getByText("Try searching for")).toBeTruthy();
  await fireEvent.press(screen.getByText("hike in june"));
  expect(onPick).toHaveBeenCalledWith("hike in june");
});

test("the empty query leads with recent searches and then the examples it was given", async () => {
  await renderWithProviders(<IdleState recent={["momo"]} examples={THREE} onPick={() => {}} onClearRecent={() => {}} />);
  expect(screen.getByText("Recent")).toBeTruthy();
  expect(screen.getByText("momo")).toBeTruthy();
  for (const q of THREE) expect(screen.getByText(q)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear recent searches" })).toBeTruthy();
});

test("with too few examples the empty query shows its prompt and no chips", async () => {
  await renderWithProviders(<IdleState recent={[]} examples={[]} onPick={() => {}} onClearRecent={() => {}} />);
  expect(screen.getByText("Find a reel by what you remember")).toBeTruthy();
  expect(screen.queryByText("Try searching for")).toBeNull();
});

test("no results offers three of the examples, and says so as a live region", async () => {
  await renderWithProviders(
    <NoResults query="zzzz" examples={[...THREE, "fitness"]} onPick={() => {}} />,
  );
  expect(screen.getByText("Nothing matched “zzzz”").props.accessibilityLiveRegion).toBe("polite");
  for (const q of THREE) expect(screen.getByText(q)).toBeTruthy();
  expect(screen.queryByText("fitness")).toBeNull();
});
