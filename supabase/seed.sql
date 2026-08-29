-- Seed data for Phase 1: one dev user + default categories.
-- Run after 0001_init.sql. The user id here matches EXPO_PUBLIC_DEV_USER_ID.

insert into public.profiles (id, plan)
values ('00000000-0000-0000-0000-000000000001', 'free')
on conflict (id) do nothing;

insert into public.categories (user_id, name, emoji, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Dev & Tools',    '🛠️', 1),
  ('00000000-0000-0000-0000-000000000001', 'Career & Jobs',  '💼', 2),
  ('00000000-0000-0000-0000-000000000001', 'Food & Places',  '🍜', 3),
  ('00000000-0000-0000-0000-000000000001', 'Fitness',        '💪', 4),
  ('00000000-0000-0000-0000-000000000001', 'Style & Vibes',  '✨', 5),
  ('00000000-0000-0000-0000-000000000001', 'Watch Later',    '👀', 6)
on conflict do nothing;
