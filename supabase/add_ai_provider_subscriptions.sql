-- Apply after create_ai_business_assistant.sql and add_ai_subscription_payments.sql.
-- One state per recurring subscription; payment quotes/receipts stay in the
-- existing transaction table. Raw Google purchase tokens are never stored.
begin;

create table if not exists public.ai_provider_subscriptions (
  participant_id uuid not null references public.participants(id) on delete cascade,
  provider text not null check (provider in ('google_play', 'paystack', 'manual')),
  provider_reference text not null,
  product_id text,
  plan text not null check (plan in ('pro', 'business')),
  status text not null check (status in ('pending', 'active', 'trialing', 'past_due', 'cancelled', 'expired', 'refunded', 'failed')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  linked_reference text,
  replaced_by_reference text,
  pending_product_id text,
  auto_renewing boolean,
  observed_at timestamptz not null,
  primary key (provider, provider_reference)
);
create index if not exists ai_provider_subscriptions_participant_idx
  on public.ai_provider_subscriptions (participant_id);
alter table public.ai_provider_subscriptions enable row level security;

-- Preserve existing verified Google purchases and the current entitlement.
insert into public.ai_provider_subscriptions (
  participant_id, provider, provider_reference, product_id, plan, status,
  current_period_start, current_period_end, observed_at
)
select participant_id, provider, provider_reference, product_id, plan, status,
  current_period_start, current_period_end, last_verified_at
from public.ai_subscription_transactions where provider = 'google_play'
on conflict do nothing;

insert into public.ai_provider_subscriptions (
  participant_id, provider, provider_reference, plan, status,
  current_period_start, current_period_end, observed_at
)
select participant_id,
  case when provider in ('google_play', 'paystack') then provider else 'manual' end,
  coalesce(provider_reference, 'legacy:' || participant_id::text), plan, status,
  current_period_start, current_period_end, updated_at
from public.ai_subscriptions where plan in ('pro', 'business')
on conflict do nothing;

-- Used by both reads and writes: expiry alone can expose another valid plan
-- without waiting for an RTDN. Higher tiers win only among valid, unreplaced rows.
create or replace function public.get_ai_subscription_entitlement(p_participant_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'plan', s.plan, 'status', s.status, 'provider', s.provider,
      'provider_reference', s.provider_reference, 'product_id', s.product_id,
      'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
      'pending_product_id', s.pending_product_id, 'auto_renewing', s.auto_renewing
    ) from public.ai_provider_subscriptions s
    where s.participant_id = p_participant_id
      and s.replaced_by_reference is null
      and s.status in ('active', 'trialing', 'cancelled')
      and (s.current_period_end > now() or (s.provider = 'manual' and s.current_period_end is null))
    order by case s.plan when 'business' then 2 else 1 end desc,
      s.current_period_end desc nulls last, s.observed_at desc, s.provider_reference
    limit 1
  ), jsonb_build_object('plan', 'free', 'status', 'active', 'provider', null));
$$;

-- The account row lock serializes lifecycle updates and cache recalculation.
-- Ownership checks and token retirement occur in the same transaction.
create or replace function public.sync_ai_provider_subscription(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := (p_input->>'participant_id')::uuid;
  provider_name text := p_input->>'provider';
  reference text := p_input->>'provider_reference';
  linked text := nullif(p_input->>'linked_reference', '');
  observation timestamptz := (p_input->>'observed_at')::timestamptz;
  stored public.ai_provider_subscriptions;
  effective jsonb;
begin
  if provider_name not in ('google_play', 'paystack') or reference is null or reference = ''
    or observation is null or linked = reference then
    raise exception 'invalid_subscription_update';
  end if;
  perform 1 from public.participants where id = account_id for update;
  if not found then raise exception 'subscription_account_not_found'; end if;

  select * into stored from public.ai_provider_subscriptions
    where provider = provider_name and provider_reference = reference;
  if found and stored.participant_id <> account_id then raise exception 'payment_already_claimed'; end if;

  insert into public.ai_provider_subscriptions (
    participant_id, provider, provider_reference, product_id, plan, status,
    current_period_start, current_period_end, linked_reference,
    pending_product_id, auto_renewing, observed_at
  ) values (
    account_id, provider_name, reference, p_input->>'product_id', p_input->>'plan', p_input->>'status',
    (p_input->>'current_period_start')::timestamptz, (p_input->>'current_period_end')::timestamptz,
    linked, p_input->>'pending_product_id', (p_input->>'auto_renewing')::boolean, observation
  ) on conflict (provider, provider_reference) do update set
    product_id = excluded.product_id, plan = excluded.plan, status = excluded.status,
    current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
    linked_reference = coalesce(excluded.linked_reference, ai_provider_subscriptions.linked_reference),
    pending_product_id = excluded.pending_product_id, auto_renewing = excluded.auto_renewing,
    observed_at = excluded.observed_at
  where ai_provider_subscriptions.participant_id = excluded.participant_id
    and ai_provider_subscriptions.observed_at <= excluded.observed_at;

  -- Recheck after ON CONFLICT to reject simultaneous claims by different accounts.
  select * into stored from public.ai_provider_subscriptions
    where provider = provider_name and provider_reference = reference;
  if stored.participant_id <> account_id then raise exception 'payment_already_claimed'; end if;

  if provider_name = 'google_play' and linked is not null
    and stored.observed_at = observation and coalesce((p_input->>'retire_linked')::boolean, false) then
    -- A placeholder reserves an unseen old token as well. Late restoration can
    -- neither reactivate it nor transfer it to a different FlyMadd account.
    insert into public.ai_provider_subscriptions (
      participant_id, provider, provider_reference, plan, status, replaced_by_reference, observed_at
    ) values (account_id, provider_name, linked, stored.plan, 'expired', reference, observation)
    on conflict (provider, provider_reference) do update
      set replaced_by_reference = coalesce(ai_provider_subscriptions.replaced_by_reference, reference)
      where ai_provider_subscriptions.participant_id = account_id;
    if not found then raise exception 'payment_already_claimed'; end if;
  end if;

  -- A Paystack subscription.create event can attach a recurring code after its
  -- first charge. Retire the temporary checkout reference when that happens.
  if provider_name = 'paystack' and linked is not null then
    update public.ai_provider_subscriptions set replaced_by_reference = reference
      where participant_id = account_id and provider = provider_name and provider_reference = linked;
  end if;

  effective := public.get_ai_subscription_entitlement(account_id);
  insert into public.ai_subscriptions (
    participant_id, plan, status, provider, provider_reference, current_period_start, current_period_end
  ) values (
    account_id, effective->>'plan', effective->>'status', effective->>'provider',
    effective->>'provider_reference', (effective->>'current_period_start')::timestamptz,
    (effective->>'current_period_end')::timestamptz
  ) on conflict (participant_id) do update set
    plan = excluded.plan, status = excluded.status, provider = excluded.provider,
    provider_reference = excluded.provider_reference, current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, updated_at = now();
  return effective;
end;
$$;

revoke all on function public.get_ai_subscription_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.sync_ai_provider_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.get_ai_subscription_entitlement(uuid) to service_role;
grant execute on function public.sync_ai_provider_subscription(jsonb) to service_role;
grant all on public.ai_provider_subscriptions to service_role;

commit;
