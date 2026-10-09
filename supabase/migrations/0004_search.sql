-- 0004 — Search v1 (SEARCH.md §12)
--
-- Search columns on the shared card (reel_content) and on the per-user save
-- (reels), the trigram extension for fuzzy matching, refresh_search_columns()
-- (FINALIZE, the test fixtures and the eval seeder all call it, so search
-- columns are built the same way everywhere), and the public thumbnails bucket.

create extension if not exists pg_trgm;

-- shared content: new fields + search columns written by refresh_search_columns()
alter table public.reel_content
  add column if not exists creator_handle     text,
  add column if not exists ocr_text           text,
  add column if not exists visual_description text,
  add column if not exists entity_names       text[],
  add column if not exists match_text         text,      -- title + tags + entity_names
  add column if not exists tsv                tsvector;  -- weighted A–D (SEARCH.md §3)

-- array_to_string() is STABLE, not IMMUTABLE, so an expression index over it is
-- rejected; tsv is written by refresh_search_columns() instead.
drop index if exists public.reel_content_search_idx;
create index if not exists reel_content_trgm_idx
  on public.reel_content using gin (match_text gin_trgm_ops);

-- per-user: the note is weight A, plus ranking signals
alter table public.reels
  add column if not exists note_tsv tsvector
    generated always as (setweight(to_tsvector('english', coalesce(note, '')), 'A')) stored,
  add column if not exists opened_count   int not null default 0,
  add column if not exists last_opened_at timestamptz;

-- Content is written once per reel, so recomputing here costs nothing at read time.
create or replace function public.refresh_search_columns(p_shortcode text)
returns void
language sql
set search_path = ''
as $$
  update public.reel_content set
    match_text = concat_ws(' ', title,
                   array_to_string(tags, ' '), array_to_string(entity_names, ' ')),
    tsv =
         setweight(to_tsvector('english', concat_ws(' ', title,
                     array_to_string(likely_queries, ' '))), 'A')
      || setweight(to_tsvector('english', concat_ws(' ',
                     array_to_string(tags, ' '), array_to_string(entity_names, ' '),
                     category, ocr_text)), 'B')
      || setweight(to_tsvector('english', concat_ws(' ', summary, visual_description)), 'C')
      || setweight(to_tsvector('english', concat_ws(' ', caption, transcript)), 'D')
  where shortcode = p_shortcode;
$$;

-- Server-side only (worker / service role): clients never rebuild search columns.
revoke execute on function public.refresh_search_columns(text) from public, anon, authenticated;

-- Thumbnails: public read, service-role write. Object path = {shortcode}.jpg.
insert into storage.buckets (id, name, public)
values ('thumbnails', 'thumbnails', true)
on conflict (id) do nothing;
