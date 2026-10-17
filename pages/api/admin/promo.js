// Admin: One Dream Storefront Promotion - review opted-in videos, select
// them for external campaigns and record One Dream's ad spend and results.
//   GET  ?status=submitted|selected|not_selected|withdrawn|all
//   POST { action: 'review', submission_id, decision: 'selected'|'not_selected', note }
//   POST { action: 'spend', submission_id, platform, amount_usd, spent_on?, campaign_ref?, campaign_url?, impressions?, clicks?, notes? }
//        a negative amount_usd is a correction and needs notes; spend rows are append-only
// The database enforces: spend only on selected live videos, US$10 per video,
// the programme budget, budget reserved at selection, and 3 funded videos per
// seller per terms version (supabase/fix_storefront_promotion_review.sql).

import { requireActiveAdmin } from '../../../lib/adminAuth';
import { PLATFORMS, promoDb, promoErrorReply, trackedStorefrontLink } from '../../../lib/storefrontPromo';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const count = (v) => (v === undefined || v === null || v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0));

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, promoDb);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const status = String(req.query.status || 'all');
      let q = promoDb.from('promo_video_submissions').select('*').order('created_at', { ascending: false }).limit(200);
      if (status !== 'all') q = q.eq('status', status);
      const subs = must(await q) || [];
      const ids = subs.map((s) => s.id);
      const [items, spend, terms] = await Promise.all([
        subs.length ? promoDb.from('catalogue_items').select('id, title, status, images, promo_video_url').in('id', [...new Set(subs.map((s) => s.item_id))]).then(must) : [],
        ids.length ? promoDb.from('promo_campaign_spend').select('*').in('submission_id', ids).order('spent_on', { ascending: false }).then(must) : [],
        promoDb.from('promo_programme_terms').select('*').order('version').then(must),
      ]);
      const current = (terms || []).find((t) => t.is_current);
      let budget = null;
      if (current) {
        const committed = Number(must(await promoDb.rpc('promo_committed_usd', { p_terms_version: current.version })) || 0);
        const { data: spentRows } = await promoDb.from('promo_campaign_spend').select('amount_usd, promo_video_submissions!inner(terms_version)').eq('promo_video_submissions.terms_version', current.version);
        const spent = (spentRows || []).reduce((n, r) => n + Number(r.amount_usd), 0);
        budget = { terms_version: current.version, total_usd: Number(current.programme_budget_usd), committed_usd: committed, spent_usd: spent, uncommitted_usd: Math.max(0, Number(current.programme_budget_usd) - committed) };
      }
      const itemById = new Map((items || []).map((i) => [i.id, i]));
      return res.status(200).json({
        terms: (terms || []).map(({ body, ...t }) => t),
        budget,
        submissions: subs.map((s) => {
          const rows = (spend || []).filter((c) => c.submission_id === s.id);
          const item = itemById.get(s.item_id);
          return {
            ...s,
            item: item ? { title: item.title, status: item.status, image: item.images?.[0] || null, video_still_on_listing: item.promo_video_url === s.video_url } : null,
            spend: rows,
            spent_usd: rows.reduce((n, r) => n + Number(r.amount_usd), 0),
            tracked_link: trackedStorefrontLink(s.seller_username, s.id, 'social'),
          };
        }),
      });
    }

    if (req.method === 'POST' && req.body?.action === 'review') {
      const decision = req.body?.decision;
      if (!['selected', 'not_selected'].includes(decision)) return res.status(400).json({ error: 'decision: selected or not_selected' });
      const row = must(await promoDb.from('promo_video_submissions').update({
        status: decision, review_note: text(req.body?.note, 500), reviewed_by: admin.id, reviewed_at: new Date().toISOString(),
      }).eq('id', String(req.body?.submission_id || '')).neq('status', 'withdrawn').select('*').maybeSingle());
      if (!row) return res.status(404).json({ error: 'Submission not found, or consent was withdrawn' });
      return res.status(200).json({ submission: row });
    }

    if (req.method === 'POST' && req.body?.action === 'spend') {
      const platform = String(req.body?.platform || '').toLowerCase();
      if (!PLATFORMS.includes(platform)) return res.status(400).json({ error: `platform: ${PLATFORMS.join(', ')}` });
      const amount = Math.round(Number(req.body?.amount_usd) * 100) / 100;
      if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Enter the amount spent in US dollars (negative for a correction)' });
      if (amount < 0 && !text(req.body?.notes, 500)) return res.status(400).json({ error: 'A correction needs a note explaining it' });
      const sub = must(await promoDb.from('promo_video_submissions').select('id, seller_username').eq('id', String(req.body?.submission_id || '')).maybeSingle());
      if (!sub) return res.status(404).json({ error: 'Submission not found' });
      const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.spent_on || '')) ? req.body.spent_on : undefined;
      const row = must(await promoDb.from('promo_campaign_spend').insert({
        submission_id: sub.id,
        platform,
        amount_usd: amount,
        ...(spentOn ? { spent_on: spentOn } : {}),
        campaign_ref: text(req.body?.campaign_ref, 200),
        campaign_url: text(req.body?.campaign_url, 500),
        tracked_link: trackedStorefrontLink(sub.seller_username, sub.id, platform),
        impressions: count(req.body?.impressions),
        clicks: count(req.body?.clicks),
        notes: text(req.body?.notes, 500),
        recorded_by: admin.id,
      }).select('*').single());
      return res.status(200).json({ spend: row });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const reply = promoErrorReply(error);
    if (reply) return res.status(reply.status).json(reply.body);
    console.error('admin/promo error:', error.message || error);
    return res.status(500).json({ error: 'Promotion update failed' });
  }
}
