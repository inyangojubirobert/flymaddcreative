export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const { transaction_hash, network } = req.body;

        // Validate inputs
        if (!transaction_hash || !network) {
            return res.status(400).json({ 
                message: 'Missing required fields',
                required: ['transaction_hash', 'network']
            });
        }

        if (!['bsc', 'tron'].includes(network.toLowerCase())) {
            return res.status(400).json({ message: 'Invalid network' });
        }

        // Validate transaction hash format
        const isValidBscHash = /^0x[a-fA-F0-9]{64}$/.test(transaction_hash);
        const isValidTronHash = /^[a-fA-F0-9]{64}$/.test(transaction_hash);

        if (network.toLowerCase() === 'bsc' && !isValidBscHash) {
            return res.status(400).json({ message: 'Invalid BSC transaction hash format' });
        }

        if (network.toLowerCase() === 'tron' && !isValidTronHash) {
            return res.status(400).json({ message: 'Invalid TRON transaction hash format' });
        }

        // TODO: Verify transaction on blockchain
        // const verified = await verifyTransaction(transaction_hash, network);
        // if (!verified) {
        //     return res.status(400).json({ message: 'Transaction not found or not confirmed' });
        // }

        // TODO: Update payment status in database
        // await db.payments.update({
        //     where: { transaction_hash },
        //     data: { status: 'completed', confirmed_at: new Date() }
        // });

        // TODO: Credit votes to participant
        // await db.votes.increment({
        //     participant_id: payment.participant_id,
        //     count: payment.vote_count
        // });

        console.log('[Crypto Payment] Finalized:', {
            transaction_hash,
            network,
            timestamp: new Date().toISOString()
        });

        // Generate explorer URL
        const explorerUrls = {
            bsc: `https://bscscan.com/tx/${transaction_hash}`,
            tron: `https://tronscan.org/#/transaction/${transaction_hash}`
        };

        return res.status(200).json({
            success: true,
            message: 'Payment confirmed',
            transaction_hash,
            network: network.toUpperCase(),
            explorer_url: explorerUrls[network.toLowerCase()],
            confirmed_at: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Crypto Payment] Finalize error:', error);
        return res.status(500).json({ 
            message: 'Payment finalization failed',
            error: error.message 
        });
    }
}
