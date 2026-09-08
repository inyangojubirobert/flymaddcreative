-- ============================================================================
-- Lock down direct client writes to catalogue_orders
-- ============================================================================
-- Read this before running: rewiring catalogue-product.html and
-- user-dashboard.html to call /api/catalogue/verify-order and
-- /api/catalogue/order-action (server routes using the Supabase service
-- role key, which always bypasses Row Level Security) only changes what the
-- SITE'S OWN JavaScript does. The old client-side functions
-- (window.SupabaseAPI.createCatalogueOrder / updateOrderStatus) are still
-- present in public/js/supabase-config.js and still work from a browser
-- console, or from a raw REST/SDK call using the public anon key, UNLESS
-- the database itself refuses those writes. That refusal is what this
-- script adds. Without it, the JS-level fix is not a real fix against
-- anyone willing to open devtools and call Supabase directly.
--
-- What this does:
--   - Enables Row Level Security on catalogue_orders (if not already on).
--   - Adds a permissive SELECT policy, because the buyer confirmation page
--     (catalogue-product.html's ?order=...&token=... view) reads a specific
--     order directly via the anon key, and that must keep working.
--   - Adds NO insert/update/delete policy for anon or authenticated roles.
--     With RLS enabled and no matching policy, those commands are denied by
--     default - only the service role key (used exclusively by the new
--     server routes) can still write.
--
-- Before running: confirm nothing else in this codebase writes to
-- catalogue_orders directly from the browser. As of this fix, the only
-- writers were the two functions replaced by /api/catalogue/verify-order
-- and /api/catalogue/order-action. If you've since added another feature
-- that inserts/updates catalogue_orders from client-side code, that feature
-- will break until it's moved server-side too.
-- ============================================================================

alter table catalogue_orders enable row level security;

drop policy if exists catalogue_orders_select_all on catalogue_orders;
create policy catalogue_orders_select_all
  on catalogue_orders
  for select
  using (true);

-- No insert/update/delete policies are created here on purpose - see the
-- comment above. If a legitimate need for a client-side write ever comes
-- up, add a narrowly-scoped policy for it rather than a blanket allow.
