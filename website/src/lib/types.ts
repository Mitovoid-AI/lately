// Shared domain types for the server (bot + web). Mirrors the SQL schema.

export type ReelStatus = "pending" | "enriched" | "partial";
export type SourceChannel = "app" | "telegram" | "web";

export type User = {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  created_at: string;
  last_seen_at: string;
};

export type Reel = {
  id: string;
  user_id: string;
  source_url: string;
  shortcode: string | null;
  status: ReelStatus;
  source_channel: SourceChannel;
  reason: string | null;
  caption: string | null;
  transcript: string | null;
  title: string | null;
  summary: string | null;
  steps: string[] | null;
  category: string | null;
  tags: string[] | null;
  entities: Record<string, unknown> | null;
  thumbnail_path: string | null;
  created_at: string;
  enriched_at: string | null;
  failure_reason: string | null;
};

export type Category = {
  id: string;
  user_id: string;
  name: string;
  emoji: string | null;
  sort_order: number;
};

export type Session = {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
};

export type LoginCode = {
  code: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type Note = {
  id: string;
  reel_id: string;
  body: string;
  created_at: string;
};

export type Profile = {
  id: string;
  plan: "free" | "pro" | "lifetime";
  saves_this_month: number;
  quota_reset_at: string | null;
};

// Typed schema for the Supabase client. Insert types mark server-generated
// columns optional so partial writes typecheck.
type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      users: Table<
        User,
        Pick<User, "telegram_id"> & Partial<Omit<User, "telegram_id">>
      >;
      reels: Table<
        Reel,
        Pick<Reel, "user_id" | "source_url"> & Partial<Omit<Reel, "user_id" | "source_url">>
      >;
      categories: Table<Category, Omit<Category, "id">>;
      notes: Table<Note, Pick<Note, "reel_id" | "body">>;
      profiles: Table<Profile, Pick<Profile, "id"> & Partial<Profile>>;
      sessions: Table<Session, Pick<Session, "token" | "user_id" | "expires_at">>;
      login_codes: Table<
        LoginCode,
        Pick<LoginCode, "code" | "user_id" | "expires_at">
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
