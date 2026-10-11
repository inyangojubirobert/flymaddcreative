// Completes a multi-listing cart checkout after payment, server-side.
//
// One payment -> one catalogue_checkouts row (records the buyer service
// charge and totals) -> one catalogue_orders row per listing, each with its
// own buyer_token, so per-seller escrow in order-action.js is unchanged.
// Each order's amount_usd is the listing amount only; the service charge is
// platform revenue and never becomes part of a seller's escrow.
//
// Paystack: the charge is verified with Paystack and the lines are taken from
// the metadata cart-payment-intent.js attached server-side - what the buyer
// actually paid for, even if a price has changed since.
// USDT: the cart is priced live, then the tx is verified on-chain and must
// cover the total (listings + service charge).
//
// Atomic: the checkout, the USDT claim and all orders are written in one
// database transaction (create_cart_checkout). Idempotent per payment
// reference: retrying returns the same orders, but only to a request carrying
// the same buyer email, since the response includes buyer tokens.

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate, usdToKobo } from '../../../lib/currency';
import { verifyAndRecordUsdtPayment } from '../../../lib/verifyCryptoTx';
import { cartCheckoutReady, normalizeCartLines, priceCart } from '../../../lib/catalogueCart';
import { toCents } from '../../../lib/marketplaceFees';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER_SELECT = '*, catalogue_items(title, images, price_usd, seller_username)';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { payment_method, payment_ref, tx_hash, network, lines, notes } = req.body || {};
    const buyerName = typeof req.body?.buyer_name === 'string' ? req.body.buyer_name.trim().slice(0, 120) : '';
    const buyerEmail = typeof req.body?.buyer_email === 'string' ? req.body.buyer_email.trim().toLowerCase().slice(0, 200) : '';
    const buyerWhatsapp = typeof req.body?.buyer_whatsapp === 'string' ? req.body.buyer_whatsapp.trim().slice(0, 40) : '';

    if (!buyerName || !EMAIL_RE.test(buyerEmail)) {
      return res.status(400).json({ error: 'Enter your name and a valid email' });
    }
    if (!['paystack', 'usdt'].includes(payment_method)) {
      return res.status(400).json({ error: 'Invalid payment_method' });
    }
    if (!(await cartCheckoutReady(supabase))) {
      return res.status(503).json({ error: 'Cart checkout is not available yet' });
    }

    const buyer = {
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      buyer_whatsapp: buyerWhatsapp || null,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null,
    };
    let checkoutRecord;

    if (payment_method === 'paystack') {
      if (!payment_ref) return res.status(400).json({ error: 'Missing payment_ref' });

      const existing = await findCheckout(payment_ref);
      if (existing) return respondWithExisting(res, existing, buyerEmail);

      const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackSecretKey) return res.status(500).json({ error: 'Paystack not configured' });

      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(payment_ref)}`, {
        headers: { 'Authorization': `Bearer ${paystackSecretKey}` }
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
        return res.status(400).json({ error: 'Payment verification failed', details: verifyData.data?.status });
      }
      if (verifyData.data.currency !== 'NGN') {
        return res.status(400).json({ error: 'Unexpected payment currency' });
      }

      let meta = verifyData.data.metadata;
      if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = null; }
      }
      const metaLines = validMetadataLines(meta);
      if (meta?.type !== 'catalogue_cart' || !metaLines) {
        return res.status(400).json({ error: 'Payment was not created for a cart checkout' });
      }

      const rate = Number(meta.exchange_rate);
      const expectedKobo = usdToKobo(Number(meta.total_usd), rate);
      const paidKobo = Number(verifyData.data.amount);
      if (!(expectedKobo > 0) || Math.abs(paidKobo - expectedKobo) / expectedKobo > 0.02) {
        console.error('Cart checkout amount mismatch', { paidKobo, expectedKobo, payment_ref });
        return res.status(400).json({ error: 'Paid amount does not match cart total' });
      }

      checkoutRecord = {
        payment_ref,
        payment_method,
        network: null,
        lines: metaLines,
        subtotal_usd: Number(meta.subtotal_usd),
        service_fee_usd: Number(meta.service_fee_usd) || 0,
        total_usd: Number(meta.total_usd),
        fee_percent: meta.fee_percent ?? null,
        fee_cap_usd: meta.fee_cap_usd ?? null,
        fee_cap_ngn: meta.fee_cap_usd != null && rate ? Math.round(Number(meta.fee_cap_usd) * rate) : null,
        currency: 'NGN',
        amount_ngn: paidKobo / 100,
        exchange_rate: rate,
      };
    } else {
      const txHash = typeof tx_hash === 'string' ? tx_hash.trim() : '';
      if (!txHash) return res.status(400).json({ error: 'Missing tx_hash' });

      const existing = await findCheckout(txHash);
      if (existing) return respondWithExisting(res, existing, buyerEmail);

      // The same transaction must not also pay for a single-item order.
      const { data: singleOrder } = await supabase
        .from('catalogue_orders')
        .select('id')
        .eq('payment_ref', txHash)
        .maybeSingle();
      if (singleOrder) return res.status(409).json({ error: 'This transaction has already been used for another order' });

      const normalized = normalizeCartLines(lines);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
      const rate = await getUsdToNgnRate();
      const quote = await priceCart(supabase, normalized.lines, rate);
      if (quote.has_problems) {
        return res.status(409).json({ error: 'Some listings in your cart changed. Review your cart and try again.', quote });
      }
      if (!quote.payment_methods.includes('usdt')) {
        return res.status(400).json({ error: 'A listing in your cart does not accept USDT' });
      }

      const cryptoResult = await verifyAndRecordUsdtPayment({ txHash, network });
      if (!cryptoResult.verified) {
        return res.status(cryptoResult.status || 400).json({
          error: cryptoResult.error || 'USDT payment is not confirmed yet',
          pending: cryptoResult.pending || false,
          confirmations: cryptoResult.confirmations,
          required: cryptoResult.required,
        });
      }
      if (cryptoResult.payment.consumed_for || cryptoResult.payment.user_id) {
        return res.status(409).json({ error: 'This transaction has already been used for another payment' });
      }
      if (Number(cryptoResult.payment.amount) + 0.01 < quote.total_usd) {
        return res.status(400).json({ error: `Transaction amount is less than the cart total of $${quote.total_usd.toFixed(2)}` });
      }

      checkoutRecord = {
        payment_ref: txHash,
        payment_method,
        network: String(network).toLowerCase(),
        lines: quote.lines.map(({ item_id, quantity, unit_price_usd, line_total_usd }) => ({ item_id, quantity, unit_price_usd, line_total_usd })),
        subtotal_usd: quote.subtotal_usd,
        service_fee_usd: quote.service_fee_usd,
        total_usd: quote.total_usd,
        fee_percent: quote.fee_policy.percent,
        fee_cap_usd: quote.fee_policy.cap_usd,
        fee_cap_ngn: quote.fee_policy.cap_ngn,
        currency: 'USD',
        amount_ngn: null,
        exchange_rate: rate,
      };
    }

    // Checkout row, USDT claim and every order are written in ONE database
    // transaction (create_cart_checkout in supabase/add_cart_checkout.sql):
    // either the buyer gets all their orders or nothing is recorded and the
    // same payment reference can safely be retried.
    const fullCheckout = { ...checkoutRecord, ...buyer, status: 'paid' };
    const orderRows = await buildOrderRows(fullCheckout);
    const { data: written, error: writeError } = await supabase.rpc('create_cart_checkout', {
      p_checkout: fullCheckout,
      p_orders: orderRows,
    });
    if (writeError) {
      if (/usdt_payment_taken/.test(writeError.message || '')) {
        return res.status(409).json({ error: 'This transaction has already been used for another payment' });
      }
      console.error('Cart checkout write error:', writeError, { payment_ref: fullCheckout.payment_ref });
      return res.status(500).json({ error: 'Your payment was received but the order could not be saved. Tap retry - you will not be charged again.', retryable: true });
    }

    const checkout = await findCheckout(fullCheckout.payment_ref);
    if (!checkout) throw new Error(`Checkout ${written?.checkout_id} not readable after write`);
    if (!written?.created) return respondWithExisting(res, checkout, buyerEmail);
    return res.status(200).json({ checkout: publicCheckout(checkout), orders: await ordersFor(checkout) });
  } catch (error) {
    console.error('catalogue/cart-checkout error:', error);
    return res.status(500).json({ error: 'Checkout failed. If you were charged, contact support with your payment reference.' });
  }
}

function validMetadataLines(meta) {
  if (!meta || !Array.isArray(meta.lines) || meta.lines.length === 0) return null;
  const lines = meta.lines.map((line) => ({
    item_id: String(line?.item_id || ''),
    quantity: Number(line?.quantity),
    unit_price_usd: Number(line?.unit_price_usd),
    line_total_usd: Number(line?.line_total_usd),
  }));
  const valid = lines.every((line) => line.item_id && Number.isInteger(line.quantity) && line.quantity > 0 && line.line_total_usd > 0);
  if (!valid) return null;
  const linesCents = lines.reduce((sum, line) => sum + toCents(line.line_total_usd), 0);
  if (linesCents !== toCents(meta.subtotal_usd)) return null;
  if (linesCents + toCents(meta.service_fee_usd || 0) !== toCents(meta.total_usd)) return null;
  return lines;
}

async function findCheckout(paymentRef) {
  const { data } = await supabase
    .from('catalogue_checkouts')
    .select('*')
    .eq('payment_ref', paymentRef)
    .maybeSingle();
  return data || null;
}

async function respondWithExisting(res, checkout, buyerEmail) {
  if (String(checkout.buyer_email).toLowerCase() !== buyerEmail) {
    return res.status(409).json({ error: 'This payment has already been used' });
  }
  return res.status(200).json({ checkout: publicCheckout(checkout), orders: await ordersFor(checkout) });
}

async function ordersFor(checkout) {
  const { data, error } = await supabase
    .from('catalogue_orders')
    .select(ORDER_SELECT)
    .eq('checkout_id', checkout.id)
    .order('payment_ref', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** One catalogue_orders row per cart line; amount_usd excludes the service charge. */
async function buildOrderRows(checkout) {
  const lines = checkout.lines || [];
  const { data: items, error: itemsError } = await supabase
    .from('catalogue_items')
    .select('id, seller_username')
    .in('id', lines.map((line) => line.item_id));
  if (itemsError) throw itemsError;
  const sellerByItem = new Map((items || []).map((item) => [String(item.id), item.seller_username]));

  const now = new Date().toISOString();
  return lines.map((line, index) => {
    const seller = sellerByItem.get(String(line.item_id));
    if (!seller) throw new Error(`Paid cart listing ${line.item_id} no longer exists (payment ${checkout.payment_ref})`);
    return {
      item_id: line.item_id,
      seller_username: seller,
      buyer_name: checkout.buyer_name,
      buyer_email: checkout.buyer_email,
      buyer_whatsapp: checkout.buyer_whatsapp,
      notes: checkout.notes,
      amount_usd: line.line_total_usd,
      unit_price_usd: line.unit_price_usd,
      quantity: line.quantity,
      payment_method: checkout.payment_method,
      currency: checkout.currency,
      exchange_rate: checkout.exchange_rate,
      amount_ngn: checkout.payment_method === 'paystack' ? Math.round(line.line_total_usd * checkout.exchange_rate * 100) / 100 : null,
      // Per-order unique refs (catalogue_orders.payment_ref is unique); the
      // shared reference lives on catalogue_checkouts.
      payment_ref: `${checkout.payment_ref}#${String(index + 1).padStart(2, '0')}`,
      tx_hash: checkout.payment_method === 'usdt' ? checkout.payment_ref : null,
      status: 'paid',
      buyer_token: crypto.randomBytes(16).toString('hex'),
      created_at: now,
    };
  });
}

function publicCheckout(checkout) {
  return {
    id: checkout.id,
    payment_method: checkout.payment_method,
    subtotal_usd: Number(checkout.subtotal_usd),
    service_fee_usd: Number(checkout.service_fee_usd),
    total_usd: Number(checkout.total_usd),
    amount_ngn: checkout.amount_ngn === null ? null : Number(checkout.amount_ngn),
    currency: checkout.currency,
    created_at: checkout.created_at,
  };
}
