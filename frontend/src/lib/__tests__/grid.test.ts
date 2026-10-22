import { gridLayout, memoryTileWidth } from "../grid";

test("a phone gets two columns of just over 160 pt, down to the smallest screens", () => {
  expect(gridLayout(375)).toEqual({ columns: 2, itemWidth: (375 - 32 - 12) / 2 });
  expect(gridLayout(320).columns).toBe(2);
  expect(gridLayout(360).columns).toBe(2);
});

test("a foldable or small tablet gets more columns instead of two stretched ones", () => {
  expect(gridLayout(600).columns).toBe(3);
  expect(gridLayout(720).columns).toBe(4);
  expect(gridLayout(840).columns).toBe(4);
});

test("tiles stay 160 pt or wider from a normal phone up", () => {
  for (const width of [375, 412, 500, 600, 768, 900, 1024, 1280]) {
    expect(gridLayout(width).itemWidth).toBeGreaterThanOrEqual(160);
  }
});

test("five columns at the most, and the grid stops growing past 1280", () => {
  expect(gridLayout(1280).columns).toBe(5);
  expect(gridLayout(2400)).toEqual(gridLayout(1280));
});

test("a Back for you tile follows the grid tile, between 120 and 176 pt", () => {
  expect(memoryTileWidth(gridLayout(375).itemWidth)).toBe(120);
  expect(memoryTileWidth(200)).toBe(144);
  expect(memoryTileWidth(400)).toBe(176);
});
