// Creates a catalogue_orders row server-side, after verifying payment.
// Replaces the previous flow where catalogue-product.html inserted directly
// into catalogue_orders from the browser with status: 'paid' straight off
// the Paystack popup's client-side callback - anyone could call
// window.SupabaseAPI.createCatalogueOrder(...) from devtools and create a
// "paid" order for free, with no server ever checking Paystack.
//
// For Paystack: verifies the transaction with Paystack's API using the
// secret key, confirms it succeeded, and confirms the NGN amount paid
// matches the item's USD price (converted at the same live rate a
// legitimate charge would have used, with a small tolerance for rate drift
// between charge and verification).
//
// For USDT: no automated on-chain verification exists yet (same as before
// this fix) - the order is created as 'pending_verification' for manual
// review. The item price is still looked up server-side rather than trusted
// from the client.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate } from '../../../lib/currency';
import { verifyAndRecordUsdtPayment } from '../../../lib/verifyCryptoTx';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      item_id,
      buyer_name,
      buyer_email,
      buyer_whatsapp,
      notes,
      payment_method,
      payment_ref, // paystack
      tx_hash      // usdt
    } = req.body;

    if (!item_id || !buyer_name || !buyer_email) {
      return res.status(400).json({ error: 'Missing required fields: item_id, buyer_name, buyer_email' });
    }

    if (!['paystack', 'usdt'].includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment_method' });
    }

    const { data: item, error: itemError } = await supabase
      .from('catalogue_items')
      .select('id, price_usd, seller_username, status')
      .eq('id', item_id)
      .single();

    if (itemError || !item || item.status === 'deleted') {
      return res.status(404).json({ error: 'Product not found' });
    }

    const priceUsd = parseFloat(item.price_usd);
    let orderRecord = {
      item_id,
      seller_username: item.seller_username,
      buyer_name,
      buyer_email,
      buyer_whatsapp: buyer_whatsapp || null,
      amount_usd: priceUsd,
      payment_method,
      notes: notes || null
    };

    if (payment_method === 'paystack') {
      if (!payment_ref) {
        return res.status(400).json({ error: 'Missing payment_ref' });
      }

      // Idempotency: if this reference was already turned into an order, return it
      // instead of erroring - a retried request shouldn't look like a failure.
      const { data: existingOrder } = await supabase
        .from('catalogue_orders')
        .select('*, catalogue_items(title, images, price_usd, seller_username)')
        .eq('payment_ref', payment_ref)
        .maybeSingle();
      if (existingOrder) {
        return res.status(200).json(existingOrder);
      }

      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackSecretKey) {
        return res.status(500).json({ error: 'Paystack not configured' });
      }

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${payment_ref}`, {
        headers: { 'Authorization': `Bearer ${paystackSecretKey}` }
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
        return res.status(400).json({ error: 'Payment verification failed', details: verifyData.data?.status });
      }

      if (verifyData.data.currency !== 'NGN') {
        return res.status(400).json({ error: 'Unexpected payment currency' });
      }

      // A matching amount alone is not enough: two catalogue items can have
      // the same price. create-payment-intent.js stores the item id in the
      // Paystack metadata, so bind this order to that server-created intent
      // and prevent a valid reference for one item being reused for another.
      if (
        verifyData.data.metadata?.type !== 'catalogue_purchase'
        || String(verifyData.data.metadata?.item_id || '') !== String(item.id)
      ) {
        return res.status(400).json({ error: 'Payment was not created for this product' });
      }

      const amountNGN = verifyData.data.amount / 100;
      const rate = verifyData.data.metadata?.exchange_rate || await getUsdToNgnRate();
      const expectedNGN = priceUsd * rate;

      // 2% tolerance for rate drift between when the charge was built and now.
      if (Math.abs(amountNGN - expectedNGN) / expectedNGN > 0.02) {
        console.error('Catalogue order amount mismatch', { amountNGN, expectedNGN, item_id, payment_ref });
        return res.status(400).json({ error: 'Paid amount does not match item price' });
      }

      orderRecord.amount_ngn = amountNGN;
      orderRecord.exchange_rate = rate;
      orderRecord.currency = 'NGN';
      orderRecord.payment_ref = payment_ref;
      orderRecord.tx_hash = null;
      orderRecord.status = 'paid';
    } else {
      if (!tx_hash) {
        return res.status(400).json({ error: 'Missing tx_hash' });
      }
      const cryptoResult = await verifyAndRecordUsdtPayment({ txHash: tx_hash, network: req.body.network });
      if (!cryptoResult.verified) {
        return res.status(cryptoResult.status || 400).json({
          error: cryptoResult.error || 'USDT payment is not confirmed',
          pending: cryptoResult.pending || false
        });
      }
      if (cryptoResult.payment.amount + 0.01 < priceUsd) {
        return res.status(400).json({ error: 'Paid amount does not match item price' });
      }
      orderRecord.payment_ref = tx_hash;
      orderRecord.tx_hash = tx_hash;
      orderRecord.status = 'paid';
      orderRecord.currency = 'USD';
    }

    const buyerToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { data: order, error: insertError } = await supabase
      .from('catalogue_orders')
      .insert({ ...orderRecord, buyer_token: buyerToken, created_at: new Date().toISOString() })
      .select('*, catalogue_items(title, images, price_usd, seller_username)')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        // Race with another request for the same payment_ref.
        const { data: raceOrder } = await supabase
          .from('catalogue_orders')
          .select('*, catalogue_items(title, images, price_usd, seller_username)')
          .eq('payment_ref', payment_ref)
          .maybeSingle();
        if (raceOrder) return res.status(200).json(raceOrder);
      }
      console.error('Order insert error:', insertError);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    return res.status(200).json(order);
  } catch (error) {
    console.error('verify-order error:', error);
    return res.status(500).json({ error: 'Order verification failed', details: error.message });
  }
}
