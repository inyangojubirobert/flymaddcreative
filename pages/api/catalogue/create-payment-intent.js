// Creates a real Paystack hosted-checkout transaction for a catalogue item.
//
// The website's catalogue-product.html never needed this: it uses Paystack's
// browser-only inline JS popup (https://js.paystack.co/v1/inline.js) to
// charge the card directly in-page, then calls /api/catalogue/verify-order
// with the resulting reference. React Native has no equivalent of that
// inline widget, so the mobile app needs the same hosted-checkout pattern
// pages/api/onedream/create-payment-intent.js already uses for votes:
// initialize the transaction server-side, return authorization_url, let the
// client open it in an OS browser tab, then verify-order.js re-confirms the
// payment server-side regardless of what the client claims.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate, usdToKobo, usdToNgn } from '../../../lib/currency';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { item_id, callback_url } = req.body;
    if (!item_id) {
      return res.status(400).json({ error: 'Missing item_id' });
    }

    const { data: item, error: itemError } = await supabase
      .from('catalogue_items')
      .select('id, title, price_usd, seller_username, status')
      .eq('id', item_id)
      .single();

    if (itemError || !item || item.status === 'deleted') {
      return res.status(404).json({ error: 'Product not found' });
    }

    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecretKey) {
      return res.status(500).json({ error: 'Paystack not configured' });
    }

    const priceUsd = parseFloat(item.price_usd);
    const rate = await getUsdToNgnRate();
    const amountKobo = usdToKobo(priceUsd, rate);
    const uniqueRef = `ITEM_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'support@flymaddcreative.online',
        amount: amountKobo,
        currency: 'NGN',
        reference: uniqueRef,
        metadata: {
          item_id: item.id,
          item_title: item.title,
          seller_username: item.seller_username,
          type: 'catalogue_purchase',
          exchange_rate: rate,
          amount_usd: priceUsd,
        },
        callback_url: resolveCallbackUrl(
          callback_url,
          `${process.env.NEXT_PUBLIC_SITE_URL}/catalogue-product.html?item=${item.id}&payment_success=true`
        ),
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
      amount_usd: priceUsd,
      amount_ngn: usdToNgn(priceUsd, rate),
      amount_kobo: amountKobo,
      exchange_rate: rate,
    });
  } catch (error) {
    console.error('catalogue/create-payment-intent error:', error);
    return res.status(500).json({ error: 'Failed to create payment intent', details: error.message });
  }
}
