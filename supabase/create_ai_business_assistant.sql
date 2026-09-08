-- Dedicated Bascardo AI conversations, subscriptions, and metered usage.
-- Run in the Supabase SQL editor after the participants and catalogue tables
-- exist. All access is through authenticated server routes using service_role.

create extension if not exists pgcrypto;

create table if not exists ai_conversations (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  title text not null default 'New conversation'
    check (char_length(trim(title)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_participant_updated_idx
  on ai_conversations (participant_id, updated_at desc);

create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null default 'chat' check (kind in ('chat', 'business_analysis')),
  content text not null check (char_length(trim(content)) between 1 and 12000),
  credits_charged integer not null default 0 check (credits_charged >= 0),
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on ai_messages (conversation_id, created_at asc);
create index if not exists ai_messages_participant_created_idx
  on ai_messages (participant_id, created_at desc);

create table if not exists ai_subscriptions (
  participant_id uuid primary key references participants(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'cancelled', 'expired')),
  provider text,
  provider_reference text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_subscription_requests (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  requested_plan text not null check (requested_plan in ('pro', 'business')),
  status text not null default 'pending'
    check (status in ('pending', 'contacted', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Immutable provider references make payment verification idempotent and
-- prevent one Play/Paystack purchase from being claimed by another account.
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

create unique index if not exists ai_subscription_requests_one_pending_idx
  on ai_subscription_requests (participant_id)
  where status in ('pending', 'contacted');

create table if not exists ai_usage_monthly (
  participant_id uuid not null references participants(id) on delete cascade,
  usage_month date not null,
  plan text not null check (plan in ('free', 'pro', 'business')),
  credits_limit integer not null check (credits_limit >= 0),
  credits_used integer not null default 0 check (credits_used >= 0),
  requests_count integer not null default 0 check (requests_count >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (participant_id, usage_month)
);

alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table ai_subscriptions enable row level security;
alter table ai_subscription_requests enable row level security;
alter table ai_subscription_transactions enable row level security;
alter table ai_usage_monthly enable row level security;

-- Atomically reserves credits before an external AI request. This prevents
-- simultaneous requests from exceeding the participant's monthly allowance.
create or replace function consume_ai_credits(
  p_participant_id uuid,
  p_plan text,
  p_credits_limit integer,
  p_credits integer
)
returns table(allowed boolean, credits_used integer, credits_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now())::date;
  v_used integer;
  v_limit integer;
begin
  insert into ai_usage_monthly (
    participant_id, usage_month, plan, credits_limit, credits_used
  ) values (
    p_participant_id, v_month, p_plan, p_credits_limit, 0
  )
  on conflict (participant_id, usage_month) do update
    set plan = excluded.plan,
        credits_limit = excluded.credits_limit,
        updated_at = now();

  select u.credits_used, u.credits_limit into v_used, v_limit
  from ai_usage_monthly u
  where u.participant_id = p_participant_id and u.usage_month = v_month
  for update;

  if v_used + p_credits > v_limit then
    return query select false, v_used, greatest(v_limit - v_used, 0);
    return;
  end if;

  update ai_usage_monthly
  set credits_used = ai_usage_monthly.credits_used + p_credits,
      updated_at = now()
  where participant_id = p_participant_id and usage_month = v_month
  returning ai_usage_monthly.credits_used into v_used;

  return query select true, v_used, greatest(v_limit - v_used, 0);
end;
$$;

create or replace function refund_ai_credits(
  p_participant_id uuid,
  p_credits integer
)
returns void
language sql
security definer
set search_path = public
as $$
  update ai_usage_monthly
  set credits_used = greatest(credits_used - greatest(p_credits, 0), 0),
      updated_at = now()
  where participant_id = p_participant_id
    and usage_month = date_trunc('month', now())::date;
$$;

create or replace function record_ai_request_usage(
  p_participant_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost_usd numeric default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  update ai_usage_monthly
  set requests_count = requests_count + 1,
      input_tokens = input_tokens + greatest(p_input_tokens, 0),
      output_tokens = output_tokens + greatest(p_output_tokens, 0),
      estimated_cost_usd = estimated_cost_usd + greatest(p_estimated_cost_usd, 0),
      updated_at = now()
  where participant_id = p_participant_id
    and usage_month = date_trunc('month', now())::date;
$$;

revoke all on function consume_ai_credits(uuid, text, integer, integer) from public;
revoke all on function refund_ai_credits(uuid, integer) from public;
revoke all on function record_ai_request_usage(uuid, integer, integer, numeric) from public;
