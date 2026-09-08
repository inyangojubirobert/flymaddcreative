-- Run this once if create_ai_business_assistant.sql was already applied.
-- Payment rows are server-only: RLS is enabled and no public policies exist.

create table if not exists ai_subscription_transactions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  provider text not null check (provider in ('paystack', 'google_play')),
  provider_reference text not null,
  provider_subscription_id text,
  product_id text,
  plan text not null check (plan in ('pro', 'business')),
  status text not null check (status in ('pending', 'active', 'past_due', 'cancelled', 'expired', 'refunded', 'failed')),
  amount_minor bigint,
  currency text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index if not exists ai_subscription_transactions_participant_idx
  on ai_subscription_transactions (participant_id, created_at desc);
create index if not exists ai_subscription_transactions_provider_subscription_idx
  on ai_subscription_transactions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

alter table ai_subscription_transactions enable row level security;
