// The Lately API contract: every call the app makes, and the shapes it expects.
// The backend implements these paths (field names are snake_case to match FastAPI).
// Which calls are live today is decided in ./index.ts (LIVE_ENDPOINTS).

export type ReelStatus = "pending" | "enriched" | "partial";

export type Category =
  | "Dev & Tools"
  | "Food & Places"
  | "Career & Jobs"
  | "Fitness"
  | "Style & Vibes"
  | "Watch Later";

/** The six categories the app knows; anything else from the API is treated as none. */
export const CATEGORIES: readonly Category[] = [
  "Dev & Tools",
  "Food & Places",
  "Career & Jobs",
  "Fitness",
  "Style & Vibes",
  "Watch Later",
];

export type Channel = "app_share" | "web" | "meta_dm";

export interface Save {
  id: string;
  source_url: string;
  shortcode: string | null;
  status: ReelStatus;
  note: string | null;
  created_at: string;
  title: string | null;
  caption: string | null;
  category: Category | null;
  thumbnail_url: string | null;
  creator: string | null;
  channel: Channel;
}

export interface Place {
  name: string;
  address: string;
  maps_url: string | null;
}

export interface SaveDetail extends Save {
  summary: string | null;
  steps: string[] | null;
  tags: string[] | null;
  places: Place[];
  media_status: "pending" | "partial" | "ready" | "failed";
}

export interface SaveResult {
  reel_id: string;
  deduped: boolean;
  status: ReelStatus;
}

export interface ConnectedAccount {
  provider: "instagram" | "google" | "email";
  label: string;
  status: "active" | "secured";
}

export interface Me {
  id: string;
  email: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  plan: "free" | "pro" | "lifetime";
  saves_this_month: number;
  saves_limit: number;
  resets_on: string;
  total_saves: number;
  stacks_count: number;
  member_since: string;
  connected_accounts: ConnectedAccount[];
}

export interface Preferences {
  reading_font: "newsreader" | "inter" | "lora";
  text_size: 14 | 16 | 18 | 20;
  theme: "light" | "dark" | "system";
  push_digests: boolean;
  offline_reading: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  reading_font: "newsreader",
  text_size: 16,
  theme: "light",
  push_digests: true,
  offline_reading: true,
};

export interface Stack {
  id: string;
  name: string;
  category: Category | null;
  save_count: number;
  updated_at: string;
  cover_urls: string[];
}

export interface StackDetail extends Stack {
  saves: Save[];
}

export interface SearchHit {
  save: Save;
  why: string[];
  /** Which search legs found it ("keyword", "fuzzy", "meaning"); absent in local/demo search. */
  matched_by?: string[];
}

export interface CuratedSection {
  kind: "row" | "list";
  title: string;
  subtitle: string | null;
  saves: Save[];
}

export interface CuratedFeed {
  date_label: string;
  hero: {
    label: string;
    title: string;
    subtitle: string;
    image_url: string | null;
    save_ids: string[];
    /** Search query that lists every save in the hero ("See all"). */
    query: string;
  };
  sections: CuratedSection[];
}

export type ApiErrorCode =
  | "BAD_URL"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "NETWORK"
  | "SERVER";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export interface LatelyApi {
  /** POST /saves {text, channel: "app_share"} → 201, or 200 when deduped */
  createSave(text: string): Promise<SaveResult>;
  /** GET /saves?before=<created_at>&limit=<n>&category=<name> — newest first */
  listSaves(p?: { before?: string; limit?: number; category?: Category }): Promise<Save[]>;
  /** GET /saves/{id} */
  getSave(id: string): Promise<SaveDetail>;
  /** PATCH /saves/{id} {note} */
  setNote(id: string, note: string): Promise<Save>;
  /** DELETE /saves/{id} → 204 */
  deleteSave(id: string): Promise<void>;
  /** GET /me */
  getMe(): Promise<Me>;
  /** GET /me/preferences */
  getPreferences(): Promise<Preferences>;
  /** PATCH /me/preferences */
  updatePreferences(p: Partial<Preferences>): Promise<Preferences>;
  /** GET /search?q= */
  search(q: string): Promise<SearchHit[]>;
  /** GET /stacks */
  listStacks(): Promise<Stack[]>;
  /** POST /stacks {name} */
  createStack(name: string): Promise<Stack>;
  /** GET /stacks/{id} */
  getStack(id: string): Promise<StackDetail>;
  /** POST /stacks/{id}/saves {save_id} */
  addToStack(stackId: string, saveId: string): Promise<void>;
  /** DELETE /stacks/{id}/saves/{save_id} → 204 (the save itself stays) */
  removeFromStack(stackId: string, saveId: string): Promise<void>;
  /** DELETE /stacks/{id} → 204 (its saves stay in the Library) */
  deleteStack(id: string): Promise<void>;
  /** GET /curated */
  getCurated(): Promise<CuratedFeed>;
  /** POST /me/export → 202 */
  requestExport(): Promise<{ status: "queued" }>;
  /** POST /retries/{reel_id} → 202: re-run enrichment for a partial card (it goes back to pending) */
  retryEnrichment(reelId: string): Promise<void>;
  /** DELETE /me → 204: deletes the account and everything saved in it */
  deleteAccount(): Promise<void>;
}

export type Endpoint = keyof LatelyApi;

// A Record over Endpoint so adding a method to LatelyApi without listing it here fails to compile.
const ENDPOINT_SET: Record<Endpoint, true> = {
  createSave: true,
  listSaves: true,
  getSave: true,
  setNote: true,
  deleteSave: true,
  getMe: true,
  getPreferences: true,
  updatePreferences: true,
  search: true,
  listStacks: true,
  createStack: true,
  getStack: true,
  addToStack: true,
  removeFromStack: true,
  deleteStack: true,
  getCurated: true,
  requestExport: true,
  retryEnrichment: true,
  deleteAccount: true,
};

/** Every call in the contract. */
export const ENDPOINTS = Object.keys(ENDPOINT_SET) as Endpoint[];
