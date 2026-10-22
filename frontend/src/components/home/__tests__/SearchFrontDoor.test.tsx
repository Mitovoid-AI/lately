import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { SEARCH_EXAMPLES } from "../../../lib/searchExamples";
import { DURATION } from "../../../theme/motion";
import { EXAMPLE_MS, SearchFrontDoor } from "../SearchFrontDoor";

// The shared setup runs every test with Reduce Motion on; here each test picks.
let mockReduced = true;
jest.mock("react-native-reanimated", () => ({
  ...jest.requireActual("react-native-reanimated/mock"),
  useReducedMotion: () => mockReduced,
}));

const EXAMPLES = ["one", "two", "three"];

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
});
afterEach(() => {
  jest.useRealTimers();
});

test("shows the first of the shared examples by default", async () => {
  mockReduced = true;
  await render(<SearchFrontDoor onPress={() => {}} />);
  expect(screen.getByText(`“${SEARCH_EXAMPLES[0]}”`)).toBeTruthy();
});

test("the whole field is one button that opens Search", async () => {
  mockReduced = true;
  const onPress = jest.fn();
  await render(<SearchFrontDoor onPress={onPress} examples={EXAMPLES} />);
  await fireEvent.press(screen.getByRole("button", { name: "Search your saves" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("with Reduce Motion the example never changes", async () => {
  mockReduced = true;
  await render(<SearchFrontDoor onPress={() => {}} examples={EXAMPLES} />);
  await act(async () => {
    jest.advanceTimersByTime(EXAMPLE_MS * 3);
  });
  expect(screen.getByText("“one”")).toBeTruthy();
  expect(screen.queryByText("“two”")).toBeNull();
});

test("otherwise it swaps to the next example every 3.5 s and wraps around", async () => {
  mockReduced = false;
  await render(<SearchFrontDoor onPress={() => {}} examples={EXAMPLES} />);
  expect(screen.getByText("“one”")).toBeTruthy();
  // Each step is one period plus the fade-out, so the text has swapped by the time it ends. (The
  // Reanimated jest mock hands out a new shared value on every render, which restarts the
  // interval after each swap; the device keeps one, so there the period is exactly 3.5 s.)
  const period = EXAMPLE_MS + DURATION.state + 10;
  await act(async () => {
    jest.advanceTimersByTime(period);
  });
  expect(screen.getByText("“two”")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(period);
  });
  expect(screen.getByText("“three”")).toBeTruthy();
  await act(async () => {
    jest.advanceTimersByTime(period);
  });
  expect(screen.getByText("“one”")).toBeTruthy();
});

test("a single example just stays put", async () => {
  mockReduced = false;
  await render(<SearchFrontDoor onPress={() => {}} examples={["only"]} />);
  await act(async () => {
    jest.advanceTimersByTime(EXAMPLE_MS * 2);
  });
  expect(screen.getByText("“only”")).toBeTruthy();
});
