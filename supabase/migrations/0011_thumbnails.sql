-- 0011 — Thumbnails kept in Postgres when Storage can't be written.
--
-- FETCH copies each reel's thumbnail to Storage (`thumbnails/{sc}.jpg`) with the
-- service-role key. Without that key (local development) the card used to keep
-- Instagram's signed CDN URL, which expires within days. The worker now keeps
-- the verified image here instead (`reel_content.thumbnail_path = 'db:{sc}'`)
-- and the API serves it at GET /thumbnails/{sc}.jpg. Shared content, like
-- reel_content: one row per shortcode, not per user.

create table if not exists public.thumbnails (
  shortcode    text primary key check (shortcode ~ '^[A-Za-z0-9_-]{1,64}$'),
  data         bytea not null check (octet_length(data) between 1 and 2000000),
  content_type text not null default 'image/jpeg'
               check (content_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
  updated_at   timestamptz not null default now()
);

-- Served only through the API (service connection); no client access.
alter table public.thumbnails enable row level security;
revoke all on public.thumbnails from anon, authenticated;
