// Initialize crypto payment - returns wallet address for THIS transaction only
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { participant_id, vote_count, network } = req.body;

  if (!participant_id || !vote_count || !network) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!['bsc', 'tron'].includes(network)) {
    return res.status(400).json({ error: 'Invalid network. Must be bsc or tron' });
  }

  try {
    const amount = vote_count * 2; // $2 per vote

    // Create pending payment record
    const { data: payment, error: paymentError } = await supabase
      .from('crypto_payments')
      .insert({
        participant_id,
        vote_count,
        amount,
        network,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    // Return wallet address for THIS payment
    // Address comes from environment variables (backend only, never exposed to frontend)
    const walletAddress = network === 'bsc' 
      ? process.env.CRYPTO_WALLET_ADDRESS_BSC 
      : process.env.CRYPTO_WALLET_ADDRESS_TRON;

    if (!walletAddress) {
      throw new Error(`Wallet address not configured for ${network}`);
    }

    res.status(200).json({
      success: true,
      payment_id: payment.id,
      network,
      recipient_address: walletAddress,
      amount,
      vote_count,
      // Contract addresses (public information)
      contract_address: network === 'bsc'
        ? '0x55d398326f99059fF775485246999027B3197955' // BSC USDT
        : 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' // TRON USDT
    });

  } catch (error) {
    console.error('Init crypto payment error:', error);
    res.status(500).json({ 
      error: 'Failed to initialize payment',
      details: error.message 
    });
  }
}
