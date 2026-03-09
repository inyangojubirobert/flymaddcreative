import { ethers } from 'ethers';
import TronWeb from 'tronweb';
// ✅ This is correct (importing named export)
import { supabase } from '../../../src/backend/supabase';  // Changed from { supabase } to supabase

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { paymentId, txHash } = req.body;

    if (!paymentId || !txHash) {
        return res.status(400).json({ success: false, message: 'Missing paymentId or txHash' });
    }

    try {
        // Get the payment record
        const { data: payment, error: fetchError } = await supabase
            .from('crypto_votes')
            .select('*')
            .eq('id', paymentId)
            .single();

        if (fetchError || !payment) {
            console.error('Payment fetch error:', fetchError);
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Check if already confirmed
        if (payment.status === 'confirmed') {
            return res.json({ success: true, message: 'Already confirmed' });
        }

        let confirmed = false;

        // Verify based on network
        if (payment.network === 'bsc' || payment.network === 'ethereum' || payment.network === 'polygon') {
            try {
                const provider = new ethers.providers.JsonRpcProvider(
                    payment.network === 'bsc' ? process.env.BSC_RPC :
                    payment.network === 'polygon' ? process.env.POLYGON_RPC :
                    process.env.ETHEREUM_RPC
                );
                const receipt = await provider.getTransactionReceipt(txHash);
                confirmed = receipt?.status === 1;
                
                // Additional check for amount if needed
                if (confirmed && receipt) {
                    // You could add amount verification here
                    console.log('Transaction confirmed:', receipt.transactionHash);
                }
            } catch (error) {
                console.error('EVM verification error:', error);
            }
        }

        if (payment.network === 'tron') {
            try {
                const tron = new TronWeb({ 
                    fullHost: 'https://api.trongrid.io',
                    headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
                });
                const tx = await tron.trx.getTransaction(txHash);
                confirmed = tx?.ret?.[0]?.contractRet === 'SUCCESS';
                
                if (confirmed) {
                    console.log('TRON transaction confirmed:', txHash);
                }
            } catch (error) {
                console.error('TRON verification error:', error);
            }
        }

        if (!confirmed) {
            return res.json({ success: false, message: 'Transaction not confirmed' });
        }

        // Update the payment status
        const { error: updateError } = await supabase
            .from('crypto_votes')
            .update({ 
                status: 'confirmed', 
                confirmed_at: new Date().toISOString(), 
                tx_hash: txHash 
            })
            .eq('id', paymentId);

        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ success: false, message: 'Failed to update payment' });
        }

        // Increment votes for the participant
        const { error: rpcError } = await supabase
            .rpc('increment_votes', {
                pid: payment.participant_id,
                votes: payment.vote_count
            });

        if (rpcError) {
            console.error('RPC error:', rpcError);
            // Don't return error here - payment is already confirmed
            // Just log it for investigation
        }

        // Also create a record in the votes table if it exists
        try {
            await supabase
                .from('votes')
                .insert({
                    participant_id: payment.participant_id,
                    payment_id: paymentId,
                    payment_transaction_id: txHash,
                    vote_sequence: 1,
                    amount_paid: payment.expected_amount,
                    vote_value: payment.vote_count,
                    payment_method: `crypto_${payment.network}`,
                    is_validated: true
                });
        } catch (voteError) {
            console.error('Votes table insert error:', voteError);
            // This might fail if votes table doesn't exist or has different schema
            // It's non-critical if crypto_votes is the main table
        }

        res.json({ 
            success: true, 
            message: 'Payment confirmed successfully',
            data: {
                paymentId,
                participantId: payment.participant_id,
                votes: payment.vote_count
            }
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: error.message 
        });
    }
}