import { render, screen } from "@testing-library/react-native";

import { categoryPill } from "../../theme/categories";
import { CategoryPill } from "../Chip";

// Espresso is on: the pill on a card's page follows it, but a pill on a photo must not.
jest.mock("../../theme/ThemeProvider", () => {
  const actual = jest.requireActual("../../theme/ThemeProvider");
  return { ...actual, useTheme: () => actual.THEMES.dark };
});

test("on a page the category pill takes the Espresso tint and ink", async () => {
  await render(<CategoryPill category="Food & Places" />);
  expect(screen.getByText("Food & Places")).toHaveStyle({ color: categoryPill("Food & Places", "dark").ink });
});

test("on a photo it keeps the light tint and deep ink, which read on a dark photo in either theme", async () => {
  await render(<CategoryPill category="Food & Places" onPhoto />);
  expect(screen.getByText("Food & Places")).toHaveStyle({ color: categoryPill("Food & Places", "light").ink });
});
