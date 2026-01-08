#!/usr/bin/env node
// Manual reconciliation script for pending USDT payments
// Run: node scripts/reconcile-usdt-payments.mjs

import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NETWORKS = {
  bsc: {
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    requiredConfirmations: 3
  },
  tron: {
    apiUrl: process.env.TRON_GRID_API || 'https://api.trongrid.io',
    apiKey: process.env.TRON_PRO_API_KEY,
    requiredConfirmations: 1
  }
};

async function reconcilePendingPayments() {
  console.log('🔄 Starting USDT payment reconciliation...\n');

  // Get all pending payments
  const { data: pendingPayments, error } = await supabase
    .from('usdt_payments')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching pending payments:', error);
    return;
  }

  if (!pendingPayments || pendingPayments.length === 0) {
    console.log('✅ No pending payments to reconcile');
    return;
  }

  console.log(`📋 Found ${pendingPayments.length} pending payment(s)\n`);

  for (const payment of pendingPayments) {
    console.log(`\n🔍 Checking payment ${payment.id}`);
    console.log(`   Network: ${payment.network}`);
    console.log(`   TX Hash: ${payment.tx_hash}`);
    console.log(`   Amount: $${payment.amount}`);

    try {
      let confirmations = 0;

      if (payment.network === 'bsc') {
        confirmations = await getBSCConfirmations(payment.tx_hash, payment.block_number);
      } else if (payment.network === 'tron') {
        confirmations = await getTronConfirmations(payment.tx_hash);
      }

      console.log(`   Confirmations: ${confirmations}/${NETWORKS[payment.network].requiredConfirmations}`);

      if (confirmations >= NETWORKS[payment.network].requiredConfirmations) {
        // Calculate votes
        const voteCount = Math.floor(payment.amount / 2);

        // Update payment status
        const { error: updateError } = await supabase
          .from('usdt_payments')
          .update({
            status: 'confirmed',
            vote_count: voteCount,
            verified_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        if (updateError) {
          console.error(`   ❌ Failed to update payment:`, updateError.message);
          continue;
        }

        // Credit votes
        if (payment.user_id) {
          const { error: voteError } = await supabase.rpc('increment_votes', {
            p_participant_id: payment.user_id,
            p_vote_count: voteCount
          });

          if (voteError) {
            console.error(`   ⚠️  Failed to credit votes:`, voteError.message);
          } else {
            console.log(`   ✅ Confirmed and credited ${voteCount} vote(s)`);
          }
        }
      } else {
        console.log(`   ⏳ Still pending confirmation`);
      }

    } catch (err) {
      console.error(`   ❌ Error processing payment:`, err.message);
    }
  }

  console.log('\n✅ Reconciliation complete\n');
}

async function getBSCConfirmations(txHash, recordedBlock) {
  try {
    const provider = new ethers.JsonRpcProvider(NETWORKS.bsc.rpcUrl);
    const currentBlock = await provider.getBlockNumber();
    
    if (recordedBlock) {
      return currentBlock - recordedBlock;
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    return receipt ? currentBlock - receipt.blockNumber : 0;

  } catch (error) {
    console.error('   ⚠️  BSC confirmation check error:', error.message);
    return 0;
  }
}

async function getTronConfirmations(txHash) {
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (NETWORKS.tron.apiKey) {
      headers['TRON-PRO-API-KEY'] = NETWORKS.tron.apiKey;
    }

    const infoResponse = await fetch(
      `${NETWORKS.tron.apiUrl}/wallet/gettransactioninfobyid`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: txHash })
      }
    );

    if (!infoResponse.ok) {
      return 0;
    }

    const info = await infoResponse.json();
    if (!info.blockNumber) {
      return 0;
    }

    const latestBlock = await fetch(`${NETWORKS.tron.apiUrl}/wallet/getnowblock`, {
      headers
    }).then(r => r.json());

    return latestBlock.block_header?.raw_data?.number 
      ? latestBlock.block_header.raw_data.number - info.blockNumber
      : 1;

  } catch (error) {
    console.error('   ⚠️  Tron confirmation check error:', error.message);
    return 0;
  }
}

// Run reconciliation
reconcilePendingPayments()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
