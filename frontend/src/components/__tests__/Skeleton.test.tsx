import { render, screen } from "@testing-library/react-native";

import { Skeleton, SkeletonGrid, SkeletonGroup, SkeletonRow } from "../Skeleton";

test("a skeleton group is one progress bar a screen reader calls Loading", async () => {
  await render(
    <SkeletonGroup>
      <Skeleton />
    </SkeletonGroup>,
  );
  const bar = screen.getByRole("progressbar", { name: "Loading" });
  expect(bar.props.accessibilityState).toMatchObject({ busy: true });
});

test("a screen can say what is loading", async () => {
  await render(
    <SkeletonGroup label="Loading your stacks">
      <Skeleton />
    </SkeletonGroup>,
  );
  expect(screen.getByRole("progressbar", { name: "Loading your stacks" })).toBeTruthy();
});

test("a grid of placeholders is one progress bar too, and keeps its 12 gap both ways", async () => {
  await render(<SkeletonGrid columns={2} itemWidth={160} label="Loading your saves" />);
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  expect(screen.getByRole("progressbar", { name: "Loading your saves" })).toHaveStyle({ gap: 12 });
});

test("a placeholder row is a progress bar named Loading by default", async () => {
  await render(<SkeletonRow />);
  expect(screen.getByRole("progressbar", { name: "Loading" })).toBeTruthy();
});
