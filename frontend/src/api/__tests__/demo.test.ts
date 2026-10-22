import { NOW } from "../../test/fixtures";
import { createMemoryStore } from "../../test/memoryStore";
import { ApiError } from "../contract";
import { createDemoApi, EXPORT_MS, PENDING_MS } from "../demo";

const MOMO = "Hole-in-the-wall momo spot in Jackson Heights";
const STACK_NAMES = [
  "Food and coffee",
  "Job hunt",
  "Pacific Northwest trip",
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

test("a pending save walks through the server's stages in order, then has none", async () => {
  const { api, advance } = setup();
  const { reel_id } = await api.createSave("https://www.instagram.com/reel/NEW123/");
  const seen: (string | null | undefined)[] = [];
  for (let t = 0; t < PENDING_MS; t += 1000) {
    const card = await api.getSave(reel_id);
    expect(card.status).toBe("pending");
    // The list agrees with the detail.
    expect((await api.listSaves())[0].stage).toBe(card.stage);
    if (seen[seen.length - 1] !== card.stage) seen.push(card.stage);
    advance(1000);
  }
  expect(seen).toEqual(["resolve", "fetch", "transcribe", "vision", "structure", "finalize"]);
  const done = await api.getSave(reel_id);
  expect([done.status, done.stage]).toEqual(["enriched", null]);
  expect((await api.listSaves())[0].stage).toBeNull();
});

test("a retried save starts its stages over from the retry", async () => {
  const { api, advance } = setup();
  const partial = (await api.listSaves()).find((s) => s.status === "partial")!;
  advance(5 * 60_000);
  await api.retryEnrichment(partial.id);
  expect((await api.getSave(partial.id)).stage).toBe("resolve");
  advance(PENDING_MS * 0.6);
  expect((await api.getSave(partial.id)).stage).toBe("vision");
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
  expect(me.name).toBe("Sam Carter");
  expect([me.email, me.handle]).toEqual(["sam.carter@example.com", "samcarter"]);
});

test("getMe lists only the Google sign-in: Lately never connects an Instagram account", async () => {
  const { api } = setup();
  const me = await api.getMe();
  expect(me.connected_accounts).toEqual([{ provider: "google", label: "sam.carter@example.com", status: "secured" }]);
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
  expect(feed.date_label).toBe("Sunday, Oct 4");
  expect(feed.hero.save_ids.length).toBeGreaterThanOrEqual(2);
  expect(feed.hero.query).toBe("cafe");
  expect(feed.sections.length).toBeGreaterThanOrEqual(2);
});

test("listSaves can filter by category", async () => {
  const { api } = setup();
  const fitness = await api.listSaves({ category: "Fitness", limit: 100 });
  expect(fitness.length).toBeGreaterThan(0);
  expect(fitness.every((s) => s.category === "Fitness")).toBe(true);
});

test("a partial card can be retried and becomes pending again", async () => {
  const { api, advance } = setup();
  const before = (await api.listSaves({ limit: 100 })).find((s) => s.status === "partial");
  expect(before).toBeDefined();
  await api.retryEnrichment(before!.id);
  expect((await api.getSave(before!.id)).status).toBe("pending");
  advance(PENDING_MS + 1);
  expect((await api.getSave(before!.id)).status).toBe("enriched");
});

test("sendHint is a no-op for a known save and NOT_FOUND otherwise", async () => {
  const { api } = setup();
  const [first] = await api.listSaves();
  const before = await api.getSave(first.id);
  await api.sendHint(first.id, { caption: "from the device" });
  expect(await api.getSave(first.id)).toEqual(before);
  expect((await rejection(api.sendHint("nope", {}))).code).toBe("NOT_FOUND");
});

test("retrying an unknown save is NOT_FOUND", async () => {
  const { api } = setup();
  expect((await rejection(api.retryEnrichment("nope"))).code).toBe("NOT_FOUND");
});

test("stacks: a save can be removed and a stack deleted", async () => {
  const { api } = setup();
  const [first] = await api.listStacks();
  const detail = await api.getStack(first.id);
  const saveId = detail.saves[0].id;
  await api.removeFromStack(first.id, saveId);
  const after = await api.getStack(first.id);
  expect(after.saves.map((s) => s.id)).not.toContain(saveId);
  expect(after.save_count).toBe(detail.save_count - 1);
  await api.deleteStack(first.id);
  expect((await api.listStacks()).map((s) => s.id)).not.toContain(first.id);
  expect((await rejection(api.getStack(first.id))).code).toBe("NOT_FOUND");
  // Deleting a stack keeps its saves.
  expect((await api.getSave(saveId)).id).toBe(saveId);
});

test("deleting the account empties the library", async () => {
  const { api } = setup();
  await api.deleteAccount();
  expect(await api.listSaves()).toEqual([]);
  expect(await api.listStacks()).toEqual([]);
});

test("an export is NOT_FOUND until requested, queued briefly, then a JSON file", async () => {
  const { api, advance } = setup();
  expect((await rejection(api.downloadExport())).code).toBe("NOT_FOUND");
  await api.requestExport();
  expect(await api.downloadExport()).toEqual({ status: "queued" });
  advance(EXPORT_MS);
  const out = await api.downloadExport();
  if (out.status !== "ready") throw new Error("expected a ready export");
  expect(out.filename).toMatch(/^lately-export-\d{8}\.json$/);
  const data = JSON.parse(out.json);
  expect(data.saves.length).toBeGreaterThan(0);
  expect(data.saves[0]).toHaveProperty("source_url");
  expect(Array.isArray(data.stacks)).toBe(true);
});

describe("plan", () => {
  test("starts on the free plan with a monthly limit and no expiry", async () => {
    const { api } = setup();
    expect(await api.getMe()).toMatchObject({ plan: "free", plan_expires_at: null, saves_limit: 20 });
    expect(await api.syncPlan()).toEqual({ plan: "free", plan_expires_at: null });
  });

  test("setPlan changes what GET /me and syncPlan report", async () => {
    const { api } = setup();
    api.setPlan("pro", "2027-01-01T00:00:00.000Z");
    expect(api.currentPlan()).toBe("pro");
    expect(await api.getMe()).toMatchObject({ plan: "pro", plan_expires_at: "2027-01-01T00:00:00.000Z" });
    expect(await api.syncPlan()).toEqual({ plan: "pro", plan_expires_at: "2027-01-01T00:00:00.000Z" });
    api.setPlan("lifetime", "2027-01-01T00:00:00.000Z");
    expect(await api.getMe()).toMatchObject({ plan: "lifetime", plan_expires_at: null });
    api.setPlan("free");
    expect(await api.syncPlan()).toEqual({ plan: "free", plan_expires_at: null });
  });

  test("the sample over-limit link only trips the limit on the free plan", async () => {
    const { api } = setup();
    expect((await rejection(api.createSave("https://www.instagram.com/reel/QUOTA/"))).code).toBe("QUOTA_EXCEEDED");
    api.setPlan("pro");
    expect(await api.createSave("https://www.instagram.com/reel/QUOTA/")).toMatchObject({ deduped: false });
  });

  test("deleting the account drops back to the free plan", async () => {
    const { api } = setup();
    api.setPlan("pro");
    await api.deleteAccount();
    expect(api.currentPlan()).toBe("free");
  });
});
