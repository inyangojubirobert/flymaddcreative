// Digital products are sold only through Google Play (in the app) and
// delivered through the Library - never through the marketplace's
// Paystack/USDT escrow checkout. Used by the cart and single-item checkout.
// If the digital tables don't exist yet, nothing is treated as digital.

export async function digitalItemIds(supabase, itemIds) {
  if (!itemIds?.length) return new Set();
  const { data, error } = await supabase.from('digital_products').select('item_id').in('item_id', itemIds).neq('status', 'draft');
  if (error) return new Set();
  return new Set((data || []).map((row) => String(row.item_id)));
}

export const DIGITAL_CHECKOUT_MESSAGE = 'This is a digital product - buy it from its page with Google Play in the One Dream app.';
