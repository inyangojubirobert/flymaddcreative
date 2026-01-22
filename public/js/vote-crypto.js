// vote-crypto.js
async function handleCryptoVote() {
    const result = await window.processCryptoPayment();

    if (!result?.success) {
        throw new Error(result?.error || 'Crypto payment failed');
    }

    return {
        success: true,
        payment_method: 'crypto',
        payment_intent_id: result.txHash
    };
}

window.handleCryptoVote = handleCryptoVote;
