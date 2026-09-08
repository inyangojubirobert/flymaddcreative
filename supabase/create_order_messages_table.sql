-- Order-scoped buyer<->seller chat, created only after a catalogue_orders
-- row exists (which itself only happens once payment is verified - see
-- pages/api/catalogue/verify-order.js). Kept separate from the unused
-- public.messages table because the buyer on a catalogue order is often a
-- guest checkout (identified only by buyer_token, no participants row), so
-- messages can't be tied to two participants(id) foreign keys the way
-- public.messages requires.
create table if not exists order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references catalogue_orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('buyer', 'seller')),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  media_url text,
  created_at timestamptz not null default now()
);

create index if not exists order_messages_order_created_idx
  on order_messages (order_id, created_at asc);

-- All reads/writes go through pages/api/catalogue/order-messages.js using the
-- service role, which itself checks either the participant JWT (seller) or
-- the order's buyer_token (buyer) - no anon/authenticated policies needed.
alter table order_messages enable row level security;
