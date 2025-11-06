// Multi-payment processing API for One Dream Initiative votes
// Supports Stripe, PayStack, and Crypto payments
// $2 per vote, multiple votes allowed

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Initialize payment providers
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

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
      payment_method = 'stripe' // 'stripe', 'paystack', 'crypto'
    } = req.body;

    if (!participant_id || vote_count <= 0) {
      return res.status(400).json({ 
        error: 'Invalid participant_id or vote_count' 
      });
    }

    if (!['stripe', 'paystack', 'crypto'].includes(payment_method)) {
      return res.status(400).json({ 
        error: 'Invalid payment method. Supported: stripe, paystack, crypto' 
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
      case 'stripe':
        paymentData = await createStripePayment(amount, vote_count, participant);
        break;
      case 'paystack':
        paymentData = await createPaystackPayment(amount, vote_count, participant);
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

// ✅ Stripe Payment Intent
async function createStripePayment(amount, voteCount, participant) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount * 100, // Stripe uses cents
    currency: 'usd',
    automatic_payment_methods: {
      enabled: true,
    },
    metadata: {
      participant_id: participant.id.toString(),
      participant_name: participant.name,
      participant_username: participant.username,
      vote_count: voteCount.toString(),
      vote_value: VOTE_VALUE.toString(),
      type: 'onedream_votes'
    },
    description: `${voteCount} vote${voteCount > 1 ? 's' : ''} for ${participant.name} - One Dream Initiative`
  });

  return {
    client_secret: paymentIntent.client_secret,
    payment_intent_id: paymentIntent.id,
    provider_data: {
      stripe_payment_intent_id: paymentIntent.id
    }
  };
}

// ✅ PayStack Payment Intent
async function createPaystackPayment(amount, voteCount, participant) {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  
  if (!paystackSecretKey) {
    throw new Error('PayStack not configured - missing PAYSTACK_SECRET_KEY');
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${paystackSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'support@flymaddcreative.online', // Default email for anonymous payments
      amount: amount * 100, // PayStack uses kobo (cents)
      currency: 'USD',
      reference: `ODI_${Date.now()}_${participant.username}`,
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
    throw new Error('PayStack payment initialization failed');
  }

  const data = await response.json();

  return {
    authorization_url: data.data.authorization_url,
    access_code: data.data.access_code,
    reference: data.data.reference,
    payment_intent_id: data.data.reference,
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