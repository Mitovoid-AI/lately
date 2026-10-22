import { fireEvent, render, screen } from "@testing-library/react-native";

import { CATEGORY_ORDER, categoryPill } from "../../theme/categories";
import { CategoryPill, Chip } from "../Chip";

test("a filter chip is a button that reports its selected state and presses", async () => {
  const onPress = jest.fn();
  await render(<Chip label="Fitness" active onPress={onPress} />);
  const chip = screen.getByRole("button", { name: "Fitness", selected: true });
  await fireEvent.press(chip);
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("a filter chip without a handler is plain text", async () => {
  await render(<Chip label="All" />);
  expect(screen.queryByRole("button")).toBeNull();
});

test("a category chip is a static tinted label in the category's pill colours", async () => {
  await render(<Chip variant="category" category="Food & Places" />);
  expect(screen.queryByRole("button")).toBeNull();
  const { ink } = categoryPill("Food & Places", "light");
  expect(screen.getByText("Food & Places")).toHaveStyle({ color: ink });
});

test("every category renders its own label in its own ink", async () => {
  for (const category of CATEGORY_ORDER) {
    const { unmount } = await render(<CategoryPill category={category} />);
    expect(screen.getByText(category)).toHaveStyle({ color: categoryPill(category, "light").ink });
    await unmount();
  }
});

test("a category chip takes a custom label and becomes a button when it gets a handler", async () => {
  const onPress = jest.fn();
  await render(<Chip variant="category" category="Fitness" label="Workouts" onPress={onPress} />);
  await fireEvent.press(screen.getByRole("button", { name: "Workouts" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("the small pill (on a tile) uses the 11 pt label", async () => {
  await render(<CategoryPill category="Dev & Tools" label="Dev" size="sm" />);
  expect(screen.getByText("Dev")).toHaveStyle({ fontSize: 11 });
});
