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
  expect([e.code, e.status]).toEqual(["NETWORK", 0]);
  expect((f.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
});

test("a fetch that ignores the abort signal still times out", async () => {
  const f = jest.fn(() => new Promise<Response>(() => {}));
  const e = await rejection(timed(f, 20, 1000).getMe());
  expect(e.code).toBe("NETWORK");
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
