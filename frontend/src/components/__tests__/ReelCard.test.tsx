import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Save } from "../../api/contract";
import { buildDemoSeed } from "../../api/demo-data";
import { NOW } from "../../test/fixtures";
import { ReelCard } from "../ReelCard";

const seed = buildDemoSeed(NOW).saves;
const byId = (id: string): Save => seed.find((s) => s.id === id)!;

test("a ready card shows title, quoted note and category · date", async () => {
  await render(<ReelCard save={byId("s-momo")} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Hole-in-the-wall momo spot in Koramangala")).toBeTruthy();
  expect(screen.getByText("“cafe to try”")).toBeTruthy();
  expect(screen.getByText("Food & Places · 5d")).toBeTruthy();
});

test("a pending card shows the processing state and the link", async () => {
  await render(<ReelCard save={byId("s-pending")} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Getting details…")).toBeTruthy();
  expect(screen.getByText("instagram.com/reel/C8xYz12")).toBeTruthy();
});

test("a partial card says the preview is unavailable and shows the caption", async () => {
  await render(<ReelCard save={byId("s-partial")} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Preview unavailable")).toBeTruthy();
  expect(screen.getByText("Day 3 of the 30-day mobility challenge…")).toBeTruthy();
});

test("without a title it falls back to the caption's first line, then the link", async () => {
  const base = byId("s-github");
  await render(<ReelCard save={{ ...base, title: null, caption: "Line one\nLine two" }} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Line one")).toBeTruthy();
  await render(<ReelCard save={{ ...base, title: null, caption: null }} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("instagram.com/reel/GhTrick5")).toBeTruthy();
});

test("long titles clamp to two lines and notes to one", async () => {
  const long = "Bahut lamba title 🔥 ".repeat(15);
  await render(
    <ReelCard save={{ ...byId("s-github"), title: long, note: long }} now={NOW} onPress={() => {}} />,
  );
  expect(screen.getByText(long).props.numberOfLines).toBe(2);
  expect(screen.getByText(`“${long}”`).props.numberOfLines).toBe(1);
});

test("pressing the card calls onPress", async () => {
  const onPress = jest.fn();
  await render(<ReelCard save={byId("s-momo")} now={NOW} onPress={onPress} />);
  await fireEvent.press(screen.getByText("Hole-in-the-wall momo spot in Koramangala"));
  expect(onPress).toHaveBeenCalledTimes(1);
});
