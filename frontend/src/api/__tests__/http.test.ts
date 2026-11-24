import { ApiError } from "../contract";
import { createHttpApi, DEFAULT_TIMEOUT_MS, SAVE_TIMEOUT_MS, toSave } from "../http";

type Reply = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> };

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies];
  return jest.fn(async (_url: string, _init?: RequestInit) => {
    const r: Reply = queue.shift() ?? { status: 200, body: {} };
    const text = r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    const headers = { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text, headers } as unknown as Response;
  });
}

function setup(fetchImpl: ReturnType<typeof fakeFetch>, refreshed: string | null = "tok-2") {
  const refreshToken = jest.fn(async () => refreshed);
  const api = createHttpApi({
    baseUrl: "http://api.test",
    getToken: async () => "tok-1",
    refreshToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { api, refreshToken };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a rejection");
}

const headersOf = (f: ReturnType<typeof fakeFetch>, call = 0) =>
  (f.mock.calls[call][1]?.headers ?? {}) as Record<string, string>;

test("createSave sends the bearer token and the shared text", async () => {
  const f = fakeFetch({ status: 201, body: { reel_id: "r1", deduped: false, status: "pending" } });
  const { api } = setup(f);
  await api.createSave("https://www.instagram.com/reel/abc/");
  expect(f.mock.calls[0][0]).toBe("http://api.test/saves");
  expect(headersOf(f).Authorization).toBe("Bearer tok-1");
  expect(headersOf(f)["Content-Type"]).toBe("application/json");
  expect(JSON.parse(f.mock.calls[0][1]?.body as string)).toEqual({
    text: "https://www.instagram.com/reel/abc/",
    channel: "app_share",
  });
});

test("an API error body becomes an ApiError with its code", async () => {
  const f = fakeFetch({ status: 422, body: { error: { code: "BAD_URL", message: "x" } } });
  const e = await rejection(setup(f).api.createSave("hello"));
  expect(e).toBeInstanceOf(ApiError);
  expect([e.code, e.status]).toEqual(["BAD_URL", 422]);
});

test("a non-JSON server error becomes SERVER", async () => {
  const f = fakeFetch({ status: 500, raw: "<html>oops</html>" });
  const e = await rejection(setup(f).api.listSaves());
  expect([e.code, e.status]).toEqual(["SERVER", 500]);
});

test("a failed fetch becomes NETWORK", async () => {
  const f = jest.fn(async () => {
    throw new TypeError("Network request failed");
  });
  const e = await rejection(setup(f as unknown as ReturnType<typeof fakeFetch>).api.listSaves());
  expect([e.code, e.status]).toEqual(["NETWORK", 0]);
});

test("a 401 refreshes the token once and retries", async () => {
  const f = fakeFetch({ status: 401, body: { detail: "expired" } }, { status: 200, body: [] });
  const { api, refreshToken } = setup(f);
  await expect(api.listSaves()).resolves.toEqual([]);
  expect(refreshToken).toHaveBeenCalledTimes(1);
  expect(headersOf(f, 1).Authorization).toBe("Bearer tok-2");
});

test("a refresh that fails on the network is NETWORK, not UNAUTHORIZED", async () => {
  const f = fakeFetch({ status: 401 }, { status: 200, body: [] });
  const api = createHttpApi({
    baseUrl: "http://api.test",
    getToken: async () => "tok-1",
    refreshToken: async () => {
      throw new ApiError("NETWORK", 0);
    },
    fetchImpl: f as unknown as typeof fetch,
  });
  const e = await rejection(api.listSaves());
  expect(e.code).toBe("NETWORK");
});

test("a refresh that throws something unexpected is NETWORK too", async () => {
  const f = fakeFetch({ status: 401 });
  const api = createHttpApi({
    baseUrl: "http://api.test",
    getToken: async () => "tok-1",
    refreshToken: async () => {
      throw new TypeError("fetch failed");
    },
    fetchImpl: f as unknown as typeof fetch,
  });
  expect((await rejection(api.listSaves())).code).toBe("NETWORK");
});

test("a second 401 is UNAUTHORIZED", async () => {
  const f = fakeFetch({ status: 401 }, { status: 401 });
  const e = await rejection(setup(f).api.listSaves());
  expect([e.code, e.status]).toEqual(["UNAUTHORIZED", 401]);
});

test("a deduped save comes back as deduped", async () => {
  const f = fakeFetch({ status: 200, body: { reel_id: "r1", deduped: true, status: "pending" } });
  expect((await setup(f).api.createSave("https://www.instagram.com/reel/abc/")).deduped).toBe(true);
});

test("listSaves passes the keyset cursor and limit", async () => {
  const f = fakeFetch({ status: 200, body: [] });
  await setup(f).api.listSaves({ before: "2026-10-01T00:00:00Z", limit: 25 });
  expect(f.mock.calls[0][0]).toBe("http://api.test/saves?before=2026-10-01T00%3A00%3A00Z&limit=25");
});

test("toSave fills fields today's backend does not send", () => {
  const s = toSave({
    id: "r1",
    source_url: "https://www.instagram.com/reel/abc/",
    status: "pending",
    note: null,
    created_at: "2026-10-04T00:00:00Z",
  });
  expect(s.title).toBeNull();
  expect(s.thumbnail_url).toBeNull();
  expect(s.channel).toBe("app_share");
});

test("toSave drops categories the app does not know", () => {
  const base = { id: "r1", source_url: "u", status: "enriched", note: null, created_at: "2026-10-04T00:00:00Z" };
  expect(toSave({ ...base, category: "Travel" }).category).toBeNull();
  expect(toSave({ ...base, category: "Fitness" }).category).toBe("Fitness");
});

test("toSave keeps the enrich stage of a pending save and nothing else", () => {
  const base = { id: "r1", source_url: "u", note: null, created_at: "2026-10-04T00:00:00Z" };
  expect(toSave({ ...base, status: "pending", stage: "transcribe" }).stage).toBe("transcribe");
  // A step this app has never heard of (a newer server) reads as none, so the tracker never shows it.
  expect(toSave({ ...base, status: "pending", stage: "re-rank" }).stage).toBeNull();
  // Older servers send no stage at all.
  expect(toSave({ ...base, status: "pending" }).stage).toBeNull();
  // A finished card has no step, even if the server left one on the row.
  expect(toSave({ ...base, status: "enriched", stage: "finalize" }).stage).toBeNull();
});

test("listSaves passes a category filter", async () => {
  const f = fakeFetch({ status: 200, body: [] });
  await setup(f).api.listSaves({ category: "Food & Places", limit: 25 });
  expect(f.mock.calls[0][0]).toBe("http://api.test/saves?limit=25&category=Food%20%26%20Places");
});

const SAVE = {
  id: "r1",
  source_url: "https://www.instagram.com/reel/abc/",
  shortcode: "abc",
  status: "enriched",
  note: null,
  created_at: "2026-10-04T00:00:00Z",
  title: "T",
  category: "Fitness",
};

test("getSave and listSaves carry the stage through", async () => {
  const pending = { ...SAVE, status: "pending", stage: "vision" };
  const f = fakeFetch({ status: 200, body: pending }, { status: 200, body: [pending, SAVE] });
  const { api } = setup(f);
  expect((await api.getSave("r1")).stage).toBe("vision");
  expect((await api.listSaves()).map((s) => s.stage)).toEqual(["vision", null]);
});

const callOf = (f: ReturnType<typeof fakeFetch>, call = 0) => ({
  url: f.mock.calls[call][0],
  method: f.mock.calls[call][1]?.method,
  body: f.mock.calls[call][1]?.body ? JSON.parse(f.mock.calls[call][1]?.body as string) : undefined,
});

type Api = ReturnType<typeof setup>["api"];

test("every contract call hits its path and method", async () => {
  const cases: [string, (api: Api) => Promise<unknown>, string, string, unknown?, Reply?][] = [
    ["getSave", (a) => a.getSave("r 1"), "GET", "/saves/r%201", undefined, { status: 200, body: SAVE }],
    ["setNote", (a) => a.setNote("r1", "hi"), "PATCH", "/saves/r1", { note: "hi" }, { status: 200, body: SAVE }],
    ["deleteSave", (a) => a.deleteSave("r1"), "DELETE", "/saves/r1", undefined, { status: 204 }],
    ["getMe", (a) => a.getMe(), "GET", "/me"],
    ["getPreferences", (a) => a.getPreferences(), "GET", "/me/preferences"],
    ["updatePreferences", (a) => a.updatePreferences({ text_size: 18 }), "PATCH", "/me/preferences", { text_size: 18 }],
    ["search", (a) => a.search("momo cafe"), "GET", "/search?q=momo%20cafe", undefined, { status: 200, body: [] }],
    ["listStacks", (a) => a.listStacks(), "GET", "/stacks", undefined, { status: 200, body: [] }],
    ["createStack", (a) => a.createStack("Trip"), "POST", "/stacks", { name: "Trip" }, { status: 201, body: { id: "st1", name: "Trip" } }],
    ["renameStack", (a) => a.renameStack("st 1", "Goa"), "PATCH", "/stacks/st%201", { name: "Goa" }, { status: 200, body: { id: "st 1", name: "Goa" } }],
    ["listCategories", (a) => a.listCategories(), "GET", "/saves/categories", undefined, { status: 200, body: [] }],
    ["getInstagramLink", (a) => a.getInstagramLink(), "GET", "/me/instagram"],
    ["createInstagramCode", (a) => a.createInstagramCode(), "POST", "/me/instagram/code"],
    ["unlinkInstagram", (a) => a.unlinkInstagram(), "DELETE", "/me/instagram", undefined, { status: 204 }],
    ["getStack", (a) => a.getStack("st1"), "GET", "/stacks/st1", undefined, { status: 200, body: { id: "st1", name: "x", saves: [] } }],
    ["addToStack", (a) => a.addToStack("st1", "r1"), "POST", "/stacks/st1/saves", { save_id: "r1" }, { status: 204 }],
    ["removeFromStack", (a) => a.removeFromStack("st1", "r1"), "DELETE", "/stacks/st1/saves/r1", undefined, { status: 204 }],
    ["deleteStack", (a) => a.deleteStack("st1"), "DELETE", "/stacks/st1", undefined, { status: 204 }],
    ["getCurated", (a) => a.getCurated(), "GET", "/curated", undefined, { status: 200, body: { sections: [] } }],
    ["requestExport", (a) => a.requestExport(), "POST", "/me/export", undefined, { status: 202, body: { status: "queued" } }],
    ["retryEnrichment", (a) => a.retryEnrichment("r1"), "POST", "/retries/r1", undefined, { status: 202, body: {} }],
    ["deleteAccount", (a) => a.deleteAccount(), "DELETE", "/me", undefined, { status: 204 }],
    [
      "sendHint",
      (a) => a.sendHint("r1", { caption: "c", shortcode: "SC1" }),
      "POST",
      "/saves/r1/hint",
      { caption: "c", shortcode: "SC1" },
      { status: 202, body: { status: "accepted", requeued: false } },
    ],
  ];
  for (const [name, call, method, path, body, reply] of cases) {
    const f = fakeFetch(reply ?? { status: 200, body: {} });
    await call(setup(f).api);
    expect([name, callOf(f)]).toEqual([name, { url: `http://api.test${path}`, method, body }]);
  }
});

test("search maps {save, why, matched_by} items to hits", async () => {
  const f = fakeFetch({
    status: 200,
    body: [{ save: { ...SAVE, category: "Travel" }, why: ["#momos"], matched_by: ["keyword", "meaning"] }],
  });
  const [hit] = await setup(f).api.search("momo");
  expect(hit.save.id).toBe("r1");
  expect(hit.save.category).toBeNull();
  expect(hit.why).toEqual(["#momos"]);
  expect(hit.matched_by).toEqual(["keyword", "meaning"]);
});

test("stacks fill missing fields and drop unknown categories", async () => {
  const f = fakeFetch({ status: 200, body: [{ id: "st1", name: "Trip", category: "Travel", updated_at: "2026-10-04T00:00:00Z" }] });
  const [st] = await setup(f).api.listStacks();
  expect(st).toEqual({ id: "st1", name: "Trip", category: null, save_count: 0, updated_at: "2026-10-04T00:00:00Z", cover_urls: [] });
});

test("curated saves go through toSave", async () => {
  const f = fakeFetch({
    status: 200,
    body: {
      date_label: "Sat",
      hero: { label: "L", title: "T", subtitle: "S", image_url: null, save_ids: ["r1"], query: "cafe" },
      sections: [{ kind: "row", title: "Row", subtitle: null, saves: [{ ...SAVE, category: "Travel" }] }],
    },
  });
  const feed = await setup(f).api.getCurated();
  expect(feed.sections[0].saves[0].category).toBeNull();
  expect(feed.sections[0].saves[0].channel).toBe("app_share");
  expect(feed.hero.query).toBe("cafe");
});

test("a curated feed without a hero gets an empty one", async () => {
  const f = fakeFetch({ status: 200, body: { date_label: "Sat", hero: null, sections: [] } });
  const feed = await setup(f).api.getCurated();
  expect(feed.hero.save_ids).toEqual([]);
});

test("getStack maps its saves", async () => {
  const f = fakeFetch({ status: 200, body: { id: "st1", name: "x", save_count: 1, saves: [SAVE] } });
  const st = await setup(f).api.getStack("st1");
  expect(st.saves[0].title).toBe("T");
  expect(st.cover_urls).toEqual([]);
});

test("a 404 on delete is NOT_FOUND", async () => {
  const f = fakeFetch({ status: 404, body: { error: { code: "NOT_FOUND", message: "gone" } } });
  const e = await rejection(setup(f).api.deleteSave("r1"));
  expect(e.code).toBe("NOT_FOUND");
});

/** A fetch that answers after `ms`, or rejects as soon as its signal aborts. */
function slowFetch(ms: number, reply: Reply = { status: 200, body: [] }) {
  return jest.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const t = setTimeout(() => resolve(fakeFetch(reply)("", init)), ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("Aborted"));
        });
      }),
  );
}

function timed(fetchImpl: unknown, timeoutMs: number, saveTimeoutMs: number) {
  return createHttpApi({
    baseUrl: "http://api.test",
    getToken: async () => "tok-1",
    refreshToken: async () => null,
    fetchImpl: fetchImpl as typeof fetch,
    timeoutMs,
    saveTimeoutMs,
  });
}

test("a request that takes longer than the timeout is aborted as NETWORK", async () => {
  const f = slowFetch(500);
  const e = await rejection(timed(f, 20, 1000).listSaves());
  expect([e.code, e.status, e.timeout]).toEqual(["NETWORK", 0, true]);
  expect((f.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
});

test("a fetch that ignores the abort signal still times out", async () => {
  const f = jest.fn(() => new Promise<Response>(() => {}));
  const e = await rejection(timed(f, 20, 1000).getMe());
  expect([e.code, e.timeout]).toEqual(["NETWORK", true]);
});

test("a failed fetch is NETWORK but not a timeout", async () => {
  const f = jest.fn(async () => {
    throw new TypeError("Network request failed");
  });
  expect((await rejection(timed(f, 1000, 1000).listSaves())).timeout).toBe(false);
});

test("createSave gets the longer save timeout", async () => {
  const f = slowFetch(60, { status: 201, body: { reel_id: "r1", deduped: false, status: "pending" } });
  await expect(timed(f, 20, 1000).createSave("https://www.instagram.com/reel/abc/")).resolves.toMatchObject({ reel_id: "r1" });
});

test("the default timeouts are 15 s, and 25 s for a save", () => {
  expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
  expect(SAVE_TIMEOUT_MS).toBe(25_000);
});

test("downloadExport returns the JSON file and its name when it is ready", async () => {
  const f = fakeFetch({
    status: 200,
    raw: '{"saves":[]}',
    headers: { "content-disposition": 'attachment; filename="lately-export-20261010.json"' },
  });
  const out = await setup(f).api.downloadExport();
  expect(callOf(f)).toEqual({ url: "http://api.test/me/export", method: "GET", body: undefined });
  expect(out).toEqual({ status: "ready", filename: "lately-export-20261010.json", json: '{"saves":[]}' });
});

test("downloadExport without a Content-Disposition still names the file", async () => {
  const f = fakeFetch({ status: 200, raw: "{}" });
  expect(await setup(f).api.downloadExport()).toEqual({ status: "ready", filename: "lately-export.json", json: "{}" });
});

test("downloadExport is queued while the export is being built", async () => {
  const f = fakeFetch({ status: 202, body: { status: "queued" } });
  expect(await setup(f).api.downloadExport()).toEqual({ status: "queued" });
});

test("downloadExport before any request is NOT_FOUND", async () => {
  const f = fakeFetch({ status: 404, body: { error: { code: "NOT_FOUND", message: "No export yet." } } });
  expect((await rejection(setup(f).api.downloadExport())).code).toBe("NOT_FOUND");
});

describe("syncPlan (POST /billing/sync)", () => {
  test("asks the server to re-read the plan and returns what it holds", async () => {
    const f = fakeFetch({ status: 200, body: { plan: "pro", plan_expires_at: "2027-01-01T00:00:00Z" } });
    const { api } = setup(f);
    await expect(api.syncPlan()).resolves.toEqual({ plan: "pro", plan_expires_at: "2027-01-01T00:00:00Z" });
    expect(f.mock.calls[0][0]).toBe("http://api.test/billing/sync");
    expect(f.mock.calls[0][1]?.method).toBe("POST");
    expect(headersOf(f).Authorization).toBe("Bearer tok-1");
  });

  test("free, lifetime and a missing expiry", async () => {
    const f = fakeFetch(
      { status: 200, body: { plan: "free", plan_expires_at: null } },
      { status: 200, body: { plan: "lifetime" } },
    );
    const { api } = setup(f);
    await expect(api.syncPlan()).resolves.toEqual({ plan: "free", plan_expires_at: null });
    await expect(api.syncPlan()).resolves.toEqual({ plan: "lifetime", plan_expires_at: null });
  });

  test("a plan the app doesn't know reads as free", async () => {
    const f = fakeFetch({ status: 200, body: { plan: "platinum", plan_expires_at: 5 } }, { status: 200, raw: "" });
    const { api } = setup(f);
    await expect(api.syncPlan()).resolves.toEqual({ plan: "free", plan_expires_at: null });
    await expect(api.syncPlan()).resolves.toEqual({ plan: "free", plan_expires_at: null });
  });

  test("RevenueCat being unreachable is BILLING_UNAVAILABLE", async () => {
    const f = fakeFetch({ status: 502, body: { error: { code: "BILLING_UNAVAILABLE", message: "Billing is unavailable." } } });
    const e = await rejection(setup(f).api.syncPlan());
    expect(e).toBeInstanceOf(ApiError);
    expect([e.code, e.status, e.message]).toEqual(["BILLING_UNAVAILABLE", 502, "Billing is unavailable."]);
  });

  test("GET /me passes plan_expires_at through", async () => {
    const f = fakeFetch({ status: 200, body: { id: "u", plan: "pro", plan_expires_at: "2027-01-01T00:00:00Z" } });
    const me = await setup(f).api.getMe();
    expect(me.plan_expires_at).toBe("2027-01-01T00:00:00Z");
  });
});

describe("error codes (issue #26)", () => {
  const codeFor = async (reply: Reply) => {
    const e = await rejection(setup(fakeFetch(reply)).api.getSave("r1"));
    expect(e).toBeInstanceOf(ApiError);
    return [e.code, e.status];
  };

  test("a 404 is NOT_FOUND only when it carries the API's own error shape", async () => {
    expect(await codeFor({ status: 404, body: { error: { code: "NOT_FOUND", message: "gone" } } })).toEqual(["NOT_FOUND", 404]);
    // An API 404 with a code this app has never heard of is still the API saying "not there".
    expect(await codeFor({ status: 404, body: { error: { code: "SAVE_GONE" } } })).toEqual(["NOT_FOUND", 404]);
    // FastAPI's bare route miss, a tunnel's page, an empty answer: the API was not reached as expected.
    expect(await codeFor({ status: 404, body: { detail: "Not Found" } })).toEqual(["SERVER", 404]);
    expect(await codeFor({ status: 404, raw: "<html>Tunnel not found</html>" })).toEqual(["SERVER", 404]);
    expect(await codeFor({ status: 404 })).toEqual(["SERVER", 404]);
    expect(await codeFor({ status: 404, body: { error: "not found" } })).toEqual(["SERVER", 404]);
  });

  test("without a known code, the status decides", async () => {
    expect(await codeFor({ status: 422, body: { detail: [{ loc: ["body", "name"], msg: "too long" }] } })).toEqual(["BAD_REQUEST", 422]);
    expect(await codeFor({ status: 400, body: { error: { code: "WHATEVER" } } })).toEqual(["BAD_REQUEST", 400]);
    expect(await codeFor({ status: 403, raw: "Forbidden" })).toEqual(["BAD_REQUEST", 403]);
    expect(await codeFor({ status: 413, raw: "Request Entity Too Large" })).toEqual(["TOO_LARGE", 413]);
    expect(await codeFor({ status: 429, body: { detail: "slow down" } })).toEqual(["RATE_LIMITED", 429]);
    expect(await codeFor({ status: 503, raw: "Service Unavailable" })).toEqual(["SERVER", 503]);
    expect(await codeFor({ status: 500, body: { error: { code: "BOOM" } } })).toEqual(["SERVER", 500]);
  });

  test("a code the app knows wins over the status", async () => {
    expect(await codeFor({ status: 400, body: { error: { code: "TOO_LARGE" } } })).toEqual(["TOO_LARGE", 400]);
    expect(await codeFor({ status: 422, body: { error: { code: "BAD_REQUEST", message: "Name too long." } } })).toEqual(["BAD_REQUEST", 422]);
    expect(await codeFor({ status: 429, body: { error: { code: "QUOTA_EXCEEDED" } } })).toEqual(["QUOTA_EXCEEDED", 429]);
  });

  test("a 401 after the refresh is UNAUTHORIZED whatever its body", async () => {
    const f = fakeFetch({ status: 401, raw: "nope" }, { status: 401, body: { detail: "Not authenticated" } });
    expect((await rejection(setup(f).api.getSave("r1"))).code).toBe("UNAUTHORIZED");
  });

  test("downloadExport surfaces a failed archive as EXPORT_FAILED", async () => {
    const f = fakeFetch({ status: 500, body: { error: { code: "EXPORT_FAILED", message: "The export could not be built." } } });
    const e = await rejection(setup(f).api.downloadExport());
    expect([e.code, e.status, e.message]).toEqual(["EXPORT_FAILED", 500, "The export could not be built."]);
  });
});

test("every request says the phone's UTC offset in minutes east", async () => {
  const offset = jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-330);
  try {
    const f = fakeFetch({ status: 200, body: [] }, { status: 201, body: { id: "st1", name: "x" } }, { status: 204 });
    const { api } = setup(f);
    await api.listSaves();
    await api.createStack("x");
    await api.deleteStack("st1");
    expect([0, 1, 2].map((i) => headersOf(f, i)["X-Timezone-Offset"])).toEqual(["330", "330", "330"]);
    offset.mockReturnValue(300); // US Eastern: five hours behind UTC
    await api.getMe();
    expect(headersOf(f, 3)["X-Timezone-Offset"]).toBe("-300");
  } finally {
    offset.mockRestore();
  }
});

test("retryEnrichment says whether a worker is already on it", async () => {
  const f = fakeFetch(
    { status: 202, body: { status: "queued" } },
    { status: 202, body: { status: "running" } },
    { status: 202 },
    { status: 202, body: { status: "exploded" } },
  );
  const { api } = setup(f);
  expect(await api.retryEnrichment("r1")).toEqual({ status: "queued" });
  expect(await api.retryEnrichment("r1")).toEqual({ status: "running" });
  // An older server's empty answer, or a status this app does not know, reads as queued.
  expect(await api.retryEnrichment("r1")).toEqual({ status: "queued" });
  expect(await api.retryEnrichment("r1")).toEqual({ status: "queued" });
});

test("listCategories keeps the categories this app knows", async () => {
  const f = fakeFetch({
    status: 200,
    body: [
      { category: "Fitness", count: 3 },
      { category: "Travel", count: 9 },
      { category: "Food & Places", count: "2" },
      { category: "Dev & Tools", count: 1 },
    ],
  });
  expect(await setup(f).api.listCategories()).toEqual([
    { category: "Fitness", count: 3 },
    { category: "Food & Places", count: 0 },
    { category: "Dev & Tools", count: 1 },
  ]);
});

test("renameStack returns the renamed stack", async () => {
  const f = fakeFetch({ status: 200, body: { id: "st1", name: "Goa trip", save_count: 2, updated_at: "2026-11-01T00:00:00Z" } });
  expect(await setup(f).api.renameStack("st1", "Goa trip")).toMatchObject({ id: "st1", name: "Goa trip", save_count: 2 });
});

test("a 422 on renameStack is BAD_REQUEST", async () => {
  const f = fakeFetch({ status: 422, body: { error: { code: "BAD_REQUEST", message: "Name too long." } } });
  expect((await rejection(setup(f).api.renameStack("st1", "x".repeat(200)))).code).toBe("BAD_REQUEST");
});

describe("Instagram link", () => {
  const LINK = {
    enabled: true,
    handle: "lately.app",
    linked: false,
    linked_at: null,
    code: "LATELY-7K2QXM",
    code_expires_at: "2026-11-24T10:15:00Z",
  };

  test("getInstagramLink and createInstagramCode map the link", async () => {
    const linked = { ...LINK, linked: true, linked_at: "2026-11-24T10:02:00Z", code: null, code_expires_at: null };
    const f = fakeFetch({ status: 201, body: LINK }, { status: 200, body: linked });
    const { api } = setup(f);
    expect(await api.createInstagramCode()).toEqual(LINK);
    expect(await api.getInstagramLink()).toEqual(linked);
  });

  test("missing fields read as off and not linked", async () => {
    const f = fakeFetch({ status: 200, body: { handle: 7, linked: "yes" } }, { status: 200, raw: "" });
    const { api } = setup(f);
    const none = { enabled: false, handle: null, linked: false, linked_at: null, code: null, code_expires_at: null };
    expect(await api.getInstagramLink()).toEqual(none);
    expect(await api.getInstagramLink()).toEqual(none);
  });

  test("unlinkInstagram sends DELETE and resolves on 204", async () => {
    const f = fakeFetch({ status: 204 });
    await expect(setup(f).api.unlinkInstagram()).resolves.toBeUndefined();
    expect(callOf(f)).toEqual({ url: "http://api.test/me/instagram", method: "DELETE", body: undefined });
  });
});

test("toSave keeps the fail reason of a partial card and nothing else", () => {
  const base = { id: "r1", source_url: "u", note: null, created_at: "2026-10-04T00:00:00Z" };
  expect(toSave({ ...base, status: "partial", fail_reason: "fetch_blocked" }).fail_reason).toBe("fetch_blocked");
  expect(toSave({ ...base, status: "partial", fail_reason: "cosmic_rays" }).fail_reason).toBeNull();
  expect(toSave({ ...base, status: "partial" }).fail_reason).toBeNull();
  expect(toSave({ ...base, status: "enriched", fail_reason: "timed_out" }).fail_reason).toBeNull();
});
