-- Lately — 0009: device-side fetch hints (PIPELINE.md §5 FETCH, §8 trust rule)
--
-- 1. reels.device_hint: what the user's phone read from Instagram's public embed
--    page after the save (POST /saves/{id}/hint) — caption, creator handle, CDN
--    thumbnail/video URLs, duration, plus `shortcode` and `at` (epoch seconds).
--    Per-user input, validated by the API and again by the worker.
-- 2. reel_content.device_user_id: when fetch_source = 'device', the user whose
--    hint produced the shared content. RESOLVE only reuses such a card for that
--    same user's saves; anyone else's save runs its own FETCH (their own hint,
--    or the server chain, which may overwrite it with server-fetched data).
--
-- Idempotent: safe to run multiple times.

alter table public.reels
  add column if not exists device_hint jsonb;

alter table public.reel_content
  add column if not exists device_user_id uuid references auth.users(id) on delete set null;

comment on column public.reel_content.fetch_source is
  'device | embed_page | ytdlp | scraper | null (gave up)';
comment on column public.reel_content.device_user_id is
  'fetch_source = device: the user whose device hint produced this content';
comment on column public.reels.device_hint is
  'Validated device-side embed-page read (POST /saves/{id}/hint); per-user, untrusted';
