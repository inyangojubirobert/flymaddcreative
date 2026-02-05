// Payment verification API for One Dream Initiative
// Handles verification for PayStack and Crypto payments
// Used to confirm payment status before recording votes

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
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
        verificationResult = await verifyCryptoPayment(refToVerify);
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
        amount: data.data.amount / 100 / 1600, // Convert from kobo to NGN to USD
        currency: 'USD', // Return as USD for consistency
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

// ✅ Verify Crypto Payment (Simplified - in production, use blockchain APIs)
async function verifyCryptoPayment(paymentReference) {
  try {
    // In production, you would:
    // 1. Check blockchain explorers (blockchain.info, etherscan.io)
    // 2. Use crypto payment processor APIs (Coinbase Commerce, BitPay)
    // 3. Monitor wallet addresses for incoming transactions
    
    // For now, we'll simulate verification
    // In reality, this would check the actual blockchain
    
    // Check if this is a valid payment reference format
    if (!paymentReference || !paymentReference.startsWith('CRYPTO_ODI_')) {
      return {
        verified: false,
        status: 'invalid_reference',
        provider: 'crypto'
      };
    }

    // Simulate blockchain verification (replace with real implementation)
    const isConfirmed = await simulateCryptoVerification(paymentReference);

    if (isConfirmed) {
      return {
        verified: true,
        status: 'succeeded',
        amount: 0, // Would be calculated from actual transaction
        currency: 'BTC', // Or whatever crypto was used
        metadata: {
          crypto_reference: paymentReference,
          confirmations: 3 // Simulated confirmation count
        },
        provider: 'crypto'
      };
    } else {
      return {
        verified: false,
        status: 'pending',
        provider: 'crypto',
        message: 'Transaction not yet confirmed on blockchain'
      };
    }

  } catch (error) {
    throw new Error(`Crypto verification failed: ${error.message}`);
  }
}

// 🔄 Simulate crypto verification (replace with real blockchain API calls)
async function simulateCryptoVerification(paymentReference) {
  // In production, replace this with actual blockchain verification:
  
  // For Bitcoin:
  // const response = await fetch(`https://blockstream.info/api/tx/${txHash}`);
  
  // For Ethereum:
  // const response = await fetch(`https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}`);
  
  // For now, simulate a 30-second confirmation delay
  const timestamp = parseInt(paymentReference.split('_')[2]);
  const timeElapsed = Date.now() - timestamp;
  
  // Simulate that crypto payments are confirmed after 30 seconds
  return timeElapsed > 30000;
}