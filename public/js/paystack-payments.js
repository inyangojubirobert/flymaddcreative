/**
 * ONE DREAM INITIATIVE - PAYSTACK INTEGRATION
 * Handles Inline Checkout and Hosted Fallback.
 */

async function ensurePaystack(timeout = 8000) {
    if (typeof window === 'undefined') return;
    if (window.PaystackPop) return window.PaystackPop;
    if (window._paystackLoading) return window._paystackLoading;

    window._paystackLoading = new Promise((resolve, reject) => {
        const start = Date.now();
        const checkInterval = setInterval(() => {
            if (window.PaystackPop) {
                clearInterval(checkInterval);
                resolve(window.PaystackPop);
            } else if (Date.now() - start > timeout) {
                clearInterval(checkInterval);
                window._paystackLoading = null; // Allow retry on next click
                reject(new Error('Paystack SDK failed to load. Please check your internet connection.'));
            }
        }, 100);
    });

    return window._paystackLoading;
}

async function processPaystackPayment() {
    // 1. Wait for configuration
    if (window.__publicConfigReady) {
        await window.__publicConfigReady;
    }

    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        return { success: false, error: 'Missing participant metadata' };
    }

    try {
        // 2. Create Payment Intent on Server
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

        // 3. Resolve Public Key (Priority: Window Object -> Server Response)
        const publicKey = (window.PAYSTACK_PUBLIC_KEY || data.public_key || '').trim();
        const isKeyValid = /^pk_(test|live)_/.test(publicKey);

        // 4. Fallback to Hosted URL if Key is missing or Invalid
        if (!isKeyValid || !window.PaystackPop) {
            console.warn('Inline SDK unavailable or Key Invalid. Falling back to hosted checkout.');
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true };
            }
            throw new Error('Paystack configuration incomplete (Missing Public Key & Auth URL)');
        }

        // 5. Calculate Kobo (Paystack requires integers)
        // Fixed: Math.round prevents floating point errors like 198.9999999
        const amountKobo = data.amount_kobo || Math.round((data.amount || window.selectedCost) * 100);
        const paymentAmount = data.amount || window.selectedCost || (amountKobo / 100);

        // 6. Launch Inline Popup
        return await new Promise((resolve) => {
            const options = {
                key: publicKey,
                email: window.currentUser?.email || 'voter@onedreaminitiative.com',
                amount: amountKobo,
                currency: 'NGN', // Ensure this matches your Paystack settings
                reference: data.reference || data.payment_intent_id,
                callback: (response) => {
                    console.log('✅ Paystack Payment Success:', response);
                    resolve({
                        success: true,
                        participant_id: participantId,
                        payment_amount: paymentAmount,
                        payment_intent_id: response.reference,
                        txHash: response.transaction,
                        vote_count: voteCount,
                        redirect: false
                    });
                },
                onClose: () => {
                    resolve({ success: false, cancelled: true, error: 'Payment window closed by user' });
                }
            };

            const handler = window.PaystackPop.setup ? window.PaystackPop.setup(options) : new window.PaystackPop(options);
            
            if (handler && typeof handler.openIframe === 'function') {
                handler.openIframe();
            } else {
                // Last ditch effort: if inline fails to open, redirect
                if (data.authorization_url) {
                    // Store payment info for when user returns from redirect
                    sessionStorage.setItem('pending_paystack_payment', JSON.stringify({
                        participant_id: participantId,
                        payment_amount: paymentAmount,
                        payment_intent_id: data.reference || data.payment_intent_id,
                        vote_count: voteCount
                    }));
                    window.location.href = data.authorization_url;
                }
                resolve({ success: true, redirect: true, payment_intent_id: data.reference || data.payment_intent_id });
            }
        });

    } catch (err) {
        console.error('❌ Paystack Error:', err);
        return { success: false, error: err.message };
    }
}

// Global Exports
window.ensurePaystack = ensurePaystack;
window.processPaystackPayment = processPaystackPayment;