// READ-ONLY integrity check of live catalogue listings after the open-write
// exposure. SELECT queries only; prints findings; changes nothing.
// Run: node scripts/integrity-check-listings-readonly.mjs
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { validateListingFields } from '../lib/catalogueListingValidation.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MARKUP = /<|>|javascript:|on\w+\s*=/i;

const { data: items, error } = await db.from('catalogue_items').select('*').order('created_at');
if (error) throw error;

const { data: cats } = await db.from('catalogue_categories').select('id, slug, parent_id, is_selectable');
const catById = new Map((cats || []).map((c) => [c.id, c]));

const sellers = [...new Set(items.map((i) => i.seller_username))];
const { data: participants } = await db.from('participants').select('username, created_at').in('username', sellers);
const participantByName = new Map((participants || []).map((p) => [p.username, p]));

// Order counts only (no buyer data) - to see whether a tampered price was ever charged.
const { data: orders } = await db.from('catalogue_orders').select('item_id, amount_usd, status, created_at')
  .in('item_id', items.map((i) => i.id));

for (const item of items) {
  const seller = participantByName.get(item.seller_username);
  const cat = catById.get(item.category_id);
  const itemOrders = (orders || []).filter((o) => o.item_id === item.id);
  const textFields = { title: item.title, description: item.description, size: item.size };
  const markup = Object.entries(textFields).filter(([, v]) => typeof v === 'string' && MARKUP.test(v)).map(([k]) => k);
  const links = [...(item.images || []), item.promo_video_url].filter(Boolean);
  const linkHosts = [...new Set(links.map((u) => { try { return new URL(u).host; } catch { return `INVALID:${u}`; } }))];
  const recheck = validateListingFields({
    title: item.title, description: item.description, size: item.size, price_usd: item.price_usd,
    promo_video_url: item.promo_video_url, images: item.images, payment_methods: item.payment_methods,
    status: item.status,
  }, { isCreate: false });

  console.log('\n== listing', item.id, '==');
  console.log({
    title: item.title,
    seller_username: item.seller_username,
    seller_is_registered_participant: Boolean(seller),
    seller_registered_at: seller?.created_at,
    listing_created_at: item.created_at,
    listing_created_before_seller_registered: seller ? new Date(item.created_at) < new Date(seller.created_at) : null,
    updated_at: item.updated_at,
    edited_after_creation: item.updated_at && item.created_at ? new Date(item.updated_at) - new Date(item.created_at) > 5000 : null,
    price_usd: item.price_usd,
    status: item.status,
    category: cat ? `${cat.slug}${cat.parent_id ? '' : ' (DEPARTMENT)'}${cat.is_selectable === false ? ' (non-selectable)' : ''}` : 'MISSING',
    payment_methods: item.payment_methods,
    image_and_video_hosts: linkHosts,
    text_fields_with_markup: markup,
    passes_new_validation_on_edit: recheck.error ? `NO: ${recheck.error}` : 'yes',
    orders: itemOrders.map((o) => ({ amount_usd: o.amount_usd, matches_current_price: Number(o.amount_usd) === Number(item.price_usd), status: o.status, at: o.created_at })),
  });
}

const unknownSellers = sellers.filter((s) => !participantByName.has(s));
console.log('\nListings total:', items.length, '| sellers not found in participants:', unknownSellers);
