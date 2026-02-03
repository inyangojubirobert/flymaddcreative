// Initialize crypto payment - returns wallet address for THIS transaction only
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { participant_id, vote_count, network } = req.body;

    // Validate inputs
    if (!participant_id || !vote_count || !network) {
      return res.status(400).json({ 
        error: 'Missing required fields: participant_id, vote_count, network' 
      });
    }

    if (vote_count <= 0 || isNaN(vote_count)) {
      return res.status(400).json({ message: 'Invalid vote count' });
    }

    if (!['bsc', 'tron'].includes(network.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid network. Use "bsc" or "tron"' });
    }

    // Calculate amount (example: $1 per vote)
    const PRICE_PER_VOTE = 1; // USDT
    const amount = vote_count * PRICE_PER_VOTE;

    // Get recipient address based on network
    const recipientAddresses = {
      bsc: process.env.CRYPTO_WALLET_ADDRESS_BSC || '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
      tron: process.env.CRYPTO_WALLET_ADDRESS_TRON || 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL'
    };

    const recipient_address = recipientAddresses[network.toLowerCase()];

    // Generate payment reference (for tracking)
    const payment_reference = `PAY-${Date.now()}-${participant_id.slice(0, 8)}`;

    // TODO: Store pending payment in database
    // await db.payments.create({
    //     reference: payment_reference,
    //     participant_id,
    //     vote_count,
    //     amount,
    //     network,
    //     status: 'pending',
    //     created_at: new Date()
    // });

    console.log('[Crypto Payment] Initialized:', {
      payment_reference,
      participant_id,
      vote_count,
      amount,
      network,
      recipient_address
    });

    return res.status(200).json({
      success: true,
      amount,
      recipient_address,
      payment_reference,
      network: network.toUpperCase(),
      expires_at: Date.now() + (30 * 60 * 1000) // 30 minutes
    });

  } catch (error) {
    console.error('[Crypto Payment] Init error:', error);
    return res.status(500).json({ 
      message: 'Payment initialization failed',
      error: error.message 
    });
  }
}