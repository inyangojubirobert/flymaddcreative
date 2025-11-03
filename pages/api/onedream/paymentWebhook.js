// Mock webhook handler for payment providers
// Converts payment events to votes and updates user records
// Ready for integration with Stripe, Coinbase Commerce, etc.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { calcVotesFromAmount, recordVote } from '../../../lib/onedreamHelpers';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const provider = req.query.provider || 'stripe'; // Default to Stripe
  
  try {
    // Verify webhook signature based on provider
    const isValidSignature = await verifyWebhookSignature(req, provider);
    if (!isValidSignature) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Process payment based on provider
    let paymentData = null;
    
    switch (provider) {
      case 'stripe':
        paymentData = await processStripeWebhook(req.body);
        break;
      case 'coinbase':
        paymentData = await processCoinbaseWebhook(req.body);
        break;
      case 'mock':
        paymentData = await processMockWebhook(req.body);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported payment provider' });
    }

    if (!paymentData) {
      return res.status(400).json({ error: 'Invalid payment data' });
    }

    // Record payment in database
    const { data: payment, error: paymentError } = await supabase
      .from('onedream_payments')
      .insert({
        user_id: paymentData.userId,
        provider: provider,
        amount_usd: paymentData.amount,
        provider_payment_id: paymentData.paymentId,
        status: 'completed',
        metadata: paymentData.metadata || {}
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment recording error:', paymentError);
      return res.status(500).json({ error: 'Failed to record payment' });
    }

    // Calculate and record votes
    const votes = calcVotesFromAmount(paymentData.amount);
    
    await recordVote({
      userId: paymentData.userId,
      votes,
      amountUsd: paymentData.amount,
      source: 'payment'
    });

    // Send confirmation email (optional)
    // await sendPaymentConfirmationEmail(paymentData);

    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      data: {
        paymentId: payment.id,
        votesAwarded: votes,
        amount: paymentData.amount
      }
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ 
      error: 'Webhook processing failed' 
    });
  }
}

// Verify webhook signature for different providers
async function verifyWebhookSignature(req, provider) {
  const signature = req.headers['stripe-signature'] || 
                   req.headers['x-cc-webhook-signature'] || 
                   req.headers['x-webhook-signature'];

  switch (provider) {
    case 'stripe':
      return verifyStripeSignature(req.body, signature);
    case 'coinbase':
      return verifyCoinbaseSignature(req.body, signature);
    case 'mock':
      return true; // Skip verification for mock payments
    default:
      return false;
  }
}

// Stripe webhook signature verification
function verifyStripeSignature(payload, signature) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('Stripe webhook secret not configured');
      return true; // Allow in development
    }

    // Stripe signature verification logic
    const elements = signature.split(',');
    const signatureHash = elements.find(el => el.startsWith('v1='))?.split('=')[1];
    
    if (!signatureHash) return false;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signatureHash, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Stripe signature verification error:', error);
    return false;
  }
}

// Coinbase Commerce webhook signature verification
function verifyCoinbaseSignature(payload, signature) {
  try {
    const secret = process.env.COINBASE_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('Coinbase webhook secret not configured');
      return true; // Allow in development
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Coinbase signature verification error:', error);
    return false;
  }
}

// Process Stripe webhook events
async function processStripeWebhook(eventData) {
  const { type, data } = eventData;

  if (type === 'payment_intent.succeeded') {
    const paymentIntent = data.object;
    
    return {
      userId: paymentIntent.metadata.userId,
      amount: paymentIntent.amount / 100, // Convert cents to dollars
      paymentId: paymentIntent.id,
      metadata: {
        provider: 'stripe',
        currency: paymentIntent.currency,
        customerEmail: paymentIntent.charges?.data[0]?.billing_details?.email
      }
    };
  }

  return null; // Ignore other event types
}

// Process Coinbase Commerce webhook events
async function processCoinbaseWebhook(eventData) {
  const { type, data } = eventData;

  if (type === 'charge:confirmed') {
    const charge = data;
    
    return {
      userId: charge.metadata.userId,
      amount: parseFloat(charge.pricing.local.amount),
      paymentId: charge.id,
      metadata: {
        provider: 'coinbase',
        cryptocurrency: charge.payments[0]?.currency,
        network: charge.payments[0]?.network
      }
    };
  }

  return null; // Ignore other event types
}

// Process mock webhook for development/testing
async function processMockWebhook(eventData) {
  const { userId, amount, paymentId } = eventData;

  if (!userId || !amount || !paymentId) {
    throw new Error('Mock webhook missing required fields: userId, amount, paymentId');
  }

  return {
    userId,
    amount: parseFloat(amount),
    paymentId,
    metadata: {
      provider: 'mock',
      test: true
    }
  };
}

// Send payment confirmation email (placeholder)
async function sendPaymentConfirmationEmail(paymentData) {
  // Integrate with email service like SendGrid, Mailgun, etc.
  console.log('Sending payment confirmation email:', {
    userId: paymentData.userId,
    amount: paymentData.amount,
    paymentId: paymentData.paymentId
  });
  
  // Example email content:
  /*
  const emailContent = {
    to: userEmail,
    subject: 'Payment Confirmation - One Dream Initiative',
    html: `
      <h2>Payment Confirmed!</h2>
      <p>Thank you for your ${paymentData.amount} contribution to the One Dream Initiative.</p>
      <p>You've been awarded ${calcVotesFromAmount(paymentData.amount)} votes!</p>
      <p>Keep sharing your referral link to earn more votes.</p>
    `
  };
  */
}

// Example usage for testing the webhook locally:
/*
POST /api/onedream/paymentWebhook?provider=mock
Content-Type: application/json

{
  "userId": "user-uuid-here",
  "amount": 10.00,
  "paymentId": "mock_payment_123"
}
*/