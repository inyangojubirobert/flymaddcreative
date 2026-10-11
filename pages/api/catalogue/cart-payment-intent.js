// Creates one Paystack hosted-checkout transaction for a whole cart
// (listings + buyer service charge). Same hosted-checkout pattern as
// create-payment-intent.js. The priced lines are stored in the Paystack
// metadata - set here with the secret key, so the client cannot alter them -
// and cart-checkout.js builds the orders from that metadata after verifying
// the charge.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate, usdToKobo, usdToNgn } from '../../../lib/currency';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';
import { cartCheckoutReady, normalizeCartLines, priceCart } from '../../../lib/catalogueCart';

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
    if (!quote.payment_methods.includes('paystack')) {
      return res.status(400).json({ error: 'A listing in your cart does not accept Paystack. Pay with USDT or remove it.' });
    }

    const totalUsd = quote.total_usd;
    const amountKobo = usdToKobo(totalUsd, rate);
    const reference = `CART_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;

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
        metadata: {
          type: 'catalogue_cart',
          lines: quote.lines.map((line) => ({
            item_id: line.item_id,
            quantity: line.quantity,
            unit_price_usd: line.unit_price_usd,
            line_total_usd: line.line_total_usd,
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
    return res.status(200).json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      subtotal_usd: quote.subtotal_usd,
      service_fee_usd: quote.service_fee_usd,
      total_usd: totalUsd,
      amount_ngn: usdToNgn(totalUsd, rate),
      exchange_rate: rate,
    });
  } catch (error) {
    console.error('catalogue/cart-payment-intent error:', error);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
}
