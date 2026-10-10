-- Local stand-in for the production database state AFTER the listing lockdown.
-- Used only by run-local-dry-run.mjs (PGlite). Not for Supabase.
-- It mimics: Supabase roles (anon, authenticated, service_role with BYPASSRLS),
-- a non-superuser owner that is a member of those roles (like "postgres" in
-- the Supabase SQL editor), Supabase default privileges for new objects in
-- public, catalogue tables with RLS + the single read policy, read-only
-- grants for anon/authenticated, 17-style departments with child categories,
-- the two live listings, and payment tables/functions that must not change.

grant temporary on database postgres to public;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role app_owner nologin createrole;
grant anon, authenticated, service_role to app_owner;

grant create, temporary on database postgres to app_owner;
grant all on schema public to app_owner;
alter schema public owner to app_owner;

-- Supabase default privileges for objects the owner creates in public.
alter default privileges for role app_owner in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role app_owner in schema public grant all on functions to anon, authenticated, service_role;

set role app_owner;

create table public.catalogue_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_id uuid references public.catalogue_categories(id),
  sort_order integer default 100,
  is_active boolean default true
);

create table public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  seller_username text not null,
  title text not null,
  description text,
  price_usd numeric not null,
  images jsonb,
  payment_methods jsonb,
  status text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  size text,
  promo_video_url text,
  category_id uuid not null references public.catalogue_categories(id)
);

create table public.catalogue_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.catalogue_items(id),
  seller_username text not null,
  buyer_name text not null,
  buyer_email text not null,
  amount_usd numeric not null,
  payment_method text not null,
  status text,
  created_at timestamptz default now()
);
create table public.usdt_payments (
  id uuid primary key default gen_random_uuid(),
  tx_hash text,
  amount numeric,
  created_at timestamptz default now()
);
create index usdt_payments_tx_idx on public.usdt_payments(tx_hash);
create function public.verify_payment_stub(p_ref text) returns boolean language sql as $$ select p_ref is not null $$;
create function public.touch_usdt() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger usdt_touch before insert on public.usdt_payments for each row execute function public.touch_usdt();

-- Departments, then categories under them
insert into public.catalogue_categories (id, name, slug, parent_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'Food & Grocery', 'food-grocery', null),
  ('00000000-0000-0000-0000-0000000000a2', 'Professional Services', 'professional-services', null),
  ('00000000-0000-0000-0000-0000000000a3', 'General', 'general', null);
insert into public.catalogue_categories (name, slug, parent_id) values
  ('Food & Groceries', 'food-groceries', '00000000-0000-0000-0000-0000000000a1'),
  ('Drinks', 'drinks-beverages', '00000000-0000-0000-0000-0000000000a1'),
  ('Private Chefs', 'private-chefs-cooks', '00000000-0000-0000-0000-0000000000a1'),
  ('Graphic Design', 'graphic-design', '00000000-0000-0000-0000-0000000000a2'),
  ('Consulting', 'consulting', '00000000-0000-0000-0000-0000000000a2'),
  ('Legal', 'legal-services', '00000000-0000-0000-0000-0000000000a2'),
  ('Gadgets', 'gadgets', '00000000-0000-0000-0000-0000000000a3'),
  ('Zzz Empty Category', 'zzz-empty-category', '00000000-0000-0000-0000-0000000000a3'),
  ('Other', 'other', '00000000-0000-0000-0000-0000000000a3');

insert into public.catalogue_items (seller_username, title, price_usd, status, category_id, payment_methods, created_at, updated_at)
select 'inyangojubirobert', 'art cover', 1.99, 'active', c.id, '["usdt"]'::jsonb, '2026-01-01', '2026-01-01' from public.catalogue_categories c where c.slug = 'other';
insert into public.catalogue_items (seller_username, title, price_usd, status, category_id, payment_methods, created_at, updated_at)
select 'faithful', 'Child Delivery', 15, 'active', c.id, '["usdt","paystack"]'::jsonb, '2026-01-02', '2026-01-02' from public.catalogue_categories c where c.slug = 'other';
insert into public.catalogue_orders (item_id, seller_username, buyer_name, buyer_email, amount_usd, payment_method, status)
select id, seller_username, 'Buyer', 'b@example.com', 15, 'usdt', 'pending_verification' from public.catalogue_items where title = 'Child Delivery';

-- State after the lockdown: RLS on, single read policy, read-only public grants.
alter table public.catalogue_categories enable row level security;
alter table public.catalogue_items enable row level security;
create policy catalogue_categories_select_all on public.catalogue_categories for select to public using (true);
create policy "public read active items" on public.catalogue_items for select to public using (status <> 'deleted');
revoke all on public.catalogue_items from anon, authenticated;
revoke all on public.catalogue_categories from anon, authenticated;
grant select on public.catalogue_items to anon, authenticated;
grant select on public.catalogue_categories to anon, authenticated;

reset role;
