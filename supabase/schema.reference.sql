-- Live public schema exposed by the Supabase API. Reference only. Do not run this file as a migration.
-- Captured 2026-10-05T23:26:36.037Z from pjtuisyvpvoswmcgxsfs.supabase.co.
-- Column types come from the PostgREST OpenAPI document. Constraints that PostgREST does not publish are omitted.
-- Regenerate with: node scripts/dump-public-schema.mjs

-- table public.admin_users
create table if not exists public.admin_users (
  id uuid not null -- primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.ai_conversations
create table if not exists public.ai_conversations (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.ai_messages
create table if not exists public.ai_messages (
  id uuid not null -- primary key,
  conversation_id uuid not null -- references ai_conversations(id),
  participant_id uuid not null -- references participants(id),
  role text not null,
  kind text not null,
  content text not null,
  credits_charged integer not null,
  created_at timestamptz not null
);

-- table public.ai_provider_subscriptions
create table if not exists public.ai_provider_subscriptions (
  participant_id uuid not null -- references participants(id),
  provider text not null -- primary key,
  provider_reference text not null -- primary key,
  product_id text,
  plan text not null,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  linked_reference text,
  replaced_by_reference text,
  pending_product_id text,
  auto_renewing boolean,
  observed_at timestamptz not null
);

-- table public.ai_subscription_requests
create table if not exists public.ai_subscription_requests (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  requested_plan text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.ai_subscription_transactions
create table if not exists public.ai_subscription_transactions (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  provider text not null,
  provider_reference text not null,
  provider_subscription_id text,
  product_id text,
  plan text not null,
  status text not null,
  amount_minor integer,
  currency text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_verified_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.ai_subscriptions
create table if not exists public.ai_subscriptions (
  participant_id uuid not null -- primary key,
  plan text not null,
  status text not null,
  provider text,
  provider_reference text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.ai_usage_monthly
create table if not exists public.ai_usage_monthly (
  participant_id uuid not null -- primary key,
  usage_month date not null -- primary key,
  plan text not null,
  credits_limit integer not null,
  credits_used integer not null,
  requests_count integer not null,
  input_tokens integer not null,
  output_tokens integer not null,
  estimated_cost_usd numeric not null,
  updated_at timestamptz not null
);

-- table public.analytics_events
create table if not exists public.analytics_events (
  id uuid not null -- primary key,
  participant_id uuid -- references participants(id),
  event_type character varying not null,
  event_data jsonb,
  session_id character varying,
  user_agent text,
  ip_address inet,
  created_at timestamptz
);

-- table public.catalogue_categories
create table if not exists public.catalogue_categories (
  id uuid not null -- primary key,
  name text not null,
  slug text not null,
  icon text not null,
  tint text not null,
  ink text not null,
  sort_order integer not null,
  created_at timestamptz not null,
  parent_id uuid -- references catalogue_categories(id),
  is_featured boolean not null,
  is_active boolean not null,
  is_selectable boolean not null
);

-- table public.catalogue_items
create table if not exists public.catalogue_items (
  id uuid not null -- primary key,
  seller_username text not null,
  title text not null,
  description text,
  price_usd numeric not null,
  images jsonb,
  payment_methods jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  size text,
  promo_video_url text,
  category_id uuid not null -- references catalogue_categories(id)
);

-- table public.catalogue_orders
create table if not exists public.catalogue_orders (
  id uuid not null -- primary key,
  item_id uuid -- references catalogue_items(id),
  seller_username text not null,
  buyer_name text not null,
  buyer_email text not null,
  buyer_whatsapp text,
  amount_usd numeric not null,
  payment_method text not null,
  payment_ref text,
  tx_hash text,
  buyer_token text,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  amount_ngn numeric,
  exchange_rate numeric,
  currency text
);

-- table public.collaboration_submissions
create table if not exists public.collaboration_submissions (
  id integer not null -- primary key,
  created_at timestamptz not null,
  collaboration_type text,
  name text not null,
  role text,
  email text,
  message text,
  portfolio text,
  status text
);

-- table public.crypto_votes
create table if not exists public.crypto_votes (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  user_id uuid -- references participants(id),
  vote_count integer not null,
  network text not null,
  token text not null,
  recipient_address text not null,
  expected_amount numeric not null,
  tx_hash text,
  status text,
  created_at timestamptz,
  confirmed_at timestamptz
);

-- table public.exchange_rates
create table if not exists public.exchange_rates (
  id integer not null -- primary key,
  base text not null,
  target text not null,
  rate numeric not null,
  fetched_at timestamptz not null
);

-- table public.global_stats
create table if not exists public.global_stats (
  id integer not null -- primary key,
  total_votes integer,
  total_participants integer,
  campaign_goal integer,
  current_stage character varying,
  stage_progress numeric,
  last_updated timestamptz
);

-- table public.link_visits
create table if not exists public.link_visits (
  id uuid not null -- primary key,
  referral_link_id uuid not null,
  visitor_ip inet,
  visitor_fingerprint character varying,
  visitor_user_agent text,
  visit_source character varying,
  created_at timestamptz
);

-- table public.media
create table if not exists public.media (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  cloudinary_url text not null,
  cloudinary_public_id text not null,
  media_type character varying,
  created_at timestamp without time zone,
  file_name character varying,
  file_size integer
);

-- table public.merchant_referral_links
create table if not exists public.merchant_referral_links (
  id uuid not null -- primary key,
  merchant_id uuid not null -- references referral_merchants(id),
  link_code character varying not null,
  full_link text not null,
  description text,
  is_active boolean,
  clicks_count integer,
  registrations_count integer,
  created_at timestamptz,
  expires_at timestamptz
);

-- table public.merchant_referral_rewards
create table if not exists public.merchant_referral_rewards (
  id uuid not null -- primary key,
  merchant_id uuid not null -- references referral_merchants(id),
  participant_id uuid not null -- references participants(id),
  merchant_link_id uuid not null -- references merchant_referral_links(id),
  vote_id uuid -- references crypto_votes(id),
  tokens_awarded integer not null,
  reward_type text,
  status text,
  created_at timestamptz,
  paid_at timestamptz,
  payment_id uuid -- references payments(id)
);

-- table public.merchant_withdrawals
create table if not exists public.merchant_withdrawals (
  id uuid not null -- primary key,
  merchant_id uuid -- references referral_merchants(id),
  amount numeric not null,
  wallet_address text,
  status text not null,
  created_at timestamptz not null
);

-- table public.messages
create table if not exists public.messages (
  id uuid not null -- primary key,
  sender_id uuid not null -- references participants(id),
  receiver_id uuid not null -- references participants(id),
  content text not null,
  media_urls jsonb,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  is_read boolean
);

-- table public.milestones
create table if not exists public.milestones (
  id integer not null -- primary key,
  name character varying not null,
  description text,
  vote_threshold integer not null,
  stage character varying not null,
  badge_icon character varying,
  reward_description text,
  is_active boolean,
  created_at timestamptz
);

-- table public.order_messages
create table if not exists public.order_messages (
  id uuid not null -- primary key,
  order_id uuid not null -- references catalogue_orders(id),
  sender_role text not null,
  body text not null,
  media_url text,
  created_at timestamptz not null
);

-- table public.participant_profiles
create table if not exists public.participant_profiles (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  bio text,
  media_type text,
  media_url text,
  storage_path text,
  media_title text,
  phone text,
  contact_email text,
  whatsapp text,
  instagram text,
  facebook text,
  twitter text,
  website text,
  contact_is_public boolean,
  created_at timestamptz,
  updated_at timestamptz
);

-- table public.participant_withdrawals
create table if not exists public.participant_withdrawals (
  id uuid not null -- primary key,
  username text not null,
  amount_usd numeric not null,
  payment_method text not null,
  payment_details text,
  status text,
  notes text,
  created_at timestamptz,
  processed_at timestamptz,
  payout_type text,
  payout_currency text,
  payout_network text,
  payout_reference text,
  payout_amount numeric,
  payout_confirmed_at timestamptz,
  claimed_at timestamptz,
  claimed_by uuid -- references admin_users(id),
  admin_note text
);

-- table public.participants
create table if not exists public.participants (
  id uuid not null -- primary key,
  name character varying not null,
  email character varying not null,
  username character varying not null,
  total_votes integer,
  total_amount numeric,
  current_stage character varying,
  achievement_badges text[],
  created_at timestamptz,
  updated_at timestamptz,
  user_code character varying,
  password_hash text not null,
  referred_by_merchant_link_id uuid -- references merchant_referral_links(id)
);

-- table public.payments
create table if not exists public.payments (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  transaction_id character varying not null,
  payment_method character varying not null,
  payment_provider_id character varying,
  amount numeric not null,
  currency character varying,
  payer_email character varying,
  payer_name character varying,
  status character varying,
  payment_metadata jsonb,
  confirmed_at timestamptz,
  created_at timestamptz,
  amount_usd numeric,
  amount_ngn numeric,
  exchange_rate numeric,
  payment_intent_id text,
  metadata jsonb,
  verified_at timestamptz
);

-- table public.project_faqs
create table if not exists public.project_faqs (
  id uuid not null -- primary key,
  category text not null,
  question text not null,
  answer text not null,
  keywords text[] not null,
  sort_order integer not null,
  is_published boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- table public.referral_merchants
create table if not exists public.referral_merchants (
  id uuid not null -- primary key,
  merchant_name character varying not null,
  email character varying not null,
  company_name character varying,
  wallet_address text,
  total_tokens_earned integer,
  available_tokens integer,
  status character varying,
  created_at timestamptz,
  updated_at timestamptz,
  password_hash text
);

-- table public.support_messages
create table if not exists public.support_messages (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  admin_id uuid -- references admin_users(id),
  withdrawal_id uuid -- references participant_withdrawals(id),
  sender_type text not null,
  message_type text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null
);

-- table public.usdt_payments
create table if not exists public.usdt_payments (
  id uuid not null -- primary key,
  network character varying not null,
  tx_hash character varying not null,
  amount numeric not null,
  from_address character varying not null,
  to_address character varying not null,
  status character varying,
  block_number integer,
  user_id uuid -- references participants(id),
  vote_count integer,
  created_at timestamptz,
  verified_at timestamptz
);

-- table public.votes
create table if not exists public.votes (
  id uuid not null -- primary key,
  participant_id uuid not null -- references participants(id),
  payment_id uuid not null -- references payments(id),
  payment_transaction_id character varying not null,
  vote_sequence integer not null,
  amount_paid numeric not null,
  vote_value integer,
  payment_method character varying not null,
  is_validated boolean,
  created_at timestamptz,
  voter_ip text,
  voter_user_agent text
);

-- CATALOGUE COUNTS AT CAPTURE
-- {"categories":115,"roots":15,"children":100,"featured":4,"notSelectable":18,"moreRows":0,"otherRows":1}

