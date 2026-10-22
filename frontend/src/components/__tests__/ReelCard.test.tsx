import { fireEvent, render, screen } from "@testing-library/react-native";

import type { Save } from "../../api/contract";
import { buildDemoSeed } from "../../api/demo-data";
import { relativeShort } from "../../lib/dates";
import { displayLink } from "../../lib/instagram";
import { NOW } from "../../test/fixtures";
import { cardTitle, ReelCard } from "../ReelCard";

const seed = buildDemoSeed(NOW).saves;
const byId = (id: string): Save => seed.find((s) => s.id === id)!;

test("a ready card shows title, quoted note, the category pill and the date", async () => {
  const save = byId("s-momo");
  await render(<ReelCard save={save} now={NOW} onPress={() => {}} />);
  expect(screen.getByText(cardTitle(save))).toBeTruthy();
  expect(screen.getByText(`“${save.note}”`)).toBeTruthy();
  expect(screen.getByText("Food")).toBeTruthy();
  expect(screen.getByText(relativeShort(save.created_at, NOW))).toBeTruthy();
});

test("a pending card shows the processing state and the link, and no category pill", async () => {
  const save = byId("s-pending");
  await render(<ReelCard save={save} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Getting details…")).toBeTruthy();
  expect(screen.getByText(displayLink(save.source_url))).toBeTruthy();
  expect(screen.queryByText("Food")).toBeNull();
});

test("a partial card says the preview is unavailable and shows the caption", async () => {
  const save = byId("s-partial");
  await render(<ReelCard save={save} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Preview unavailable")).toBeTruthy();
  expect(screen.getByText(cardTitle(save))).toBeTruthy();
});

test("without a title it falls back to the caption's first line, then the link", async () => {
  const base = byId("s-github");
  await render(<ReelCard save={{ ...base, title: null, caption: "Line one\nLine two" }} now={NOW} onPress={() => {}} />);
  expect(screen.getByText("Line one")).toBeTruthy();
  await render(<ReelCard save={{ ...base, title: null, caption: null }} now={NOW} onPress={() => {}} />);
  expect(screen.getByText(displayLink(base.source_url))).toBeTruthy();
});

test("long titles clamp to two lines and notes to one", async () => {
  const long = "A very long title with a flame 🔥 ".repeat(15);
  await render(
    <ReelCard save={{ ...byId("s-github"), title: long, note: long }} now={NOW} onPress={() => {}} />,
  );
  expect(screen.getByText(long).props.numberOfLines).toBe(2);
  expect(screen.getByText(`“${long}”`).props.numberOfLines).toBe(1);
});

test("pressing the card calls onPress", async () => {
  const save = byId("s-momo");
  const onPress = jest.fn();
  await render(<ReelCard save={save} now={NOW} onPress={onPress} />);
  await fireEvent.press(screen.getByText(cardTitle(save)));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("the card reads as one stop: title, note and the full category and date in that order", async () => {
  const save = byId("s-momo");
  await render(<ReelCard save={save} now={NOW} onPress={() => {}} />);
  const card = screen.getByRole("button");
  const label: string = card.props.accessibilityLabel;
  const title = label.indexOf(cardTitle(save));
  const note = label.indexOf(save.note!);
  const meta = label.indexOf(`${save.category} · ${relativeShort(save.created_at, NOW)}`);
  expect(title).toBeGreaterThanOrEqual(0);
  expect(note).toBeGreaterThan(title);
  expect(meta).toBeGreaterThan(note);
});

test("an enriched tile shows its title once, on the image", async () => {
  const save = byId("s-momo");
  await render(<ReelCard save={save} now={NOW} onPress={() => {}} />);
  expect(screen.getAllByText(cardTitle(save))).toHaveLength(1);
});
