// Sends a virtual gift with Dream Coins the sender already owns.
//   POST { recipient_username, gift_id, quantity?, client_request_id,
//          message?, anonymous?, order_id?, buyer_token? }
//
// - Cost comes from the gift catalogue, the balance from the ledger; neither
//   is taken from the client. virtual_gift_send() deducts atomically, refuses
//   self-gifts, applies rate limits and is idempotent per client_request_id.
// - order_id + buyer_token (the buyer's private order link) mark the gift as
//   from a verified buyer. The order is only READ, and only a delivered order
//   (buyer_confirmed / released) with this seller qualifies. Nothing about
//   the order, its escrow or the seller's earnings changes.
// - Gifts are recognition only: they are not votes, prize entries or money.

import { requireParticipant } from '../../../../lib/participantAuth';
import { GIFT_LIMITS, giftsDb, participantByUsername } from '../../../../lib/dreamCoins';
import { giftErrorReply, orderAllowsAppreciation, validateGiftRequest } from '../../../../lib/dreamCoinsRules';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const checked = validateGiftRequest(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const input = checked.value;

  try {
    const recipient = await participantByUsername(input.recipient);
    if (!recipient) return res.status(404).json({ error: 'Seller not found' });
    if (recipient.id === participant.id) return res.status(400).json({ error: 'You cannot send a gift to yourself', code: 'self_gifting' });

    let verifiedBuyer = false;
    if (input.orderId) {
      const { data: order, error } = await giftsDb.from('catalogue_orders')
        .select('id, status, buyer_token, seller_username').eq('id', input.orderId).maybeSingle();
      if (error) throw error;
      const verdict = orderAllowsAppreciation(order, { buyerToken: input.buyerToken, sellerUsername: recipient.username });
      if (!verdict.ok) return res.status(400).json({ error: verdict.reason });
      verifiedBuyer = true;
    }

    const { data, error } = await giftsDb.rpc('virtual_gift_send', {
      p_sender_id: participant.id,
      p_recipient_id: recipient.id,
      p_gift_id: input.giftId,
      p_quantity: input.quantity,
      p_client_request_id: input.clientRequestId,
      p_context_type: input.orderId ? 'order' : 'profile',
      p_context_ref: input.orderId,
      p_verified_buyer: verifiedBuyer,
      p_message: input.message,
      p_is_anonymous: input.anonymous,
      p_max_gifts_per_hour: GIFT_LIMITS.perHour,
      p_max_coins_per_day: GIFT_LIMITS.coinsPerDay,
    });
    if (error) {
      const reply = giftErrorReply(error.message);
      if (reply) return res.status(reply.status).json(reply.body);
      throw error;
    }
    return res.status(200).json({ success: true, ...data, recipient: { username: recipient.username, name: recipient.name } });
  } catch (error) {
    console.error('gifts/send error:', error.message || error);
    return res.status(500).json({ error: 'Could not send the gift. Please try again - a retry never charges twice.' });
  }
}
