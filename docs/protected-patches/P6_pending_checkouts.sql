-- ============================================================================
-- P6 (PROTECTED - NOT APPLIED): complete paid carts whose buyer never returned
-- ============================================================================
-- Pairs with P6_store_buyer_details_at_payment_intent.diff (protected
-- pages/api/catalogue/cart-payment-intent.js) and the new, unprotected job
-- pages/api/admin/earnings/complete-unreturned.js.
--
-- Today the orders for a Paystack cart are only written when the buyer's
-- app/page returns and calls cart-checkout. If they pay and close it, the
-- charge succeeds but no order exists. Paystack metadata carries the cart
-- lines but not the buyer's name, phone or delivery address (deliberately:
-- that is private to the seller). P6 keeps those details here, on our own
-- server, from the moment the payment reference is created, so the job can
-- run the exact same verified completion as cart-checkout.
--
-- Rows hold personal data: server-only, and deleted by the job after 60 days.
-- Rollback: revert the diff; drop table catalogue_pending_checkouts.
-- ============================================================================

create table if not exists catalogue_pending_checkouts (
  payment_ref text primary key,
  buyer jsonb not null,                 -- buyer_name, buyer_email, buyer_whatsapp, delivery_address, notes
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text                     -- 'buyer' | 'reconciliation'
);
create index if not exists catalogue_pending_checkouts_open on catalogue_pending_checkouts (created_at) where completed_at is null;

alter table catalogue_pending_checkouts enable row level security;
revoke all on table catalogue_pending_checkouts from anon, authenticated, public;
grant all on table catalogue_pending_checkouts to service_role;
