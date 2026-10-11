// Admin overview for digital products: review queue (with previews), price
// tiers, recent licences, and per-seller digital earnings for payout
// reconciliation.
//   GET ?view=queue|published|all

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb, publicDigitalProduct } from '../../../../lib/digital';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;

  const view = ['queue', 'published', 'all'].includes(req.query.view) ? req.query.view : 'queue';
  try {
    let products = digitalDb.from('digital_products').select('*, digital_price_tiers(*), catalogue_items(title)').order('updated_at', { ascending: false }).limit(100);
    if (view === 'queue') products = products.eq('status', 'pending_review');
    if (view === 'published') products = products.eq('status', 'published');

    const [p, tiers, licenses, earnings] = await Promise.all([
      products,
      digitalDb.from('digital_price_tiers').select('*').order('price_usd'),
      digitalDb.from('digital_licenses').select('id, item_id, provider, order_id, price_usd, is_paid, status, created_at, participants(username)').order('created_at', { ascending: false }).limit(50),
      digitalDb.from('digital_earnings').select('seller_username, net_usd, status, clears_at'),
    ]);
    for (const r of [p, tiers, licenses, earnings]) if (r.error) throw r.error;

    const itemIds = (p.data || []).map((x) => x.item_id);
    const { data: assets } = itemIds.length ? await digitalDb.from('digital_assets').select('*').in('item_id', itemIds) : { data: [] };

    const now = Date.now();
    const bySeller = {};
    for (const e of earnings.data || []) {
      const s = (bySeller[e.seller_username] ||= { seller_username: e.seller_username, pending_usd: 0, cleared_usd: 0, paid_out_usd: 0 });
      if (e.status === 'paid_out') s.paid_out_usd += Number(e.net_usd);
      else if (e.status === 'pending') {
        if (new Date(e.clears_at).getTime() <= now) s.cleared_usd += Number(e.net_usd);
        else s.pending_usd += Number(e.net_usd);
      }
    }

    return res.status(200).json({
      products: (p.data || []).map((product) => ({
        ...publicDigitalProduct({ ...product, status: 'draft' }, product.digital_price_tiers, (assets || []).filter((a) => a.item_id === product.item_id)),
        status: product.status,
        title: product.catalogue_items?.title || 'Untitled',
        rights_confirmed: product.rights_confirmed,
        review_note: product.review_note,
        files: (assets || []).filter((a) => a.item_id === product.item_id && a.status !== 'removed')
          .map((a) => ({ id: a.id, kind: a.kind, title: a.title, format: a.format, bytes: Number(a.bytes), pages: a.pages, duration_seconds: a.duration_seconds, status: a.status })),
      })),
      tiers: tiers.data || [],
      licenses: licenses.data || [],
      seller_earnings: Object.values(bySeller).map((s) => ({ ...s, pending_usd: money(s.pending_usd), cleared_usd: money(s.cleared_usd), paid_out_usd: money(s.paid_out_usd) })),
    });
  } catch (error) {
    console.error('admin/digital error:', error);
    return res.status(500).json({ error: 'Could not load digital products' });
  }
}
