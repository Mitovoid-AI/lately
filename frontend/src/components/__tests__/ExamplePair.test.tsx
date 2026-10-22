import { screen } from "@testing-library/react-native";

import { renderWithProviders } from "../../test/render";
import { ExamplePair } from "../ExamplePair";

test("it says it is an example: a reel on the left turns into a card on the right", async () => {
  await renderWithProviders(<ExamplePair />);
  expect(screen.getByLabelText(/^Example\. A saved reel on the left turns into a card/)).toBeTruthy();
  expect(screen.getByText("Example")).toBeTruthy();
  expect(screen.getByText("Steamed dumplings with chili crisp")).toBeTruthy();
  expect(screen.getByText("Food & Places")).toBeTruthy();
  expect(screen.getByText("Chinatown, NYC")).toBeTruthy();
});

test("it carries no stats, handles or timestamps, because it is a made-up sample, not a real reel", async () => {
  await renderWithProviders(<ExamplePair centered />);
  expect(screen.queryByText(/@\w+/)).toBeNull();
  expect(screen.queryByText(/\d+(\.\d+)?k\b/)).toBeNull();
  expect(screen.queryByText(/\b\d+:\d{2}\b/)).toBeNull();
});
