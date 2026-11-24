-- 0016 — Instagram DM door (PIPELINE.md §2 Door 2, GitHub #47).
--
-- A user links their Instagram account once: the app makes a one-time code
-- (POST /me/instagram/code) and they DM it to Lately's Instagram account. From
-- then on every reel they send there goes through save_reel() with channel
-- 'meta_dm' (stored as source_channel 'telegram' under 0002's legacy check;
-- services/saves_view.py reads it back as meta_dm).
--   instagram_links       sender (Instagram-scoped user id, IGSID) -> Lately user,
--                         one each way; last_save_* lets a follow-up text become
--                         that save's note
--   instagram_link_codes  one code per user, 15 minutes, deleted when used
--   instagram_messages    message ids already handled (Meta redelivers for up to
--                         36 h). No text, no sender. The webhook deletes rows older
--                         than 7 days.
-- Deleting the auth user (DELETE /me) cascades to links and codes.
--
-- Additive and idempotent: safe to run again, and on a live database with
-- 0001-0014 and existing rows. No functions.

create table if not exists public.instagram_links (
  ig_user_id    text primary key,
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  linked_at     timestamptz not null default now(),
  last_save_id  uuid references public.reels(id) on delete set null,
  last_save_at  timestamptz
);
alter table public.instagram_links enable row level security;
revoke all on public.instagram_links from anon, authenticated;

create table if not exists public.instagram_link_codes (
  code          text primary key,
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
alter table public.instagram_link_codes enable row level security;
revoke all on public.instagram_link_codes from anon, authenticated;

create table if not exists public.instagram_messages (
  mid          text primary key,
  received_at  timestamptz not null default now()
);
create index if not exists instagram_messages_received_idx
  on public.instagram_messages (received_at);
alter table public.instagram_messages enable row level security;
revoke all on public.instagram_messages from anon, authenticated;
