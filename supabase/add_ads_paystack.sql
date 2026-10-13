-- ============================================================================
-- Advertising: website (Paystack card) purchases of ad and boost packages.
--
-- The web app (/app) can't use Google Play billing, so packages bought there
-- are paid by card through Paystack (NGN at the live USD rate), like digital
-- products. Each paid checkout grants exactly one entitlement, provider
-- 'paystack', provider_ref = the checkout reference; refunds end the campaign
-- through ads_revoke_entitlement() (daily job: pages/api/admin/ads/sync-voided).
--
-- Safe to re-run. Requires add_advertising.sql. Server-only (RLS, no policies).
-- ============================================================================

alter table advertising_entitlements drop constraint if exists advertising_entitlements_provider_check;
alter table advertising_entitlements add constraint advertising_entitlements_provider_check
  check (provider in ('google_play', 'paystack', 'admin_grant'));

create table if not exists ad_paystack_payments (
  reference text primary key check (reference ~ '^adp_[a-f0-9]{24}$'),
  buyer_id uuid not null references participants(id),
  package_id text not null references advertising_packages(id),
  package_snapshot jsonb not null,               -- terms at checkout time
  price_usd numeric(10,2) not null check (price_usd > 0),
  amount_kobo bigint not null check (amount_kobo > 0),
  exchange_rate numeric(14,4) not null check (exchange_rate > 0),
  email text not null,
  status text not null default 'initialized'
    check (status in ('initialized', 'paid', 'failed', 'refund_pending', 'refunded')),
  paystack_transaction_id text,
  fees_kobo bigint,
  entitlement_id uuid references advertising_entitlements(id),
  failure text,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists ad_paystack_payments_buyer_idx on ad_paystack_payments (buyer_id, created_at desc);
create index if not exists ad_paystack_payments_status_idx on ad_paystack_payments (status, created_at);
create index if not exists ad_paystack_payments_txn_idx on ad_paystack_payments (paystack_transaction_id);

alter table ad_paystack_payments enable row level security;
revoke all on ad_paystack_payments from anon, authenticated;

-- Verify (every row ok = true)
select 'paystack provider allowed' as check, exists (
  select 1 from pg_constraint where conname = 'advertising_entitlements_provider_check'
    and pg_get_constraintdef(oid) like '%paystack%') as ok
union all select 'ad_paystack_payments exists', to_regclass('public.ad_paystack_payments') is not null
union all select 'ad_paystack_payments RLS on', (select relrowsecurity from pg_class where oid = 'public.ad_paystack_payments'::regclass);
