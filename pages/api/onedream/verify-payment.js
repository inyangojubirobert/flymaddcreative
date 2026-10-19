// Payment verification API for One Dream Initiative
// Handles verification for PayStack and Crypto payments
// Used to confirm payment status before recording votes

// Read-only: it never credits votes (that is /api/onedream/vote's job).

import { getUsdToNgnRate } from '../../../lib/currency';
import { verifyUsdtVote } from '../../../lib/voteCredits';
import { refuseRetiredVoting } from '../../../lib/paidVoting';

export default async function handler(req, res) {
  if (refuseRetiredVoting(res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      payment_intent_id, 
      payment_method, 
      reference // For PayStack
    } = req.body;

    // Get the reference to verify
    const refToVerify = reference || payment_intent_id;
    
    if (!refToVerify) {
      return res.status(400).json({ 
        error: 'Missing reference or payment_intent_id' 
      });
    }

    // Auto-detect payment method if not provided
    let detectedMethod = payment_method;
    if (!detectedMethod) {
      // Paystack references typically start with ODI_ or contain alphanumeric patterns
      if (refToVerify.startsWith('ODI_') || refToVerify.startsWith('paystack_') || /^[a-zA-Z0-9_]+$/.test(refToVerify)) {
        detectedMethod = 'paystack';
      } else if (refToVerify.startsWith('0x') || refToVerify.length === 64) {
        detectedMethod = 'crypto';
      } else {
        // Default to paystack for hosted checkout returns
        detectedMethod = 'paystack';
      }
    }

    let verificationResult = {};

    switch (detectedMethod) {
      case 'paystack':
        verificationResult = await verifyPaystackPayment(refToVerify);
        break;
      case 'crypto':
        verificationResult = await verifyCryptoPayment(refToVerify, req.body.network);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported payment method' });
    }

    return res.status(200).json(verificationResult);

  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({ 
      error: 'Payment verification failed',
      details: error.message 
    });
  }
}

// (Flutterwave integration removed)

// ✅ Verify PayStack Payment
async function verifyPaystackPayment(reference) {
  try {
    const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
    
    if (!paystackSecretKey) {
      throw new Error('PayStack not configured - missing PAYSTACK_SECRET_KEY');
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error('PayStack verification request failed');
    }

    const data = await response.json();

    if (data.status && data.data.status === 'success') {
      return {
        verified: true,
        status: 'succeeded',
        // USD amount: recorded with the charge, else converted at the rate it was charged at.
        amount: Number(data.data.metadata?.amount_usd)
          || (data.data.amount / 100) / (Number(data.data.metadata?.exchange_rate) || await getUsdToNgnRate()),
        currency: 'USD', // Prices are USD; NGN is only the Paystack charge currency
        metadata: data.data.metadata,
        provider: 'paystack',
        reference: data.data.reference
      };
    } else {
      return {
        verified: false,
        status: data.data?.status || 'failed',
        provider: 'paystack'
      };
    }

  } catch (error) {
    throw new Error(`PayStack verification failed: ${error.message}`);
  }
}

// ✅ Verify a USDT transfer on-chain (shared verifier, no crediting)
async function verifyCryptoPayment(txHash, network) {
  const result = await verifyUsdtVote(txHash, network, null);
  if (result.error) {
    return {
      verified: false,
      status: result.pending ? 'pending' : 'failed',
      provider: 'crypto',
      message: result.error
    };
  }
  return {
    verified: true,
    status: 'succeeded',
    amount: result.amountUsd,
    currency: 'USD',
    votes_available: result.voteCount,
    metadata: { network: result.network },
    provider: 'crypto'
  };
}
