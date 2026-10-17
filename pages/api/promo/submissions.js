// The signed-in seller's opt-ins to the One Dream Storefront Promotion.
//   GET                                   terms, eligibility, my submissions
//   POST { item_id, terms_version, accept: true }   submit a listing's video
//   POST { action: 'withdraw', submission_id, reason? }   withdraw consent
// Opting in is per video and never automatic; the seller must send
// accept: true for the CURRENT terms version, which is stored with its hash
// and the exact consent sentence.

import { requireParticipant } from '../../../lib/participantAuth';
import { consentSentence, currentTerms, promoDb, promoErrorReply, sellerEligibility } from '../../../lib/storefrontPromo';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const PUBLIC_FIELDS = 'id, item_id, video_url, terms_version, consent_at, status, review_note, reviewed_at, withdrawn_at, created_at';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const terms = await currentTerms();
    if (!terms) return res.status(503).json({ error: 'The programme is not open yet' });

    if (req.method === 'GET') {
      const [eligibility, submissions] = await Promise.all([
        sellerEligibility(participant.username, terms),
        promoDb.from('promo_video_submissions').select(PUBLIC_FIELDS).eq('participant_id', participant.id).order('created_at', { ascending: false }).then(must),
      ]);
      const ids = (submissions || []).map((s) => s.id);
      const spend = ids.length ? must(await promoDb.from('promo_campaign_spend').select('submission_id, platform, spent_on, campaign_url').in('submission_id', ids)) : [];
      return res.status(200).json({
        terms: { version: terms.version, title: terms.title, body: terms.body, min_active_listings: terms.min_active_listings, max_ad_spend_usd: Number(terms.max_ad_spend_usd), programme_budget_usd: Number(terms.programme_budget_usd), max_selected_per_seller: terms.max_selected_per_seller ?? null, consent: consentSentence(terms.version) },
        eligibility,
        // Sellers see where their video was promoted, not One Dream's spend.
        submissions: (submissions || []).map((s) => ({ ...s, campaigns: (spend || []).filter((c) => c.submission_id === s.id).map(({ platform, spent_on, campaign_url }) => ({ platform, spent_on, campaign_url })) })),
      });
    }

    if (req.body?.action === 'withdraw') {
      const id = String(req.body?.submission_id || '');
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;
      const row = must(await promoDb.from('promo_video_submissions').update({ status: 'withdrawn', withdrawn_at: new Date().toISOString(), withdrawal_reason: reason })
        .eq('id', id).eq('participant_id', participant.id).neq('status', 'withdrawn').select(PUBLIC_FIELDS).maybeSingle());
      if (!row) return res.status(404).json({ error: 'No active submission to withdraw' });
      return res.status(200).json({ submission: row });
    }

    if (req.body?.accept !== true) return res.status(400).json({ error: 'Tick the consent box to submit your video' });
    if (Number(req.body?.terms_version) !== terms.version) {
      return res.status(409).json({ error: 'The programme terms have been updated. Review them and try again.', code: 'terms_changed' });
    }
    const eligibility = await sellerEligibility(participant.username, terms);
    if (!eligibility.eligible) {
      return res.status(400).json({ error: `You need at least ${eligibility.required_listings} active listings (you have ${eligibility.active_listings}).`, code: 'not_eligible' });
    }
    const video = eligibility.videos.find((v) => String(v.item_id) === String(req.body?.item_id || ''));
    if (!video) return res.status(400).json({ error: 'Choose one of your active listings that has a promotional video', code: 'no_video' });

    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const { data, error } = await promoDb.from('promo_video_submissions').insert({
      participant_id: participant.id,
      seller_username: participant.username,
      item_id: video.item_id,
      video_url: video.video_url,
      terms_version: terms.version,
      terms_sha256: terms.body_sha256,
      consent_text: consentSentence(terms.version),
      consent_ip: (forwarded || req.socket?.remoteAddress || '').slice(0, 64) || null,
      consent_user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    }).select(PUBLIC_FIELDS).single();
    if (error?.code === '23505') return res.status(409).json({ error: 'This video is already submitted', code: 'already_submitted' });
    if (error) throw error;
    return res.status(200).json({ submission: data });
  } catch (error) {
    const reply = promoErrorReply(error);
    if (reply) return res.status(reply.status).json(reply.body);
    console.error('promo/submissions error:', error.message || error);
    return res.status(500).json({ error: 'Could not update your promotion settings' });
  }
}
