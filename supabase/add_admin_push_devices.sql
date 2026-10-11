-- Admin phone alerts for support messages.
-- Safe to run repeatedly. Clients cannot read or write these tables.
-- The API uses the service role, which bypasses row level security.

create table if not exists public.admin_push_devices (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null,
  device_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_push_devices_token_unique unique (expo_push_token),
  constraint admin_push_devices_platform_check check (platform in ('ios', 'android'))
);

create index if not exists admin_push_devices_active_idx
  on public.admin_push_devices (is_active, admin_user_id);

create table if not exists public.admin_push_deliveries (
  message_id uuid primary key references public.support_messages(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_push_devices enable row level security;
alter table public.admin_push_deliveries enable row level security;

revoke all on table public.admin_push_devices from anon, authenticated;
revoke all on table public.admin_push_deliveries from anon, authenticated;
