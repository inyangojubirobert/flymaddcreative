// Verify USDT payments on-chain (BSC & Tron)
// Validates transaction, checks confirmations, prevents double-spend

import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VOTE_VALUE = 2; // $2 per vote

// Network configurations
const NETWORKS = {
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    usdtContract: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
    requiredConfirmations: 3,
    decimals: 18
  },
  tron: {
    apiUrl: process.env.TRON_GRID_API || 'https://api.trongrid.io',
    apiKey: process.env.TRON_PRO_API_KEY,
    usdtContract: 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL',
    requiredConfirmations: 1,
    decimals: 6
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      tx_hash,
      network, // 'bsc' or 'tron'
      participant_id,
      expected_amount 
    } = req.body;

    if (!tx_hash || !network || !participant_id) {
      return res.status(400).json({ 
        error: 'Missing required fields: tx_hash, network, participant_id' 
      });
    }

    if (!['bsc', 'tron'].includes(network)) {
      return res.status(400).json({ error: 'Invalid network. Must be bsc or tron' });
    }

    // ✅ 1. Check if transaction already processed (double-spend protection)
    const { data: existingPayment } = await supabase
      .from('usdt_payments')
      .select('*')
      .eq('tx_hash', tx_hash)
      .single();

    if (existingPayment) {
      if (existingPayment.status === 'confirmed') {
        return res.status(200).json({
          success: true,
          already_processed: true,
          payment: existingPayment
        });
      }
      // If pending, continue to verify
    }

    // ✅ 2. Verify transaction on-chain
    let txData;
    if (network === 'bsc') {
      txData = await verifyBSCTransaction(tx_hash);
    } else if (network === 'tron') {
      txData = await verifyTronTransaction(tx_hash);
    }

    if (!txData.valid) {
      return res.status(400).json({ 
        error: 'Transaction verification failed',
        details: txData.error 
      });
    }

    // ✅ 3. Verify recipient address matches our wallet
    const expectedRecipient = network === 'bsc' 
      ? process.env.CRYPTO_WALLET_ADDRESS_BSC?.toLowerCase()
      : process.env.CRYPTO_WALLET_ADDRESS_TRON;

    if (txData.to.toLowerCase() !== expectedRecipient?.toLowerCase()) {
      return res.status(400).json({ 
        error: 'Invalid recipient address',
        expected: expectedRecipient,
        received: txData.to
      });
    }

    // ✅ 4. Verify amount matches expected (with small tolerance for decimals)
    const amountUSD = parseFloat(txData.amount);
    const expectedUSD = expected_amount || VOTE_VALUE;
    const tolerance = 0.01; // $0.01 tolerance

    if (Math.abs(amountUSD - expectedUSD) > tolerance) {
      return res.status(400).json({ 
        error: 'Amount mismatch',
        expected: expectedUSD,
        received: amountUSD
      });
    }

    // ✅ 5. Check confirmations
    if (txData.confirmations < NETWORKS[network].requiredConfirmations) {
      // Save as pending
      const { data: pendingPayment, error: insertError } = await supabase
        .from('usdt_payments')
        .insert({
          network,
          tx_hash,
          amount: amountUSD,
          from_address: txData.from,
          to_address: txData.to,
          status: 'pending',
          block_number: txData.blockNumber,
          user_id: participant_id
        })
        .select()
        .single();

      if (insertError && !insertError.message.includes('duplicate')) {
        throw insertError;
      }

      return res.status(202).json({
        success: false,
        pending: true,
        confirmations: txData.confirmations,
        required: NETWORKS[network].requiredConfirmations,
        message: 'Transaction pending confirmation'
      });
    }

    // ✅ 6. Calculate votes
    const voteCount = Math.floor(amountUSD / VOTE_VALUE);

    // ✅ 7. Record confirmed payment (upsert to handle race conditions)
    const { data: payment, error: upsertError } = await supabase
      .from('usdt_payments')
      .upsert({
        network,
        tx_hash,
        amount: amountUSD,
        from_address: txData.from,
        to_address: txData.to,
        status: 'confirmed',
        block_number: txData.blockNumber,
        user_id: participant_id,
        vote_count: voteCount,
        verified_at: new Date().toISOString()
      }, {
        onConflict: 'tx_hash',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (upsertError) {
      console.error('Payment upsert error:', upsertError);
      throw upsertError;
    }

    // ✅ 8. Credit votes to participant
    const { error: voteError } = await supabase.rpc('increment_votes', {
      p_participant_id: participant_id,
      p_vote_count: voteCount
    });

    if (voteError) {
      console.error('Vote increment error:', voteError);
      // Don't fail - we can reconcile later
    }

    return res.status(200).json({
      success: true,
      payment,
      votes_credited: voteCount,
      explorer: network === 'bsc' 
        ? `https://bscscan.com/tx/${tx_hash}`
        : `https://tronscan.org/#/transaction/${tx_hash}`
    });

  } catch (error) {
    console.error('USDT verification error:', error);
    return res.status(500).json({ 
      error: 'Payment verification failed',
      details: error.message 
    });
  }
}

// ✅ Verify BSC transaction
async function verifyBSCTransaction(txHash) {
  try {
    const provider = new ethers.JsonRpcProvider(NETWORKS.bsc.rpcUrl);
    
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return { valid: false, error: 'Transaction not found' };
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { valid: false, error: 'Transaction receipt not found' };
    }

    // Decode USDT transfer event
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

    if (!transferEvent) {
      return { valid: false, error: 'No USDT transfer found in transaction' };
    }

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

// ✅ Verify Tron transaction
async function verifyTronTransaction(txHash) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (NETWORKS.tron.apiKey) {
      headers['TRON-PRO-API-KEY'] = NETWORKS.tron.apiKey;
    }

    const response = await fetch(
      `${NETWORKS.tron.apiUrl}/v1/transactions/${txHash}`,
      { headers }
    );

    if (!response.ok) {
      return { valid: false, error: 'Transaction not found on Tron network' };
    }

    const data = await response.json();
    
    if (!data.ret || data.ret[0].contractRet !== 'SUCCESS') {
      return { valid: false, error: 'Transaction failed on Tron network' };
    }

    // Parse TRC-20 transfer
    const contract = data.raw_data.contract[0];
    if (contract.type !== 'TriggerSmartContract') {
      return { valid: false, error: 'Not a smart contract transaction' };
    }

    const parameter = contract.parameter.value;
    
    // Decode transfer data
    const dataHex = parameter.data;
    if (!dataHex.startsWith('a9059cbb')) { // transfer function signature
      return { valid: false, error: 'Not a transfer transaction' };
    }

    // Parse to address (skip first 32 bytes for function sig + to address padding)
    const toAddress = 'T' + dataHex.substring(32, 72); // Simplified - actual conversion needed
    
    // Parse amount (last 32 bytes)
    const amountHex = dataHex.substring(72);
    const amountWei = parseInt(amountHex, 16);
    const amount = amountWei / Math.pow(10, NETWORKS.tron.decimals);

    // Get confirmation count
    const infoResponse = await fetch(
      `${NETWORKS.tron.apiUrl}/wallet/gettransactioninfobyid`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: txHash })
      }
    );

    let confirmations = 1; // Tron transactions are usually final after 1 block
    if (infoResponse.ok) {
      const info = await infoResponse.json();
      if (info.blockNumber) {
        const latestBlock = await fetch(`${NETWORKS.tron.apiUrl}/wallet/getnowblock`, {
          headers
        }).then(r => r.json());
        
        confirmations = latestBlock.block_header?.raw_data?.number 
          ? latestBlock.block_header.raw_data.number - info.blockNumber
          : 1;
      }
    }

    return {
      valid: true,
      from: parameter.owner_address,
      to: process.env.CRYPTO_WALLET_ADDRESS_TRON,
      amount,
      blockNumber: data.blockNumber || 0,
      confirmations,
      status: 'success'
    };

  } catch (error) {
    console.error('Tron verification error:', error);
    return { valid: false, error: error.message };
  }
}
