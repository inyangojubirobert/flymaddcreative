// Confirms a website crypto vote transfer on-chain (shared verifier in
// lib/verifyCryptoTx.js). Verification only - public/js/vote.js then calls
// /api/onedream/vote with the tx hash, which credits the votes once.

import { verifyUsdtVote } from '../../../lib/voteCredits';
import { refuseRetiredVoting } from '../../../lib/paidVoting';

export default async function handler(req, res) {
  if (refuseRetiredVoting(res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { transaction_hash, network } = req.body || {};
    const txHash = typeof transaction_hash === 'string' ? transaction_hash.trim() : '';
    if (!txHash || !network) {
      return res.status(400).json({ message: 'Missing required fields', required: ['transaction_hash', 'network'] });
    }

    const result = await verifyUsdtVote(txHash, network, null);
    const explorerUrl = String(network).toLowerCase() === 'bsc'
      ? `https://bscscan.com/tx/${txHash}`
      : `https://tronscan.org/#/transaction/${txHash}`;

    if (result.error && !result.pending) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }

    // Still confirming is not a failure: vote.js will be retried until it confirms.
    return res.status(200).json({
      success: true,
      pending: !!result.pending,
      message: result.pending ? 'Transaction submitted - waiting for confirmations' : 'Payment confirmed',
      transaction_hash: txHash,
      network: String(network).toUpperCase(),
      explorer_url: explorerUrl,
      votes_available: result.voteCount || 0,
      confirmed_at: result.pending ? null : new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Crypto Payment] Finalize error:', error);
    return res.status(500).json({ message: 'Payment finalization failed' });
  }
}
