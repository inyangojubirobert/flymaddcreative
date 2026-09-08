-- Reconcile existing messages with the column required by the P2P backend.
-- The configured database already had is_read at the 2026-09-08 audit; this is
-- only a fallback for an environment where that column is still missing.
-- Safe to rerun: existing columns and their values are preserved.
-- media.file_name/file_size have no runtime consumers, so do not add them here.
-- Preserve all tables, foreign keys, indexes, RLS settings, and policies.
begin;

alter table public.messages
  add column if not exists is_read boolean default false;

-- Make the column available to the Supabase REST API after commit.
notify pgrst, 'reload schema';

commit;
