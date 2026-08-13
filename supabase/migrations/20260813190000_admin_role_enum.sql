-- 39 · The admin role, on its own
--
-- This migration contains one statement and nothing else, and that is
-- deliberate. `alter type ... add value` may run inside a transaction from
-- Postgres 12 onward, but the value it adds cannot be USED until that
-- transaction commits -- so a function or view in the same file that mentions
-- 'admin' would fail with "unsafe use of new value of enum type".
--
-- Both `supabase db push` and scripts/verify-migrations.mjs apply one file per
-- transaction, so putting the enum change in its own file is what guarantees
-- the separation. Everything that reads or writes the new value lives in the
-- next migration.

alter type public.user_role add value if not exists 'admin';

comment on type public.user_role is
  'Stored role. owner and admin both resolve to an effective role of owner; see public.current_user_role().';
