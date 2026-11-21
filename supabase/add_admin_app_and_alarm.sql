-- Admin tab in the app + admin alarm (same design as Book of Memes 069/076/078).
-- Safe to run repeatedly. Clients cannot read or write these tables; the API
-- uses the service role.
--
-- 1. Admin as a normal user: link an admin_users row to the participant
--    account that admin signs into the app with. That account then sees the
--    Admin tab (inbox, withdrawals, alerts, brand promotion); nobody else does.
-- 2. Conversations: one per participant (support_messages already exists).
--    An admin marks one handled, or checks off its alarm.
-- 3. Alarm + Telegram: a message waiting for an admin rings full-screen in the
--    app and is sent to the admin's Telegram, then reminded every
--    reminder_minutes until an admin checks it off or marks it handled, plus a
--    daily summary. pg_cron calls /api/admin/alerts/sweep every minute.

-- 1. Admin <-> participant link ------------------------------------------------
alter table public.admin_users
  add column if not exists participant_id uuid references public.participants(id) on delete set null;
create unique index if not exists admin_users_participant_uidx
  on public.admin_users (participant_id) where participant_id is not null;

-- 2. Conversation state ---------------------------------------------------------
create table if not exists public.admin_conversations (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  handled_at timestamptz,
  handled_by uuid references public.admin_users(id) on delete set null,
  ack_at timestamptz,
  ack_by uuid references public.admin_users(id) on delete set null,
  reminder_last_at timestamptz,
  reminder_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 3. Alert settings + Telegram queue --------------------------------------------
create table if not exists public.admin_alert_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  telegram_bot_token text,
  telegram_chat_id text,
  telegram_bot_username text,
  reminder_minutes integer not null default 15 check (reminder_minutes between 5 and 720),
  max_reminders integer not null default 24 check (max_reminders between 1 and 200),
  digest_hour smallint not null default 8 check (digest_hour between 0 and 23),
  timezone text not null default 'Africa/Lagos',
  last_digest_on date,
  sweep_secret text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  updated_at timestamptz not null default now()
);
insert into public.admin_alert_config (id) values (true) on conflict (id) do nothing;

alter table public.support_messages
  add column if not exists tg_status text not null default 'none',
  add column if not exists tg_attempts integer not null default 0,
  add column if not exists tg_next_try_at timestamptz,
  add column if not exists tg_error text;
do $$ begin
  alter table public.support_messages add constraint support_messages_tg_status_check
    check (tg_status in ('none', 'pending', 'sent', 'failed'));
exception when duplicate_object then null; end $$;
create index if not exists support_messages_tg_pending_idx
  on public.support_messages (created_at) where tg_status = 'pending';
create index if not exists support_messages_participant_idx
  on public.support_messages (participant_id, created_at desc);

alter table public.admin_conversations enable row level security;
alter table public.admin_alert_config enable row level security;
revoke all on table public.admin_conversations from anon, authenticated;
revoke all on table public.admin_alert_config from anon, authenticated;

-- 4. Every minute: send pending alerts, reminders and the daily summary --------
-- Needs the pg_cron and pg_net extensions (Supabase: Database -> Extensions).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule('onedream-admin-alerts');
exception when others then null; end $$;
select cron.schedule('onedream-admin-alerts', '* * * * *', $cron$
  select net.http_post(
    url := 'https://flymaddcreative.vercel.app/api/admin/alerts/sweep',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sweep-secret', (select sweep_secret from public.admin_alert_config where id)),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
$cron$);

-- 5. Link your admin account to your app account (edit and run once) ------------
-- update public.admin_users
--    set participant_id = (select id from public.participants where username = 'YOUR_APP_USERNAME')
--  where email = 'YOUR_ADMIN_EMAIL';

-- Check
select
  (select count(*) from public.admin_users where participant_id is not null) as linked_admins,
  exists (select 1 from public.admin_alert_config) as alert_config_ready,
  exists (select 1 from information_schema.columns where table_name = 'support_messages' and column_name = 'tg_status') as telegram_queue_ready,
  exists (select 1 from cron.job where jobname = 'onedream-admin-alerts') as sweep_scheduled;
