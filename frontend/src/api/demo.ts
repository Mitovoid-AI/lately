// Demo implementation of the API contract: in-memory, seeded with the Stitch content.
// Mutations last until reload; preferences persist on the device.
import { curatedDate } from "../lib/dates";
import { extractReelUrl } from "../lib/instagram";
import { matchSaves } from "../lib/search";
import { deviceStore, readJson, writeJson, type KeyValueStore } from "../lib/storage";
import {
  ApiError,
  DEFAULT_PREFERENCES,
  type CuratedFeed,
  type LatelyApi,
  type Me,
  type Preferences,
  type Save,
  type SaveDetail,
  type Stack,
  type StackDetail,
} from "./contract";
import { buildDemoSeed, EXTRA_CONTENT, IMAGES, type DemoSave, type DemoStack } from "./demo-data";

/** How long a newly saved demo reel stays "processing". */
export const PENDING_MS = 6000;
/** How long a demo export takes to "build". */
export const EXPORT_MS = 1500;

/** The demo API plus what the demo store (billing/demo.ts) needs to "buy" Pro in it. */
export interface DemoApi extends LatelyApi {
  /** The plan demo GET /me reports; resets with the page like the rest of the demo state. */
  currentPlan(): Me["plan"];
  setPlan(plan: Me["plan"], expiresAt?: string | null): void;
}

export const DEMO_USER = {
  id: "demo-user",
  name: "Aanya Sharma",
  email: "aanya.sharma@example.com",
  handle: "aanya",
};

const PREFS_KEY = "lately.prefs";
const DAY = 24 * 60 * 60 * 1000;

function toSave(d: SaveDetail): Save {
  return {
    id: d.id,
    source_url: d.source_url,
    shortcode: d.shortcode,
    status: d.status,
    note: d.note,
    created_at: d.created_at,
    title: d.title,
    caption: d.caption,
    category: d.category,
    thumbnail_url: d.thumbnail_url,
    creator: d.creator,
    channel: d.channel,
  };
}

export function createDemoApi(opts: { now?: () => number; storage?: KeyValueStore } = {}): DemoApi {
  const now = opts.now ?? Date.now;
  const store = opts.storage ?? deviceStore;
  const latency = opts.now ? 0 : 150; // visible loading states in the browser, instant in tests
  const seed = buildDemoSeed(now());
  let saves: DemoSave[] = seed.saves;
  let stacks: DemoStack[] = seed.stacks;
  let created = 0;
  let exportRequestedAt: number | null = null;
  let plan: Me["plan"] = "free";
  let planExpiresAt: string | null = null;

  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());

  /** What a save looks like right now: pending ones hide their content until ready. */
  function present(s: DemoSave): SaveDetail {
    if (s.status === "pending" && s.ready_at !== undefined && now() >= s.ready_at) {
      // Processing finished: promote in the store so it stays done.
      if (s.shortcode === "PARTIAL") {
        Object.assign(s, { status: "partial", media_status: "partial", title: null, thumbnail_url: null, summary: null, steps: null });
      } else {
        Object.assign(s, { status: "enriched", media_status: "ready" });
      }
    }
    const detail: SaveDetail = {
      ...toSave(s),
      summary: s.summary,
      steps: s.steps,
      tags: s.tags,
      places: s.places,
      media_status: s.media_status,
    };
    if (s.status !== "pending") return detail;
    return {
      ...detail,
      title: null,
      caption: null,
      category: null,
      thumbnail_url: null,
      creator: null,
      summary: null,
      steps: null,
      tags: null,
      places: [],
    };
  }

  function find(id: string): DemoSave {
    const s = saves.find((x) => x.id === id);
    if (!s) throw new ApiError("NOT_FOUND", 404, "Save not found.");
    return s;
  }

  function sorted(): DemoSave[] {
    return [...saves].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  function stackView(st: DemoStack): Stack {
    const members = st.save_ids.map((id) => saves.find((s) => s.id === id)).filter(Boolean) as DemoSave[];
    return {
      id: st.id,
      name: st.name,
      category: st.category,
      save_count: members.length,
      updated_at: st.updated_at,
      cover_urls: members
        .map((m) => present(m).thumbnail_url)
        .filter((u): u is string => !!u)
        .slice(0, 4),
    };
  }

  function findStack(id: string): DemoStack {
    const st = stacks.find((x) => x.id === id);
    if (!st) throw new ApiError("NOT_FOUND", 404, "Stack not found.");
    return st;
  }

  return {
    currentPlan: () => plan,
    setPlan(next, expiresAt = null) {
      plan = next;
      planExpiresAt = next === "pro" ? expiresAt : null;
    },

    async createSave(text) {
      await wait();
      const link = extractReelUrl(text);
      if (!link) throw new ApiError("BAD_URL", 422, "No Instagram link found.");
      // Pro has no monthly cap: the QUOTA sample link only trips on the free plan.
      if (link.shortcode === "QUOTA" && plan === "free") throw new ApiError("QUOTA_EXCEEDED", 429, "Monthly save limit reached.");
      if (link.shortcode === "RATE") throw new ApiError("RATE_LIMITED", 429, "Too many saves right now.");
      if (link.shortcode === "NETWORK") throw new ApiError("NETWORK", 0, "Network request failed.");

      const existing = saves.find((s) => s.shortcode === link.shortcode);
      if (existing) return { reel_id: existing.id, deduped: true, status: present(existing).status };

      const content = EXTRA_CONTENT[created % EXTRA_CONTENT.length];
      created += 1;
      const save: DemoSave = {
        ...content,
        id: `s-new-${created}`,
        source_url: link.url,
        shortcode: link.shortcode,
        status: "pending",
        media_status: "pending",
        note: null,
        created_at: new Date(now()).toISOString(),
        channel: "app_share",
        ready_at: now() + PENDING_MS,
      };
      saves = [save, ...saves];
      return { reel_id: save.id, deduped: false, status: "pending" };
    },

    async listSaves(p = {}) {
      await wait();
      const limit = Math.max(1, Math.min(p.limit ?? 25, 100));
      const before = p.before ? Date.parse(p.before) : Infinity;
      return sorted()
        .filter((s) => Date.parse(s.created_at) < before)
        .map((s) => toSave(present(s)))
        .filter((s) => !p.category || s.category === p.category)
        .slice(0, limit);
    },

    async getSave(id) {
      await wait();
      const s = find(id);
      const detail = present(s);
      // The detail screen uses the larger hero image when one exists.
      return s.hero_url && detail.status === "enriched" ? { ...detail, thumbnail_url: s.hero_url } : detail;
    },

    async setNote(id, note) {
      await wait();
      const s = find(id);
      s.note = note;
      return toSave(present(s));
    },

    async deleteSave(id) {
      await wait();
      find(id);
      saves = saves.filter((s) => s.id !== id);
      for (const st of stacks) st.save_ids = st.save_ids.filter((x) => x !== id);
    },

    async getMe(): Promise<Me> {
      await wait();
      const d = new Date(now());
      const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      return {
        ...DEMO_USER,
        avatar_url: IMAGES.avatar,
        plan,
        plan_expires_at: planExpiresAt,
        saves_this_month: saves.filter((s) => Date.parse(s.created_at) >= monthStart).length,
        saves_limit: 20,
        resets_on: next.toISOString().slice(0, 10),
        total_saves: saves.length,
        stacks_count: stacks.length,
        member_since: "2023-10-01",
        connected_accounts: [
          { provider: "instagram", label: "@aanya.archive", status: "active" },
          { provider: "google", label: DEMO_USER.email, status: "secured" },
        ],
      };
    },

    async getPreferences() {
      const stored = await readJson<Partial<Preferences>>(store, PREFS_KEY, {});
      return { ...DEFAULT_PREFERENCES, ...stored };
    },

    async updatePreferences(p) {
      const current = await readJson<Partial<Preferences>>(store, PREFS_KEY, {});
      const next = { ...DEFAULT_PREFERENCES, ...current, ...p };
      await writeJson(store, PREFS_KEY, next);
      return next;
    },

    async search(q) {
      await wait();
      return matchSaves(sorted().map(present), q).map((h) => ({ ...h, save: toSave(h.save as SaveDetail) }));
    },

    async listStacks() {
      await wait();
      return stacks.map(stackView);
    },

    async createStack(name) {
      await wait();
      const st: DemoStack = {
        id: `st-${stacks.length + 1}-${Math.floor(now()) % 100000}`,
        name: name.trim(),
        category: null,
        save_ids: [],
        updated_at: new Date(now()).toISOString(),
      };
      stacks.push(st);
      return stackView(st);
    },

    async getStack(id): Promise<StackDetail> {
      await wait();
      const st = findStack(id);
      const members = st.save_ids
        .map((sid) => saves.find((s) => s.id === sid))
        .filter(Boolean)
        .map((s) => toSave(present(s as DemoSave)));
      return { ...stackView(st), saves: members };
    },

    async addToStack(stackId, saveId) {
      await wait();
      const st = findStack(stackId);
      find(saveId);
      if (!st.save_ids.includes(saveId)) st.save_ids = [saveId, ...st.save_ids];
      st.updated_at = new Date(now()).toISOString();
    },

    async removeFromStack(stackId, saveId) {
      await wait();
      const st = findStack(stackId);
      st.save_ids = st.save_ids.filter((x) => x !== saveId);
      st.updated_at = new Date(now()).toISOString();
    },

    async deleteStack(id) {
      await wait();
      findStack(id);
      stacks = stacks.filter((st) => st.id !== id);
    },

    async retryEnrichment(reelId) {
      await wait();
      const s = find(reelId);
      // A retried card goes back to processing; this time the demo "fetch" finds the reel.
      const recovered = s.status === "partial" && !s.title;
      Object.assign(s, {
        status: "pending",
        media_status: "pending",
        shortcode: s.shortcode === "PARTIAL" ? "PARTIAL-retried" : s.shortcode,
        ready_at: now() + PENDING_MS,
      });
      if (recovered) {
        Object.assign(s, {
          title: s.caption?.split("\n")[0]?.replace(/…$/, "") ?? "Recovered reel",
          thumbnail_url: IMAGES.yoga,
          summary: "A short follow-along routine from the reel's caption and audio.",
        });
      }
    },

    async deleteAccount() {
      await wait();
      saves = [];
      stacks = [];
      plan = "free";
      planExpiresAt = null;
      await writeJson(store, PREFS_KEY, {});
    },

    // Demo saves have their content already; the device never reads Instagram in demo mode.
    async sendHint(saveId) {
      find(saveId);
    },

    async syncPlan() {
      await wait();
      return { plan, plan_expires_at: planExpiresAt };
    },

    async getCurated(): Promise<CuratedFeed> {
      await wait();
      const all = sorted().map(present);
      const isCafe = (s: SaveDetail) =>
        s.category === "Food & Places" && (!!s.note?.includes("cafe") || !!s.tags?.includes("cafe"));
      const cafes = all.filter(isCafe);
      const dev = all.filter((s) => s.category === "Dev & Tools");
      const trek = all.filter((s) => s.note === "trek in june" && s.status === "enriched");
      const old = all.filter((s) => now() - Date.parse(s.created_at) > 30 * DAY);
      return {
        date_label: curatedDate(now()),
        hero: {
          label: "THIS WEEKEND",
          title: `${cafes.length} cafes you saved and never visited`,
          subtitle: "Food & Places · saved over the last month",
          image_url: IMAGES.kyotoCafe,
          save_ids: cafes.map((s) => s.id),
          query: "cafe",
        },
        sections: [
          { kind: "row", title: "Revisit · Dev & Tools", subtitle: null, saves: dev.map(toSave) },
          { kind: "row", title: "From your note “trek in june”", subtitle: null, saves: trek.map(toSave) },
          { kind: "list", title: "Forgotten gems", subtitle: "Saved over a month ago", saves: old.map(toSave) },
        ],
      };
    },

    async requestExport() {
      await wait();
      exportRequestedAt = now();
      return { status: "queued" };
    },

    async downloadExport() {
      await wait();
      if (exportRequestedAt === null) throw new ApiError("NOT_FOUND", 404, "No export yet. Request one first.");
      if (now() < exportRequestedAt + EXPORT_MS) return { status: "queued" };
      const day = new Date(exportRequestedAt).toISOString().slice(0, 10).replace(/-/g, "");
      const data = {
        exported_at: new Date(now()).toISOString(),
        account: { email: DEMO_USER.email, name: DEMO_USER.name },
        saves: sorted().map(present),
        stacks: stacks.map((st) => ({ ...stackView(st), save_ids: st.save_ids })),
        preferences: { ...DEFAULT_PREFERENCES, ...(await readJson<Partial<Preferences>>(store, PREFS_KEY, {})) },
      };
      return { status: "ready", filename: `lately-export-${day}.json`, json: JSON.stringify(data, null, 2) };
    },
  };
}
