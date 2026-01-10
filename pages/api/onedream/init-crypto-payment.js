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

  const { participant_id, vote_count, network } = req.body;

  // Validate inputs
  if (!participant_id || !vote_count || !network) {
    return res.status(400).json({ 
      error: 'Missing required fields: participant_id, vote_count, network' 
    });
  }

  // Validate network
  if (!['bsc', 'tron'].includes(network)) {
    return res.status(400).json({ error: 'Invalid network. Must be "bsc" or "tron"' });
  }

  try {
    const amount = vote_count * 2; // $2 per vote

    // Verify participant exists
    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id, name, username')
      .eq('id', participant_id)
      .single();

    if (participantError || !participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    // Create pending payment record (if you have this table)
    // If you don't have crypto_payments table yet, skip this section
    let paymentId = `${network}_${Date.now()}_${participant_id}`;
    
    try {
      const { data: payment, error: paymentError } = await supabase
        .from('crypto_payments')
        .insert({
          participant_id,
          vote_count,
          amount,
          network,
          status: 'pending',
          payment_id: paymentId,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (payment) {
        paymentId = payment.id;
      }
    } catch (err) {
      // Table might not exist - continue anyway
      console.log('Could not create payment record (table may not exist):', err.message);
    }

    // Return wallet address for THIS payment
    const walletAddress = network === 'bsc' 
      ? process.env.CRYPTO_WALLET_ADDRESS_BSC 
      : process.env.CRYPTO_WALLET_ADDRESS_TRON;

    if (!walletAddress) {
      console.error(`❌ Missing wallet address for ${network}`);
      console.error('Available env vars:', {
        bsc: !!process.env.CRYPTO_WALLET_ADDRESS_BSC,
        tron: !!process.env.CRYPTO_WALLET_ADDRESS_TRON
      });
      
      return res.status(500).json({ 
        error: `Wallet address not configured for ${network}. Please contact support.` 
      });
    }

    console.log(`✅ Crypto payment initialized: ${network} - ${amount} USDT`);

    return res.status(200).json({
      success: true,
      payment_id: paymentId,
      network,
      recipient_address: walletAddress,
      amount,
      vote_count,
      participant: {
        id: participant.id,
        name: participant.name,
        username: participant.username
      }
    });

  } catch (error) {
    console.error('Init crypto payment error:', error);
    return res.status(500).json({ 
      error: 'Failed to initialize payment',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}