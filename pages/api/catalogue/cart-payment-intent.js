// Creates one Paystack hosted-checkout transaction for a whole cart
// (listings + buyer service charge). Same hosted-checkout pattern as
// create-payment-intent.js. The priced lines are stored in the Paystack
// metadata - set here with the secret key, so the client cannot alter them -
// and cart-checkout.js builds the orders from that metadata after verifying
// the charge.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate, usdToKobo, usdToNgn } from '../../../lib/currency';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';
import { QuoteError, bindQuotePayment, loadQuoteForPayment, multiCurrencyCheckoutActive, quotePaystackMetadata } from '../../../lib/quoteCheckout';
import { cartCheckoutReady, normalizeCartLines, priceCart } from '../../../lib/catalogueCart';
import { recordIntentFromTokens } from '../../../lib/earnings';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { lines: rawLines, buyer_email, callback_url } = req.body || {};
    const normalized = normalizeCartLines(rawLines);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    if (!(await cartCheckoutReady(supabase))) {
      return res.status(503).json({ error: 'Cart checkout is not available yet. Please buy listings individually for now.' });
    }

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      return res.status(500).json({ error: 'Paystack not configured' });
    }

    const rate = await getUsdToNgnRate();
    const quote = await priceCart(supabase, normalized.lines, rate);
    if (quote.has_problems) {
      return res.status(409).json({ error: 'Some listings in your cart changed. Review your cart and try again.', quote });
    }
    // P7: with multi-currency listings on, the buyer pays the stored quote:
    // naira listings only, charged exactly in naira with no conversion.
    const mcQuote = (await multiCurrencyCheckoutActive(normalized.lines))
      ? await loadQuoteForPayment(req.body?.quote_id, { route: 'paystack', lines: normalized.lines })
      : null;
    if (!mcQuote && !quote.payment_methods.includes('paystack')) {
      return res.status(400).json({ error: 'A listing in your cart does not accept Paystack. Pay with USDT or remove it.' });
    }

    const totalUsd = quote.total_usd;
    const amountKobo = mcQuote ? Number(mcQuote.total_minor) : usdToKobo(totalUsd, rate);
    const reference = `CART_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
    if (mcQuote) await bindQuotePayment(mcQuote.id, reference);
    // P6: the buyer's contact and delivery details stay on our server (not in
    // Paystack metadata) so pages/api/admin/earnings/complete-unreturned.js can
    // finish the checkout if the buyer pays and never comes back.
    const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
    const { error: pendingError } = await supabase.from('catalogue_pending_checkouts').insert({
      payment_ref: reference,
      buyer: {
        buyer_name: text(req.body?.buyer_name, 120),
        buyer_email: text(buyer_email, 200).toLowerCase(),
        buyer_whatsapp: text(req.body?.buyer_whatsapp, 40),
        delivery_address: text(req.body?.delivery_address, 500) || null,
        notes: text(req.body?.notes, 500) || null,
      },
    });
    if (pendingError) console.error('[cart] pending checkout not stored:', pendingError.message);

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: typeof buyer_email === 'string' && EMAIL_RE.test(buyer_email.trim()) ? buyer_email.trim() : 'support@flymaddcreative.online',
        amount: amountKobo,
        currency: 'NGN',
        reference,
        metadata: mcQuote ? quotePaystackMetadata(mcQuote) : {
          type: 'catalogue_cart',
          lines: quote.lines.map((line) => ({
            item_id: line.item_id,
            quantity: line.quantity,
            unit_price_usd: line.unit_price_usd,
            line_total_usd: line.line_total_usd,
            ...(line.resale_membership_id ? { resale_membership_id: line.resale_membership_id } : {}),
          })),
          subtotal_usd: quote.subtotal_usd,
          service_fee_usd: quote.service_fee_usd,
          total_usd: totalUsd,
          fee_percent: quote.fee_policy.percent,
          fee_cap_usd: quote.fee_policy.cap_usd,
          exchange_rate: rate,
        },
        callback_url: resolveCallbackUrl(callback_url, `${process.env.NEXT_PUBLIC_SITE_URL}/app`),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('PayStack API Error:', errorData);
      return res.status(502).json({ error: errorData.message || 'PayStack payment initialization failed' });
    }

    const data = await response.json();
    // P5: tie any affiliate attribution to this reference on the server,
    // before the buyer pays. Best effort: never blocks or changes the payment.
    if (Array.isArray(req.body?.affiliate_tokens) && req.body.affiliate_tokens.length) {
      await recordIntentFromTokens({ paymentRef: data.data.reference, method: 'paystack', buyerEmail: buyer_email, tokens: req.body.affiliate_tokens })
        .catch((error) => console.error('[affiliate] intent not recorded:', error.message || error));
    }
    return res.status(200).json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      subtotal_usd: quote.subtotal_usd,
      service_fee_usd: quote.service_fee_usd,
      total_usd: totalUsd,
      amount_ngn: mcQuote ? Number(mcQuote.total_minor) / 100 : usdToNgn(totalUsd, rate),
      quote_id: mcQuote?.id ?? null,
      exchange_rate: rate,
    });
  } catch (error) {
    if (error instanceof QuoteError) return res.status(409).json({ error: error.message, code: error.code });
    console.error('catalogue/cart-payment-intent error:', error);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
}
