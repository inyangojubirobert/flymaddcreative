// Multi-payment processing API for One Dream Initiative votes
// Supports PayStack and Crypto payments
// $2 per vote, multiple votes allowed

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VOTE_VALUE = 2; // $2 per vote

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      participant_id, 
      vote_count = 1, 
      payment_method = 'paystack' // 'paystack' or 'crypto'
    } = req.body;

    if (!participant_id || vote_count <= 0) {
      return res.status(400).json({ 
        error: 'Invalid participant_id or vote_count' 
      });
    }

    if (!['paystack', 'crypto'].includes(payment_method)) {
      return res.status(400).json({ 
        error: 'Invalid payment method. Supported: paystack, crypto' 
      });
    }

    // ✅ Verify participant exists
    const { data: participant, error: findError } = await supabase
      .from('participants')
      .select('id, name, username')
      .eq('id', participant_id)
      .single();

    if (findError || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Calculate total amount
    const amount = vote_count * VOTE_VALUE;

    let paymentData = {};

    switch (payment_method) {
      case 'paystack':
        paymentData = await createPaystackPayment(amount, vote_count, participant);
        // Include public key for inline checkout
        paymentData.public_key = process.env.PAYSTACK_PUBLIC_KEY || process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';
        break;
      case 'crypto':
        paymentData = await createCryptoPayment(amount, vote_count, participant);
        break;
      default:
        throw new Error('Unsupported payment method');
    }

    return res.status(200).json({
      ...paymentData,
      amount,
      vote_count,
      payment_method,
      participant: {
        id: participant.id,
        name: participant.name,
        username: participant.username
      }
    });

  } catch (error) {
    console.error('Payment intent creation error:', error);
    return res.status(500).json({ 
      error: 'Failed to create payment intent',
      details: error.message 
    });
  }
}



// ✅ PayStack Payment Intent
async function createPaystackPayment(amount, voteCount, participant) {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  
  if (!paystackSecretKey) {
    throw new Error('PayStack not configured - missing PAYSTACK_SECRET_KEY');
  }

  // Generate truly unique reference with timestamp + random string
  const uniqueRef = `ODI_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'support@flymaddcreative.online', // Default email for anonymous payments
      amount: amount * 100 * 1600, // PayStack uses kobo - Convert USD to NGN (approx rate: 1 USD = 1600 NGN)
      currency: 'NGN',
      reference: uniqueRef,
      metadata: {
        participant_id: participant.id,
        participant_name: participant.name,
        participant_username: participant.username,
        vote_count: voteCount,
        vote_value: VOTE_VALUE,
        type: 'onedream_votes'
      },
      callback_url: `${process.env.NEXT_PUBLIC_SITE_URL}/vote.html?user=${participant.username}&payment_success=true`
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('PayStack API Error:', errorData);
    throw new Error(errorData.message || 'PayStack payment initialization failed');
  }

  const data = await response.json();

  // Calculate amounts for frontend
  const NGN_RATE = 1600; // 1 USD = 1600 NGN
  const amountNGN = amount * NGN_RATE;
  const amountKobo = amountNGN * 100;
  
  return {
    authorization_url: data.data.authorization_url,
    access_code: data.data.access_code,
    reference: data.data.reference,
    payment_intent_id: data.data.reference,
    amount: amount, // USD amount
    amount_ngn: amountNGN,
    amount_kobo: amountKobo,
    provider_data: {
      paystack_reference: data.data.reference,
      paystack_access_code: data.data.access_code
    }
  };
}

// ✅ Crypto Payment Intent (using a simple wallet address for now)
async function createCryptoPayment(amount, voteCount, participant) {
  // Generate unique payment reference
  const paymentRef = `CRYPTO_ODI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // In production, you'd integrate with crypto payment providers like:
  // - Coinbase Commerce
  // - BitPay
  // - CoinGate
  // - Custom wallet integration

  return {
    payment_intent_id: paymentRef,
    crypto_address: process.env.CRYPTO_WALLET_ADDRESS || '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', // Default Bitcoin address
    amount_usd: amount,
    amount_btc: (amount / 45000).toFixed(8), // Approximate BTC conversion (you'd get real rate from API)
    amount_eth: (amount / 3000).toFixed(6),  // Approximate ETH conversion
    qr_code_url: `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=bitcoin:${process.env.CRYPTO_WALLET_ADDRESS || '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'}?amount=${(amount / 45000).toFixed(8)}`,
    provider_data: {
      crypto_reference: paymentRef,
      supported_currencies: ['BTC', 'ETH', 'USDT']
    },
    instructions: `Send exactly ${(amount / 45000).toFixed(8)} BTC to the address above. Payment will be confirmed automatically.`
  };
}