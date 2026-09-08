-- ============================================================================
-- Project knowledge base for the Help & FAQ screen and Bascardo Token AI.
--
-- Run this in the Supabase SQL editor. It is safe to run more than once:
-- it creates the table/indexes if missing and upserts the initial questions.
-- All clients read FAQs through /api/onedream/faqs; direct table access is
-- deliberately disabled so only trusted server code can publish knowledge.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists project_faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null check (char_length(trim(category)) between 1 and 80),
  question text not null unique check (char_length(trim(question)) between 1 and 500),
  answer text not null check (char_length(trim(answer)) between 1 and 4000),
  keywords text[] not null default '{}',
  sort_order integer not null default 100,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_faqs_published_sort_idx
  on project_faqs (is_published, sort_order, created_at);

alter table project_faqs enable row level security;

-- No anon/authenticated policies: FAQ reads are served by the authenticated
-- Next.js route and the AI uses the service role, which both bypass RLS.

insert into project_faqs (category, question, answer, keywords, sort_order)
values
  (
    'Bascardo AI',
    'What is Bascardo AI?',
    'Bascardo AI analyzes your sales and business activity to reveal trends, identify opportunities, and recommend actions to help you grow. It has a dedicated mobile dashboard for AI chat, business analysis, sales insights, product improvements, marketing ideas, recommendations, and chat history.',
    array['bascardo', 'ai', 'business analysis', 'sales insights', 'recommendations', 'growth'],
    15
  ),
  (
    'Getting started',
    'What is the One Dream Initiative?',
    'The One Dream Initiative is FlyMadd Creative''s referral and voting rewards programme. Participants create a profile, share their referral link, build support through votes, progress through stages, and can request withdrawal of available earnings.',
    array['one dream', 'initiative', 'project', 'how it works', 'flymadd'],
    10
  ),
  (
    'Catalogue',
    'How do I build a catalogue in the mobile app?',
    'Sign in and open Profile. Choose My Listings, then select + New Listing. Enter the product title, description, USD price, and artwork image URL. Set the listing to Live when it is ready and save it. You can later edit, pause, or remove listings from My Listings.',
    array['catalogue', 'catalog', 'storefront', 'my listings', 'new listing', 'product'],
    20
  ),
  (
    'Catalogue',
    'How do buyers see my catalogue?',
    'Buyers can open your public profile and select View Shop. Only listings marked Live are shown to buyers. Share your profile or shop link with your audience so they can browse your products.',
    array['buyers', 'view shop', 'share shop', 'public catalogue', 'storefront'],
    30
  ),
  (
    'Catalogue',
    'What product information should I add?',
    'Use a clear product title, a useful description, a correct USD price, and at least one good-quality artwork image URL. Review the live listing from View Shop before sharing it with customers.',
    array['product details', 'title', 'description', 'price', 'image', 'artwork'],
    40
  ),
  (
    'Catalogue',
    'How do catalogue payments and orders work?',
    'A buyer chooses an available payment method at checkout. Paid orders remain visible in My Orders for the seller. Use the order message thread to discuss delivery; buyers can confirm delivery or raise an issue. Sellers can release funds only after the buyer has confirmed delivery.',
    array['payment', 'checkout', 'order', 'delivery', 'release funds', 'dispute'],
    50
  ),
  (
    'Votes and referrals',
    'How do I receive votes?',
    'Share your profile or referral link with your community. Supporters can find your profile and use the Buy Votes flow. Your vote total is shown on your profile and affects your position on the leaderboard.',
    array['votes', 'referral', 'share link', 'supporter', 'leaderboard'],
    60
  ),
  (
    'Withdrawals',
    'How do I request a withdrawal?',
    'Open Profile and choose Wallet. Review the available balance, enter an amount and payout details, then submit your request. The administration team reviews the request and status updates are sent to your Support Messages.',
    array['withdrawal', 'wallet', 'cash out', 'payout', 'balance'],
    70
  ),
  (
    'Support',
    'How do I contact support or Bascardo Token AI?',
    'Open Profile and choose Support Messages to contact FlyMadd Support, report a problem, or send a screenshot. Bascardo AI has its own dashboard and bottom-menu icon. Support also includes an Ask Bascardo AI shortcut when you want to move to the AI adviser.',
    array['support', 'message', 'bascardo', 'ai', 'help'],
    80
  ),
  (
    'Account',
    'Where can I find my voting code and profile?',
    'Open the Profile tab to see your name, username, vote total, stage, and voting code. Your voting code helps people find and support your profile.',
    array['profile', 'voting code', 'username', 'account'],
    90
  ),
  (
    'Leaderboard',
    'How do I view the full leaderboard?',
    'From Home or Profile, select View Full Leaderboard or View Leaderboard. You can pull down to refresh the latest rankings and select a participant to open their profile.',
    array['leaderboard', 'rank', 'ranking', 'supporters'],
    100
  )
on conflict (question) do update set
  category = excluded.category,
  answer = excluded.answer,
  keywords = excluded.keywords,
  sort_order = excluded.sort_order,
  updated_at = now();
