// Paystack SDK loader + payment flow (inline + redirect fallback)

async function ensurePaystack() {
    if (window.PaystackPop) return;
    if (window._paystackLoading) return window._paystackLoading;

    window._paystackLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.paystack.co/v1/inline.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Paystack SDK'));
        document.head.appendChild(s);
    });

    return window._paystackLoading;
}

async function processPaystackPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Missing participant info or vote amount.');
        return { success: false, error: 'Missing metadata' };
    }

    try {
        const res = await fetch('/api/onedream/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, payment_method: 'paystack' })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to initialize Paystack payment');
        }

        const data = await res.json();

        // Ensure Paystack SDK present before inline flow
        try { await ensurePaystack(); } catch (e) { console.warn('Paystack SDK failed to load:', e); }

        // If Paystack inline SDK is available, use it (return Promise resolved on callback)
        if (window.PaystackPop) {
            const key = window.PAYSTACK_PUBLIC_KEY || data.public_key || '';
            const email = (window.currentUser && window.currentUser.email) || 'support@flymaddcreative.online';
            // amount: server returns USD; replicate your server conversion if needed
            const amountKobo = Math.round((data.amount || 0) * 100 * 1600);

            return await new Promise((resolve) => {
                const options = {
                    key,
                    email,
                    amount: amountKobo,
                    reference: data.reference || data.payment_intent_id,
                    callback: function(response) {
                        resolve({ success: true, payment_intent_id: response.reference, raw: response, redirect: false });
                    },
                    onClose: function() {
                        resolve({ success: false, error: 'User closed Paystack dialog', redirect: false });
                    }
                };

                try {
                    // Paystack exposes setup as a function or constructor in some environments
                    const handler = (typeof PaystackPop === 'function' && PaystackPop.setup) ? PaystackPop.setup(options) : PaystackPop && PaystackPop(options);
                    if (handler && typeof handler.openIframe === 'function') handler.openIframe();
                    else {
                        if (data.authorization_url) {
                            window.location.href = data.authorization_url;
                            resolve({ success: true, redirect: true, url: data.authorization_url });
                        } else {
                            resolve({ success: false, error: 'Paystack handler unavailable' });
                        }
                    }
                } catch (err) {
                    console.error('Paystack inline error:', err);
                    resolve({ success: false, error: err.message });
                }
            });
        }

        // Fallback: redirect to authorization_url
        if (data.authorization_url) {
            window.location.href = data.authorization_url;
            return { success: true, redirect: true, url: data.authorization_url };
        }

        return { success: false, error: 'No Paystack flow available' };
    } catch (err) {
        console.error('Paystack payment error:', err);
        return { success: false, error: err.message };
    }
}

// Exports
window.ensurePaystack = ensurePaystack;
window.processPaystackPayment = processPaystackPayment;
