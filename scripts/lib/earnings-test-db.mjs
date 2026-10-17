// In-memory Postgres (PGlite) with the minimal existing tables the Dream Coins,
// earnings and affiliate migrations reference, then the real migration files.
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const MIGRATIONS = [
  'add_dream_coins_gifting.sql',
  'add_earnings_and_payouts.sql',
  'add_gift_revenue_sharing.sql',
  'add_affiliate_marketplace.sql',
  'add_multicurrency_listings.sql',
  'fix_multicurrency_review.sql',
];

export async function earningsTestDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table referral_merchants (id uuid primary key, merchant_name text, email text);
    create table merchant_referral_links (id uuid primary key, merchant_id uuid references referral_merchants(id), link_code text);
    create table participants (id uuid primary key, username text unique, name text, email text,
      created_at timestamptz not null default now(), referred_by_merchant_link_id uuid references merchant_referral_links(id));
    create table catalogue_items (id uuid primary key, seller_username text, title text, price_usd numeric, status text default 'active',
      images jsonb, listing_type text default 'product');
    create table catalogue_checkouts (id uuid primary key default gen_random_uuid(), payment_ref text unique, buyer_email text,
      created_at timestamptz default now());
    create table catalogue_orders (id uuid primary key default gen_random_uuid(), item_id uuid, seller_username text, buyer_name text,
      buyer_email text, amount_usd numeric, commission_usd numeric, seller_net_usd numeric, status text, payment_ref text,
      checkout_id uuid, quantity integer default 1, unit_price_usd numeric, created_at timestamptz default now(), updated_at timestamptz default now());
    -- Existing production table used by lib/currency.js (Paystack NGN conversion): must not be touched.
    create table exchange_rates (id bigserial primary key, base text, target text, rate numeric, fetched_at timestamptz default now());
    insert into exchange_rates (base, target, rate) values ('USD', 'NGN', 1600);
  `);
  const results = {};
  for (const name of MIGRATIONS) {
    const sql = await fs.readFile(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
    await db.exec(sql);
    results[name] = (await db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows;
  }
  return { db, verification: results };
}
