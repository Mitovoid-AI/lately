-- Seed data for Phase 1: one dev user + default categories.
-- Run after 0001_init.sql. The user id here matches EXPO_PUBLIC_DEV_USER_ID.
-- Safe to re-run: existing rows are left untouched.

insert into public.profiles (id, plan)
values ('00000000-0000-0000-0000-000000000001', 'free')
on conflict (id) do nothing;

-- Only seed categories if this user has none yet, so re-running doesn't duplicate.
insert into public.categories (user_id, name, emoji, sort_order)
select v.user_id, v.name, v.emoji, v.sort_order
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Dev & Tools',   '🛠️', 1),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Career & Jobs', '💼', 2),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Food & Places', '🍜', 3),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Fitness',       '💪', 4),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Style & Vibes', '✨', 5),
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Watch Later',   '👀', 6)
) as v(user_id, name, emoji, sort_order)
where not exists (
  select 1 from public.categories c where c.user_id = v.user_id
);
