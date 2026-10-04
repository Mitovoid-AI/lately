import { ApiError } from "../contract";
import { createHttpApi, toSave } from "../http";

type Reply = { status: number; body?: unknown; raw?: string };

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies];
  return jest.fn(async (_url: string, _init?: RequestInit) => {
    const r = queue.shift() ?? { status: 200, body: {} };
    const text = r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text } as Response;
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
