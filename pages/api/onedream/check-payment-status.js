export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const { participant_id, network } = req.body;

        if (!participant_id || !network) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // TODO: Check database for completed payment
        // const payment = await db.payments.findFirst({
        //     where: {
        //         participant_id,
        //         network: network.toLowerCase(),
        //         status: 'completed',
        //         created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 min
        //     }
        // });

        // For now, return not completed (implement actual check)
        const payment = null;

        if (payment) {
            return res.status(200).json({
                completed: true,
                transaction_hash: payment.transaction_hash,
                amount: payment.amount,
                confirmed_at: payment.confirmed_at
            });
        }

        return res.status(200).json({
            completed: false
        });

    } catch (error) {
        console.error('[Payment Status] Error:', error);
        return res.status(500).json({ message: 'Status check failed' });
    }
}
