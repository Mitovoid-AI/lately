import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { ApiError } from "../contract";
import { createDemoApi, PENDING_MS } from "../demo";

const MOMO = "Hole-in-the-wall momo spot in Koramangala";
const STACK_NAMES = [
  "Cafes to try",
  "Job hunt",
  "Manali trip",
  "Mobility routine",
  "Dev tools",
  "Outfit ideas",
];

function setup() {
  let now = NOW;
  const api = createDemoApi({ now: () => now, storage: createMemoryStore() });
  return { api, advance: (ms: number) => (now += ms) };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a rejection");
}

test("lists saves newest first with limit and before", async () => {
  const { api } = setup();
  const all = await api.listSaves();
  const times = all.map((s) => Date.parse(s.created_at));
  expect([...times].sort((a, b) => b - a)).toEqual(times);
  expect(await api.listSaves({ limit: 2 })).toHaveLength(2);
  const next = await api.listSaves({ before: all[1].created_at });
  expect(next[0].id).toBe(all[2].id);
});

test("a new save starts pending, lists first, then enriches", async () => {
  const { api, advance } = setup();
  const res = await api.createSave("https://www.instagram.com/reel/NEW123/");
  expect(res).toMatchObject({ deduped: false, status: "pending" });
  expect((await api.listSaves())[0].id).toBe(res.reel_id);
  advance(PENDING_MS);
  const card = await api.getSave(res.reel_id);
  expect(card.status).toBe("enriched");
  expect(card.title).not.toBeNull();
  expect(card.thumbnail_url).not.toBeNull();
});

test("saving the same reel twice is deduped", async () => {
  const { api } = setup();
  const first = await api.createSave("https://www.instagram.com/reel/NEW123/");
  const again = await api.createSave("look https://instagram.com/reel/NEW123/?igsh=x");
  expect(again).toEqual({ reel_id: first.reel_id, deduped: true, status: "pending" });
});

test("text without a reel link is BAD_URL", async () => {
  const { api } = setup();
  const e = await rejection(api.createSave("hello"));
  expect(e).toBeInstanceOf(ApiError);
  expect([e.code, e.status]).toEqual(["BAD_URL", 422]);
});

test("special demo links trigger each error", async () => {
  const { api } = setup();
  const q = await rejection(api.createSave("https://www.instagram.com/reel/QUOTA/"));
  expect([q.code, q.status]).toEqual(["QUOTA_EXCEEDED", 429]);
  const r = await rejection(api.createSave("https://www.instagram.com/reel/RATE/"));
  expect([r.code, r.status]).toEqual(["RATE_LIMITED", 429]);
  const n = await rejection(api.createSave("https://www.instagram.com/reel/NETWORK/"));
  expect([n.code, n.status]).toEqual(["NETWORK", 0]);
});

test("a PARTIAL demo link ends up partial", async () => {
  const { api, advance } = setup();
  const res = await api.createSave("https://www.instagram.com/reel/PARTIAL/");
  advance(PENDING_MS);
  expect((await api.getSave(res.reel_id)).status).toBe("partial");
});

test("notes can be set and saves deleted", async () => {
  const { api } = setup();
  const momo = (await api.listSaves()).find((s) => s.title === MOMO)!;
  expect((await api.setNote(momo.id, "for a date")).note).toBe("for a date");
  await api.deleteSave(momo.id);
  const e = await rejection(api.getSave(momo.id));
  expect([e.code, e.status]).toEqual(["NOT_FOUND", 404]);
});

test("getMe reports limit, reset date and totals", async () => {
  const { api } = setup();
  const me = await api.getMe();
  expect(me.saves_limit).toBe(20);
  expect(me.resets_on).toBe("2026-11-01");
  expect(me.total_saves).toBe((await api.listSaves({ limit: 100 })).length);
  expect(me.name).toBe("Aanya Sharma");
});

test("stacks: seeded, created, and added to", async () => {
  const { api } = setup();
  expect((await api.listStacks()).map((s) => s.name)).toEqual(STACK_NAMES);
  const trip = await api.createStack("Trip");
  expect(trip.save_count).toBe(0);
  expect((await api.listStacks()).map((s) => s.name)).toContain("Trip");
  const momo = (await api.listSaves()).find((s) => s.title === MOMO)!;
  await api.addToStack(trip.id, momo.id);
  const detail = await api.getStack(trip.id);
  expect(detail.saves.map((s) => s.id)).toContain(momo.id);
  expect(detail.save_count).toBe(1);
});

test("search ranks the momo card first for 'momo'", async () => {
  const { api } = setup();
  const momo = (await api.listSaves()).find((s) => s.title === MOMO)!;
  expect((await api.search("momo"))[0].save.id).toBe(momo.id);
});

test("preferences persist in storage", async () => {
  const store = createMemoryStore();
  const api = createDemoApi({ now: () => NOW, storage: store });
  await api.updatePreferences({ reading_font: "lora" });
  const again = createDemoApi({ now: () => NOW, storage: store });
  expect((await again.getPreferences()).reading_font).toBe("lora");
});

test("curated feed has a hero and sections", async () => {
  const { api } = setup();
  const feed = await api.getCurated();
  expect(feed.date_label).toBe("Sunday, 4 Oct");
  expect(feed.hero.save_ids.length).toBeGreaterThanOrEqual(2);
  expect(feed.hero.query).toBe("cafe");
  expect(feed.sections.length).toBeGreaterThanOrEqual(2);
});
