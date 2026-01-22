// vote-paystack.js
async function handlePaystackVote() {
    const result = await window.processPaystackPayment();

    if (!result?.success) {
        throw new Error(result?.error || 'Paystack payment failed');
    }

    return {
        success: true,
        payment_method: 'paystack',
        payment_intent_id: result.payment_intent_id || result.txHash
    };
}

window.handlePaystackVote = handlePaystackVote;
