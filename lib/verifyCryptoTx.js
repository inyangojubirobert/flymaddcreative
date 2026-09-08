// Shared on-chain USDT transfer verification for BSC (BEP-20) and Tron (TRC-20).
// Extracted out of pages/api/onedream/verify-usdt-payment.js so the same
// real verification logic backs both that endpoint and finalize-payment.js
// (which used to be a TODO stub that accepted any transaction hash matching
// a regex, with no chain check and no DB write at all).

import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import TronWeb from 'tronweb';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const VOTE_VALUE = 2; // $2 per vote - must match pages/api/onedream/vote.js

export const NETWORKS = {
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    usdtContract: '0x55d398326f99059fF775485246999027B3197955', // Binance-Peg USDT (BEP-20)
    recipientEnv: 'CRYPTO_WALLET_ADDRESS_BSC',
    requiredConfirmations: 3,
    decimals: 18
  },
  tron: {
    apiUrl: process.env.TRON_GRID_API || 'https://api.trongrid.io',
    apiKey: process.env.TRON_PRO_API_KEY,
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT (TRC-20)
    recipientEnv: 'CRYPTO_WALLET_ADDRESS_TRON',
    requiredConfirmations: 1,
    decimals: 6
  }
};

export async function verifyBSCTransaction(txHash) {
  try {
    const provider = new ethers.JsonRpcProvider(NETWORKS.bsc.rpcUrl);

    const tx = await provider.getTransaction(txHash);
    if (!tx) return { valid: false, error: 'Transaction not found' };

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) return { valid: false, error: 'Transaction receipt not found' };
    if (receipt.status !== 1) return { valid: false, error: 'Transaction failed on BSC' };

    const usdtInterface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    let transferEvent = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === NETWORKS.bsc.usdtContract.toLowerCase()) {
        try {
          const parsed = usdtInterface.parseLog(log);
          if (parsed.name === 'Transfer') {
            transferEvent = parsed;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!transferEvent) return { valid: false, error: 'No USDT transfer found in transaction' };

    const currentBlock = await provider.getBlockNumber();
    const confirmations = currentBlock - receipt.blockNumber;

    return {
      valid: true,
      from: transferEvent.args.from,
      to: transferEvent.args.to,
      amount: parseFloat(ethers.formatUnits(transferEvent.args.value, NETWORKS.bsc.decimals)),
      blockNumber: receipt.blockNumber,
      confirmations,
      status: receipt.status === 1 ? 'success' : 'failed'
    };
  } catch (error) {
    console.error('BSC verification error:', error);
    return { valid: false, error: error.message };
  }
}

export async function verifyTronTransaction(txHash) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (NETWORKS.tron.apiKey) headers['TRON-PRO-API-KEY'] = NETWORKS.tron.apiKey;

    const response = await fetch(`${NETWORKS.tron.apiUrl}/v1/transactions/${txHash}`, { headers });
    if (!response.ok) return { valid: false, error: 'Transaction not found on Tron network' };

    const data = await response.json();
    if (!data.ret || data.ret[0].contractRet !== 'SUCCESS') {
      return { valid: false, error: 'Transaction failed on Tron network' };
    }

    const contract = data.raw_data.contract[0];
    if (contract.type !== 'TriggerSmartContract') {
      return { valid: false, error: 'Not a smart contract transaction' };
    }

    const parameter = contract.parameter.value;
    const dataHex = parameter.data;
    if (!dataHex.startsWith('a9059cbb')) {
      return { valid: false, error: 'Not a transfer transaction' };
    }

    const toAddress = TronWeb.address.fromHex(`41${dataHex.substring(32, 72)}`);
    const amountHex = dataHex.substring(72);
    const amountWei = parseInt(amountHex, 16);
    const amount = amountWei / Math.pow(10, NETWORKS.tron.decimals);

    let confirmations = 1;
    const infoResponse = await fetch(`${NETWORKS.tron.apiUrl}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ value: txHash })
    });

    let blockNumber = 0;
    if (infoResponse.ok) {
      const info = await infoResponse.json();
      if (info.blockNumber) {
        blockNumber = info.blockNumber;
        const latestBlock = await fetch(`${NETWORKS.tron.apiUrl}/wallet/getnowblock`, { headers }).then(r => r.json());
        confirmations = latestBlock.block_header?.raw_data?.number
          ? latestBlock.block_header.raw_data.number - info.blockNumber
          : 1;
      }
    }

    return {
      valid: true,
      from: parameter.owner_address,
      to: toAddress,
      amount,
      blockNumber,
      confirmations,
      status: 'success'
    };
  } catch (error) {
    console.error('Tron verification error:', error);
    return { valid: false, error: error.message };
  }
}

/**
 * Full verify-and-persist flow shared by finalize-payment.js and
 * verify-usdt-payment.js: checks the transaction on-chain, confirms the
 * recipient is our wallet, and upserts the result into usdt_payments
 * (status 'pending' while under-confirmed, 'confirmed' once enough
 * confirmations exist). Returns the row that was written plus a `verified`
 * flag callers use to decide the HTTP status.
 */
export async function verifyAndRecordUsdtPayment({ txHash, network, userId = null }) {
  const net = network?.toLowerCase();
  if (!NETWORKS[net]) {
    return { verified: false, status: 400, error: 'Invalid network. Must be bsc or tron' };
  }

  const { data: existing } = await supabase
    .from('usdt_payments')
    .select('*')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existing?.status === 'confirmed') {
    if (existing.user_id && userId && existing.user_id !== userId) {
      return { verified: false, status: 409, error: 'Transaction is already assigned to another participant' };
    }
    return { verified: true, status: 200, payment: existing, alreadyProcessed: true };
  }

  if (existing?.user_id && userId && existing.user_id !== userId) {
    return { verified: false, status: 409, error: 'Transaction is already assigned to another participant' };
  }

  const txData = net === 'bsc' ? await verifyBSCTransaction(txHash) : await verifyTronTransaction(txHash);
  if (!txData.valid) {
    return { verified: false, status: 400, error: txData.error };
  }

  const expectedRecipient = process.env[NETWORKS[net].recipientEnv];
  if (!expectedRecipient || txData.to.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return { verified: false, status: 400, error: 'Transaction recipient does not match our wallet address' };
  }

  const voteCount = Math.floor(txData.amount / VOTE_VALUE);
  const confirmed = txData.confirmations >= NETWORKS[net].requiredConfirmations;

  const record = {
    network: net,
    tx_hash: txHash,
    amount: txData.amount,
    from_address: txData.from,
    to_address: txData.to,
    status: confirmed ? 'confirmed' : 'pending',
    block_number: txData.blockNumber,
    vote_count: voteCount,
    user_id: userId
  };
  if (confirmed) record.verified_at = new Date().toISOString();

  const { data: payment, error: upsertError } = await supabase
    .from('usdt_payments')
    .upsert(record, { onConflict: 'tx_hash', ignoreDuplicates: false })
    .select()
    .single();

  if (upsertError) {
    console.error('usdt_payments upsert error:', upsertError);
    return { verified: false, status: 500, error: 'Failed to record payment' };
  }

  if (!confirmed) {
    return {
      verified: false,
      status: 202,
      pending: true,
      confirmations: txData.confirmations,
      required: NETWORKS[net].requiredConfirmations,
      payment
    };
  }

  return { verified: true, status: 200, payment };
}
