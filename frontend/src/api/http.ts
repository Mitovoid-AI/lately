// FastAPI client for the API contract. Every call carries the Supabase access
// token; a 401 refreshes it once and retries.
import {
  ApiError,
  type ApiErrorCode,
  type Category,
  type Channel,
  type LatelyApi,
  type Save,
  type SaveDetail,
} from "./contract";

const KNOWN_CODES: ApiErrorCode[] = ["BAD_URL", "QUOTA_EXCEEDED", "RATE_LIMITED", "NOT_FOUND", "UNAUTHORIZED"];

/** Today's backend sends a subset of the Save fields; fill the rest. */
export function toSave(raw: Record<string, unknown>): Save {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
  return {
    id: String(raw.id),
    source_url: String(raw.source_url),
    shortcode: str("shortcode"),
    status: (raw.status as Save["status"]) ?? "pending",
    note: str("note"),
    created_at: String(raw.created_at),
    title: str("title"),
    caption: str("caption"),
    category: str("category") as Category | null,
    thumbnail_url: str("thumbnail_url"),
    creator: str("creator"),
    channel: (str("channel") as Channel | null) ?? "app_share",
  };
}

function toDetail(raw: Record<string, unknown>): SaveDetail {
  return {
    ...toSave(raw),
    summary: typeof raw.summary === "string" ? raw.summary : null,
    steps: Array.isArray(raw.steps) ? (raw.steps as string[]) : null,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : null,
    places: Array.isArray(raw.places) ? (raw.places as SaveDetail["places"]) : [],
    media_status: (raw.media_status as SaveDetail["media_status"]) ?? "pending",
  };
}

export function createHttpApi(o: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): LatelyApi {
  const doFetch = o.fetchImpl ?? fetch;

  async function send(method: string, path: string, token: string | null, body?: unknown) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      return await doFetch(`${o.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError("NETWORK", 0, e instanceof Error ? e.message : "Network request failed");
    }
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await send(method, path, await o.getToken(), body);
    if (res.status === 401) {
      const fresh = await o.refreshToken();
      if (fresh) res = await send(method, path, fresh, body);
    }
    const text = await res.text();
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (res.ok) return data as T;
    if (res.status === 401) throw new ApiError("UNAUTHORIZED", 401, "Please sign in again.");
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    const code = KNOWN_CODES.find((c) => c === err?.code);
    if (code) throw new ApiError(code, res.status, err?.message);
    if (res.status === 404) throw new ApiError("NOT_FOUND", 404, err?.message);
    throw new ApiError("SERVER", res.status, err?.message ?? `HTTP ${res.status}`);
  }

  const query = (p: Record<string, string | number | undefined>) => {
    const parts = Object.entries(p)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return {
    createSave: (text) => request("POST", "/saves", { text, channel: "app_share" }),
    listSaves: async (p = {}) =>
      (await request<Record<string, unknown>[]>("GET", `/saves${query({ before: p.before, limit: p.limit })}`)).map(
        toSave,
      ),
    getSave: async (id) => toDetail(await request("GET", `/saves/${encodeURIComponent(id)}`)),
    setNote: async (id, note) => toSave(await request("PATCH", `/saves/${encodeURIComponent(id)}`, { note })),
    deleteSave: async (id) => {
      await request("DELETE", `/saves/${encodeURIComponent(id)}`);
    },
    getMe: () => request("GET", "/me"),
    getPreferences: () => request("GET", "/me/preferences"),
    updatePreferences: (p) => request("PATCH", "/me/preferences", p),
    search: async (q) => {
      const hits = await request<{ save: Record<string, unknown>; why: string[] }[]>("GET", `/search${query({ q })}`);
      return hits.map((h) => ({ save: toSave(h.save), why: h.why ?? [] }));
    },
    listStacks: () => request("GET", "/stacks"),
    createStack: (name) => request("POST", "/stacks", { name }),
    getStack: async (id) => {
      const raw = await request<Record<string, unknown>>("GET", `/stacks/${encodeURIComponent(id)}`);
      const saves = Array.isArray(raw.saves) ? (raw.saves as Record<string, unknown>[]).map(toSave) : [];
      return { ...(raw as unknown as Omit<Awaited<ReturnType<LatelyApi["getStack"]>>, "saves">), saves };
    },
    addToStack: async (stackId, saveId) => {
      await request("POST", `/stacks/${encodeURIComponent(stackId)}/saves`, { save_id: saveId });
    },
    getCurated: () => request("GET", "/curated"),
    requestExport: () => request("POST", "/me/export"),
  };
}
