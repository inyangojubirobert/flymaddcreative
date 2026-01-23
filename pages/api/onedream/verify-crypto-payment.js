import { ethers } from 'ethers';
import TronWeb from 'tronweb';
import { supabase } from '../../../src/backend/supabase';



export default async function handler(req, res) {
    const { paymentId, txHash } = req.body;

    const { data: payment } = await supabase
        .from('crypto_votes')
        .select('*')
        .eq('id', paymentId)
        .single();

    if (!payment) return res.status(404).json({ success: false });

    let confirmed = false;

    if (payment.network === 'bsc') {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC);
        const receipt = await provider.getTransactionReceipt(txHash);
        confirmed = receipt?.status === 1;
    }

    if (payment.network === 'tron') {
        const tron = new TronWeb({ fullHost: 'https://api.trongrid.io' });
        const tx = await tron.trx.getTransaction(txHash);
        confirmed = tx?.ret?.[0]?.contractRet === 'SUCCESS';
    }

    if (!confirmed) return res.json({ success: false });

    await supabase
        .from('crypto_votes')
        .update({ status: 'confirmed', confirmed_at: new Date(), tx_hash: txHash })
        .eq('id', paymentId);

    await supabase.rpc('increment_votes', {
        pid: payment.participant_id,
        votes: payment.vote_count
    });

    res.json({ success: true });
}
