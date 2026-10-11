// Verifies a USDT (BSC / Tron) vote payment on-chain and reports how many
// votes it covers. Does NOT credit votes - the client then calls
// /api/onedream/vote with the tx hash, which re-verifies and credits once.
// Uses the shared verifier (lib/verifyCryptoTx.js): recipient must be our
// wallet, token must be USDT, confirmations enforced.

import { VOTE_VALUE_USD, verifyUsdtVote } from '../../../lib/voteCredits';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { tx_hash, network, participant_id } = req.body || {};
    const txHash = typeof tx_hash === 'string' ? tx_hash.trim() : '';
    if (!txHash) {
      return res.status(400).json({ success: false, error: 'Missing tx_hash' });
    }

    const result = await verifyUsdtVote(txHash, network, participant_id || null);
    if (result.error) {
      return res.status(result.pending ? 202 : (result.status || 400)).json({
        success: false,
        pending: result.pending || false,
        confirmations: result.confirmations,
        required: result.required,
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      payment: { amount: result.amountUsd, vote_count: result.voteCount, network: result.network },
      votes_available: result.voteCount,
      vote_value: VOTE_VALUE_USD,
      explorer: result.network === 'bsc'
        ? `https://bscscan.com/tx/${txHash}`
        : `https://tronscan.org/#/transaction/${txHash}`,
    });
  } catch (error) {
    console.error('USDT verification error:', error);
    return res.status(500).json({ success: false, error: 'Payment verification failed' });
  }
}
