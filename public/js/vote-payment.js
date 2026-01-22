/**
 * ONE DREAM INITIATIVE – PAYMENT ROUTER
 * Routes vote payment to correct provider.
 */

console.log('🔀 vote-payments.js loaded');

async function processVotePayment() {
    switch (window.selectedPaymentMethod) {
        case 'paystack':
            if (typeof window.processPaystackPayment !== 'function') {
                throw new Error('Paystack not available');
            }
            return await window.processPaystackPayment();

        case 'crypto':
            if (typeof window.processCryptoPayment !== 'function') {
                throw new Error('Crypto not available');
            }
            return await window.processCryptoPayment();

        default:
            throw new Error('Invalid payment method');
    }
}

window.processVotePayment = processVotePayment;
