// FastAPI client for the API contract. Every call carries the Supabase access
// token; a 401 refreshes it once and retries.
import {
  ApiError,
  CATEGORIES,
  DEFAULT_PREFERENCES,
  SAVE_STAGES,
  type ApiErrorCode,
  type CategoryCount,
  type Channel,
  type CuratedFeed,
  type CuratedSection,
  type FailReason,
  type InstagramLink,
  type LatelyApi,
  type Me,
  type PlanSync,
  type Preferences,
  type Save,
  type SaveDetail,
  type SaveStage,
  type SearchHit,
  type Stack,
  type StackDetail,
} from "./contract";

// Codes the server may name in {"error": {"code": ...}}. NETWORK is the app's own (never the server's).
const KNOWN_CODES: ApiErrorCode[] = [
  "BAD_URL",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "BILLING_UNAVAILABLE",
  "BAD_REQUEST",
  "TOO_LARGE",
  "EXPORT_FAILED",
  "SERVER",
];

/**
 * The code for an error answer whose body names none this app knows. A 404 is NOT_FOUND only
 * when it is the API's own (`shaped`: the body is {"error": {"code": ...}}); a tunnel or proxy
 * page, or FastAPI's bare {"detail": "Not Found"}, means the server could not be reached as expected.
 */
function codeForStatus(status: number, shaped: boolean): ApiErrorCode {
  if (status === 404) return shaped ? "NOT_FOUND" : "SERVER";
  if (status === 429) return "RATE_LIMITED";
  if (status === 413) return "TOO_LARGE";
  return status >= 400 && status < 500 ? "BAD_REQUEST" : "SERVER";
}

const FAIL_REASONS: readonly FailReason[] = ["fetch_blocked", "unavailable", "ai_unavailable", "timed_out"];

type Raw = Record<string, unknown>;

const strOf = (raw: Raw, k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : null);
const categoryOf = (v: unknown) => CATEGORIES.find((c) => c === v) ?? null;
/** A stage this app knows; anything else (a newer server's step, a missing field) is none. */
const stageOf = (v: unknown): SaveStage | null => SAVE_STAGES.find((x) => x === v) ?? null;
const failReasonOf = (v: unknown): FailReason | null => FAIL_REASONS.find((x) => x === v) ?? null;
const listOf = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

/** The backend may send a subset of the Save fields; fill the rest. */
export function toSave(raw: Raw): Save {
  const str = (k: string) => strOf(raw, k);
  const status = (raw.status as Save["status"]) ?? "pending";
  return {
    id: String(raw.id ?? raw.reel_id),
    source_url: String(raw.source_url),
    shortcode: str("shortcode"),
    status,
    note: str("note"),
    created_at: String(raw.created_at),
    title: str("title"),
    caption: str("caption"),
    category: categoryOf(raw.category),
    thumbnail_url: str("thumbnail_url"),
    creator: str("creator"),
    channel: (str("channel") as Channel | null) ?? "app_share",
    // Only a pending save has a step; a stale value on a finished one is dropped.
    stage: status === "pending" ? stageOf(raw.stage) : null,
    // Likewise only a partial card has a reason it could not be completed.
    fail_reason: status === "partial" ? failReasonOf(raw.fail_reason) : null,
  };
}

function toDetail(raw: Raw): SaveDetail {
  return {
    ...toSave(raw),
    summary: typeof raw.summary === "string" ? raw.summary : null,
    steps: Array.isArray(raw.steps) ? (raw.steps as string[]) : null,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : null,
    places: Array.isArray(raw.places) ? (raw.places as SaveDetail["places"]) : [],
    media_status: (raw.media_status as SaveDetail["media_status"]) ?? "pending",
  };
}

function toStack(raw: Raw): Stack {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    category: categoryOf(raw.category),
    save_count: typeof raw.save_count === "number" ? raw.save_count : 0,
    updated_at: String(raw.updated_at ?? raw.created_at ?? new Date(0).toISOString()),
    cover_urls: Array.isArray(raw.cover_urls) ? (raw.cover_urls as unknown[]).filter((u): u is string => typeof u === "string") : [],
  };
}

function toStackDetail(raw: Raw): StackDetail {
  const saves = listOf(raw.saves).map(toSave);
  const stack = toStack(raw);
  return { ...stack, save_count: typeof raw.save_count === "number" ? raw.save_count : saves.length, saves };
}

/** Search items are {save, why, matched_by}; a flat item (the save's fields + why) is accepted too. */
function toHit(raw: Raw): SearchHit {
  const save = raw.save && typeof raw.save === "object" ? (raw.save as Raw) : raw;
  const hit: SearchHit = { save: toSave(save), why: Array.isArray(raw.why) ? (raw.why as string[]) : [] };
  if (Array.isArray(raw.matched_by)) hit.matched_by = raw.matched_by as string[];
  return hit;
}

function toCurated(raw: Raw): CuratedFeed {
  const hero = (raw.hero && typeof raw.hero === "object" ? raw.hero : {}) as Raw;
  return {
    date_label: String(raw.date_label ?? ""),
    hero: {
      label: String(hero.label ?? ""),
      title: String(hero.title ?? ""),
      subtitle: String(hero.subtitle ?? ""),
      image_url: strOf(hero, "image_url"),
      save_ids: Array.isArray(hero.save_ids) ? (hero.save_ids as unknown[]).map(String) : [],
      query: String(hero.query ?? ""),
    },
    sections: listOf(raw.sections).map(
      (s): CuratedSection => ({
        kind: s.kind === "list" ? "list" : "row",
        title: String(s.title ?? ""),
        subtitle: strOf(s, "subtitle"),
        saves: listOf(s.saves).map(toSave),
      }),
    ),
  };
}

/** POST /billing/sync answers {plan, plan_expires_at}; anything unexpected reads as the free plan. */
function toPlanSync(raw: Raw | undefined): PlanSync {
  const plan = raw?.plan === "pro" || raw?.plan === "lifetime" ? (raw.plan as Me["plan"]) : "free";
  return { plan, plan_expires_at: raw ? strOf(raw, "plan_expires_at") : null };
}

/** GET /me/instagram and POST /me/instagram/code answer the same shape; anything missing reads as off or not linked. */
function toInstagramLink(raw: Raw | undefined): InstagramLink {
  const str = (k: string) => (raw ? strOf(raw, k) : null);
  return {
    enabled: raw?.enabled === true,
    handle: str("handle"),
    linked: raw?.linked === true,
    linked_at: str("linked_at"),
    code: str("code"),
    code_expires_at: str("code_expires_at"),
  };
}

/** How long one call may take before it is given up as NETWORK. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Saving waits a little longer: the server checks the link and quota before answering. */
export const SAVE_TIMEOUT_MS = 25_000;

/** `attachment; filename="x.json"` → `x.json`; anything unsafe or missing → a fixed name. */
function filenameFrom(disposition: string | null | undefined): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  let name = m ? m[1].trim() : "";
  try {
    name = decodeURIComponent(name);
  } catch {
    name = "";
  }
  return /^[\w.-]+\.json$/.test(name) ? name : "lately-export.json";
}

export function createHttpApi(o: {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  refreshToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  saveTimeoutMs?: number;
}): LatelyApi {
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const saveTimeoutMs = o.saveTimeoutMs ?? SAVE_TIMEOUT_MS;

  async function send(method: string, path: string, token: string | null, body?: unknown) {
    // The phone's UTC offset in minutes east (India is 330), so the server can work in the person's day.
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Timezone-Offset": String(-new Date().getTimezoneOffset()),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // A request (headers and body) that takes too long is abandoned as NETWORK (flagged
    // `timeout`), so nothing waits forever on a dead connection. The race also covers a fetch
    // that ignores `signal`.
    const ms = method === "POST" && path === "/saves" ? saveTimeoutMs : timeoutMs;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new ApiError("NETWORK", 0, "The request timed out.", true));
      }, ms);
    });
    const attempt = (async () => {
      const res = await doFetch(`${o.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      return { res, text: await res.text() };
    })();
    attempt.catch(() => {}); // settled by the race below; don't report it twice
    try {
      return await Promise.race([attempt, timeout]);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (ctrl.signal.aborted) throw new ApiError("NETWORK", 0, "The request timed out.", true);
      throw new ApiError("NETWORK", 0, e instanceof Error ? e.message : "Network request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends the call (refreshing the token once on a 401); a non-2xx answer throws an ApiError. */
  async function exchange(method: string, path: string, body?: unknown): Promise<{ res: Response; text: string; data: unknown }> {
    let { res, text } = await send(method, path, await o.getToken(), body);
    if (res.status === 401) {
      // A refresh that can't reach Supabase is NETWORK (retry later), never UNAUTHORIZED.
      const fresh = await o.refreshToken().catch((e: unknown) => {
        throw e instanceof ApiError ? e : new ApiError("NETWORK", 0, e instanceof Error ? e.message : "Couldn't refresh the session.");
      });
      if (fresh) ({ res, text } = await send(method, path, fresh, body));
    }
    let data: unknown = undefined;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (res.ok) return { res, text, data };
    if (res.status === 401) throw new ApiError("UNAUTHORIZED", 401, "Please sign in again.");
    const shape = (data as { error?: { code?: unknown; message?: string } } | null | undefined)?.error;
    // Only {"error": {"code": ...}} is the API's own error; any other body gets a code from its status.
    const err = shape && typeof shape === "object" && typeof shape.code === "string" ? shape : undefined;
    const code = KNOWN_CODES.find((c) => c === err?.code);
    if (code) throw new ApiError(code, res.status, err?.message);
    throw new ApiError(codeForStatus(res.status, !!err), res.status, err?.message ?? `HTTP ${res.status}`);
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await exchange(method, path, body)).data as T;
  }

  /** For 202/204 calls: the body (if any) is not needed. */
  async function call(method: string, path: string, body?: unknown): Promise<void> {
    await request<unknown>(method, path, body);
  }

  const query = (p: Record<string, string | number | undefined>) => {
    const parts = Object.entries(p)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };
  const seg = encodeURIComponent;

  return {
    createSave: (text) => request("POST", "/saves", { text, channel: "app_share" }),
    listSaves: async (p = {}) =>
      listOf(await request("GET", `/saves${query({ before: p.before, limit: p.limit, category: p.category })}`)).map(toSave),
    // Categories this app does not know are left out, like a save's unknown category.
    listCategories: async () =>
      listOf(await request("GET", "/saves/categories")).flatMap((raw): CategoryCount[] => {
        const category = categoryOf(raw.category);
        return category ? [{ category, count: typeof raw.count === "number" ? raw.count : 0 }] : [];
      }),
    getSave: async (id) => toDetail(await request("GET", `/saves/${seg(id)}`)),
    setNote: async (id, note) => toSave(await request("PATCH", `/saves/${seg(id)}`, { note })),
    deleteSave: (id) => call("DELETE", `/saves/${seg(id)}`),
    getMe: () => request("GET", "/me"),
    getPreferences: async () => ({ ...DEFAULT_PREFERENCES, ...(await request<Partial<Preferences>>("GET", "/me/preferences")) }),
    updatePreferences: async (p) => ({
      ...DEFAULT_PREFERENCES,
      ...(await request<Partial<Preferences>>("PATCH", "/me/preferences", p)),
    }),
    search: async (q) => listOf(await request("GET", `/search${query({ q })}`)).map(toHit),
    listStacks: async () => listOf(await request("GET", "/stacks")).map(toStack),
    createStack: async (name) => toStack(await request("POST", "/stacks", { name })),
    renameStack: async (id, name) => toStack(await request("PATCH", `/stacks/${seg(id)}`, { name })),
    getStack: async (id) => toStackDetail(await request("GET", `/stacks/${seg(id)}`)),
    addToStack: (stackId, saveId) => call("POST", `/stacks/${seg(stackId)}/saves`, { save_id: saveId }),
    removeFromStack: (stackId, saveId) => call("DELETE", `/stacks/${seg(stackId)}/saves/${seg(saveId)}`),
    deleteStack: (id) => call("DELETE", `/stacks/${seg(id)}`),
    getCurated: async () => toCurated((await request<Raw>("GET", "/curated")) ?? {}),
    requestExport: async () => {
      await call("POST", "/me/export");
      return { status: "queued" };
    },
    downloadExport: async () => {
      const { res, text } = await exchange("GET", "/me/export");
      if (res.status === 202) return { status: "queued" };
      return { status: "ready", filename: filenameFrom(res.headers?.get?.("content-disposition")), json: text };
    },
    retryEnrichment: async (reelId) => {
      const raw = await request<Raw | undefined>("POST", `/retries/${seg(reelId)}`);
      return { status: raw?.status === "running" ? "running" : "queued" };
    },
    deleteAccount: () => call("DELETE", "/me"),
    sendHint: (saveId, hint) => call("POST", `/saves/${seg(saveId)}/hint`, hint),
    syncPlan: async () => toPlanSync(await request<Raw | undefined>("POST", "/billing/sync")),
    getInstagramLink: async () => toInstagramLink(await request<Raw | undefined>("GET", "/me/instagram")),
    createInstagramCode: async () => toInstagramLink(await request<Raw | undefined>("POST", "/me/instagram/code")),
    unlinkInstagram: () => call("DELETE", "/me/instagram"),
  };
}
