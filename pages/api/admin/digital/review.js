// Admin review of digital products.
//   POST { item_id, action: 'approve' | 'reject' | 'suspend' | 'reinstate', note }
// approve: product published, its pending files approved. Previews and buyer
// access only ever use approved files. suspend: hidden from sale; existing
// owners keep access (use a licence revocation for refunds).

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';

const MOVES = {
  approve: { from: ['pending_review'], to: 'published' },
  reject: { from: ['pending_review'], to: 'rejected' },
  suspend: { from: ['published', 'pending_review'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'published' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;

  const itemId = String(req.body?.item_id || '');
  const move = MOVES[req.body?.action];
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  if (!move) return res.status(400).json({ error: 'Unknown action' });
  if (['reject', 'suspend'].includes(req.body.action) && !note) return res.status(400).json({ error: 'Give the seller a reason' });

  try {
    const { data: product } = await digitalDb.from('digital_products').select('*').eq('item_id', itemId).maybeSingle();
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!move.from.includes(product.status)) return res.status(409).json({ error: `Cannot ${req.body.action} a ${product.status} product` });

    if (['approve', 'reinstate'].includes(req.body.action)) {
      if (!product.rights_confirmed) return res.status(400).json({ error: 'The seller has not confirmed the rights' });
      if (req.body.action === 'approve') {
        await digitalDb.from('digital_assets').update({ status: 'approved' }).eq('item_id', itemId).eq('status', 'pending');
      }
      const { count } = await digitalDb.from('digital_assets').select('id', { count: 'exact', head: true }).eq('item_id', itemId).eq('status', 'approved');
      if (!count) return res.status(400).json({ error: 'This product has no approved files' });
    }

    const { data: updated, error } = await digitalDb.from('digital_products')
      .update({ status: move.to, review_note: note || null, reviewed_by: admin.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('item_id', itemId).eq('status', product.status).select('status').maybeSingle();
    if (error) throw error;
    if (!updated) return res.status(409).json({ error: 'Updated by someone else - refresh' });

    const { data: seller } = await digitalDb.from('participants').select('id').eq('username', product.seller_username).maybeSingle();
    const { data: item } = await digitalDb.from('catalogue_items').select('title').eq('id', itemId).maybeSingle();
    const text = {
      approve: `Your digital product "${item?.title}" is approved and on sale.`,
      reject: `Your digital product "${item?.title}" needs changes: ${note}`,
      suspend: `Your digital product "${item?.title}" has been taken off sale: ${note}`,
      reinstate: `Your digital product "${item?.title}" is back on sale.`,
    }[req.body.action];
    if (seller && text) {
      await digitalDb.from('support_messages').insert({ participant_id: seller.id, admin_id: admin.id, sender_type: 'system', message_type: 'general', body: text })
        .then(({ error: e }) => { if (e) console.error('digital notice failed:', e.message); });
    }
    return res.status(200).json({ success: true, status: updated.status });
  } catch (error) {
    console.error('admin/digital/review error:', error);
    return res.status(500).json({ error: 'Review failed' });
  }
}
