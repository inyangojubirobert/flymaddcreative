-- ============================================================================
-- Lock down direct client writes to participant_withdrawals
-- ============================================================================
-- Same rationale as supabase/lockdown_catalogue_orders_rls.sql - read that
-- file's comment if you haven't already. In short: rewiring
-- user-dashboard.html to call POST /api/onedream/withdraw only changes what
-- this site's own JavaScript does. window.SupabaseAPI.requestWithdrawal()
-- is still defined in public/js/supabase-config.js and still works from a
-- browser console or a raw call using the public anon key unless the
-- database itself refuses the write - which is what this script adds.
--
-- Withdrawal history is now read through the authenticated
-- GET /api/onedream/withdraw endpoint, so no browser role receives a policy
-- for any operation. Only the service role key used by that endpoint can
-- read or write this financial data.
-- ============================================================================

alter table participant_withdrawals enable row level security;

drop policy if exists participant_withdrawals_select_all on participant_withdrawals;
