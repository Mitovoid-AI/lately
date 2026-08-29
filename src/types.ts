// Domain types for Lately. Mirrors the Supabase schema in supabase/migrations.

export type ReelStatus = "pending" | "enriched" | "partial";

// Category-specific extraction. The generic shape is a record; per-category
// helpers below document what each category is expected to yield (PLAN.md §3).
export type Entities = Record<string, unknown>;

export type Reel = {
  id: string;
  user_id: string;
  source_url: string;
  shortcode: string | null;
  status: ReelStatus;
  reason: string | null; // the one-line "why I saved this" (Lately's core idea)
  caption: string | null;
  transcript: string | null;
  title: string | null;
  summary: string | null;
  steps: string[] | null;
  category: string | null;
  tags: string[] | null;
  entities: Entities | null;
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

// Row used when inserting a fresh save (Phase 1 capture path).
export type NewReel = {
  user_id: string;
  source_url: string;
  shortcode: string | null;
  status: ReelStatus;
  reason: string | null;
};

// Minimal Database generic for the typed supabase client.
export type Database = {
  public: {
    Tables: {
      reels: {
        Row: Reel;
        Insert: NewReel;
        Update: Partial<Reel>;
        Relationships: [];
      };
      categories: {
        Row: Category;
        Insert: Omit<Category, "id">;
        Update: Partial<Category>;
        Relationships: [];
      };
      notes: {
        Row: Note;
        Insert: Omit<Note, "id" | "created_at">;
        Update: Partial<Note>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Profile;
        Update: Partial<Profile>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
