/**
 * ONE DREAM INITIATIVE - PAYSTACK INTEGRATION
 * Handles Inline Checkout and Hosted Fallback.
 */

async function processPaystackPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        console.error('[Paystack] Missing participant or vote amount');
        return { success: false, error: 'Missing participant metadata' };
    }

    try {
        console.log('[Paystack] Creating payment intent...', { participantId, voteCount });
        
        // Create Payment Intent on Server
        const res = await fetch('/api/onedream/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                payment_method: 'paystack'
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Server failed to initialize payment');
        }

        const data = await res.json();
        console.log('[Paystack] Payment intent created:', data);

        // Validate response has required fields
        const paymentReference = data.reference || data.payment_intent_id;
        if (!paymentReference) {
            console.error('[Paystack] API response missing reference:', data);
            throw new Error('Payment initialization failed - no reference received');
        }

        // Get payment amounts
        const paymentAmountUSD = data.amount || (voteCount * 2); // $2 per vote
        const amountKobo = data.amount_kobo || Math.round(paymentAmountUSD * 1600 * 100);

        // Try inline checkout first if PaystackPop is available
        const publicKey = (window.PAYSTACK_PUBLIC_KEY || data.public_key || '').trim();
        const isKeyValid = /^pk_(test|live)_/.test(publicKey);
        
        console.log('[Paystack] Payment setup:', { 
            reference: paymentReference, 
            amountKobo, 
            publicKeyValid: isKeyValid,
            hasPaystackPop: !!window.PaystackPop 
        });

        if (isKeyValid && window.PaystackPop) {
            console.log('[Paystack] Using inline checkout');
            
            return await new Promise((resolve) => {
                const handler = window.PaystackPop.setup({
                    key: publicKey,
                    email: window.currentUser?.email || 'voter@onedreaminitiative.com',
                    amount: amountKobo,
                    currency: 'NGN',
                    reference: paymentReference,
                    callback: (response) => {
                        console.log('✅ Paystack Payment Success:', response);
                        resolve({
                            success: true,
                            participant_id: participantId,
                            payment_amount: paymentAmountUSD,
                            payment_intent_id: response.reference || paymentReference,
                            txHash: response.transaction,
                            vote_count: voteCount
                        });
                    },
                    onClose: () => {
                        console.log('[Paystack] User closed payment window');
                        resolve({ success: false, cancelled: true });
                    }
                });
                handler.openIframe();
            });
        }

        // Fallback to hosted checkout
        console.log('[Paystack] Falling back to hosted checkout');
        if (data.authorization_url) {
            // Store payment info for verification on return
            sessionStorage.setItem('pending_paystack_payment', JSON.stringify({
                participant_id: participantId,
                payment_amount: paymentAmountUSD,
                payment_intent_id: paymentReference,
                vote_count: voteCount
            }));
            window.location.href = data.authorization_url;
            return { success: true, redirect: true };
        }

        throw new Error('No payment method available');

    } catch (err) {
        console.error('❌ Paystack Error:', err);
        return { success: false, error: err.message };
    }
}

// Global Export
window.processPaystackPayment = processPaystackPayment;