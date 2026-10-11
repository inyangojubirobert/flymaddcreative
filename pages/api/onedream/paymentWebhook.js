// Paystack webhook (charge.success) for vote purchases.
//
// Credits votes for `onedream_votes` charges as a backstop when the buyer
// closes the browser before /api/onedream/vote runs. Uses the same verified,
// credit-once path as vote.js (lib/voteCredits.js), so the webhook and the
// browser can never both credit one payment. All other events and charge
// types (marketplace, cart, AI) are acknowledged and ignored here.
//
// Fail-closed: requests without a valid HMAC-SHA512 signature over the raw
// body (PAYSTACK_SECRET_KEY) are rejected.

import crypto from 'crypto';
import { creditPaidVotes, verifyPaystackVote } from '../../../lib/voteCredits';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

function validSignature(rawBody, signature) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await readRawBody(req);
    if (!validSignature(rawBody, req.headers['x-paystack-signature'])) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    const { event, data } = JSON.parse(rawBody.toString('utf8') || '{}');
    let meta = data?.metadata;
    if (typeof meta === 'string') {
      try { meta = JSON.parse(meta); } catch { meta = null; }
    }
    if (event !== 'charge.success' || meta?.type !== 'onedream_votes' || !meta?.participant_id || !data?.reference) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const verified = await verifyPaystackVote(data.reference, meta.participant_id);
    if (verified.alreadyProcessed) return res.status(200).json({ received: true, already_processed: true });
    if (verified.error) {
      console.error('[webhook] vote payment not creditable', data.reference, verified.error);
      return res.status(200).json({ received: true, credited: false });
    }

    const result = await creditPaidVotes({
      participantId: meta.participant_id,
      paymentIntentId: data.reference,
      paymentMethod: 'paystack',
      voteCount: verified.voteCount,
      amountUsd: verified.amountUsd,
      amountNgn: verified.amountNgn,
      rate: verified.rate,
      currency: 'NGN',
    });
    return res.status(200).json({ received: true, credited: result.votesCredited || 0 });
  } catch (error) {
    // 500 makes Paystack retry later; crediting is idempotent.
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
