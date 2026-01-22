// Ensure Paystack SDK and robust inline handling

async function ensurePaystack(timeout = 5000) {
    if (window.PaystackPop) return;
    if (window._paystackLoading) return window._paystackLoading;

    window._paystackLoading = new Promise((resolve, reject) => {
        const start = Date.now();
        (function waitForPaystack() {
            if (window.PaystackPop) return resolve();
            if (Date.now() - start > timeout) return reject(new Error('PaystackPop not available after wait'));
            setTimeout(waitForPaystack, 50);
        })();
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

        // Try to ensure Paystack inline SDK; fall back to redirect if blocked
        try {
            await ensurePaystack();
        } catch (e) {
            console.warn('Paystack inline SDK not available:', e);
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'Paystack SDK unavailable' };
        }

        if (typeof window.PaystackPop === 'undefined') {
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'PaystackPop not defined' };
        }

        const key = window.PAYSTACK_PUBLIC_KEY || data.public_key || '';
        const email = (window.currentUser && window.currentUser.email) || 'support@flymaddcreative.online';
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
                let handler = null;
                if (typeof window.PaystackPop.setup === 'function') {
                    handler = window.PaystackPop.setup(options);
                } else if (typeof window.PaystackPop === 'function') {
                    try { handler = new window.PaystackPop(options); } catch (e) { handler = window.PaystackPop(options); }
                } else if (typeof window.paystack !== 'undefined' && typeof window.paystack.setup === 'function') {
                    handler = window.paystack.setup(options);
                }

                if (handler && typeof handler.openIframe === 'function') {
                    try {
                        handler.openIframe();
                        // Note: Paystack's popup may log CSP warnings (from their domain). Those are harmless.
                        // If the inline popup fails to open or throws, we catch below and fallback to redirect.
                    } catch (popupErr) {
                        console.warn('Paystack inline popup failed to open (will fallback to redirect):', popupErr);
                        if (data.authorization_url) {
                            window.location.href = data.authorization_url;
                            resolve({ success: true, redirect: true, url: data.authorization_url });
                        } else {
                            resolve({ success: false, error: 'Paystack popup failed and no redirect available' });
                        }
                    }
                } else {
                    // fallback to redirect if available
                    if (data.authorization_url) {
                        window.location.href = data.authorization_url;
                        resolve({ success: true, redirect: true, url: data.authorization_url });
                    } else {
                        resolve({ success: false, error: 'Paystack handler unavailable' });
                    }
                }
            } catch (err) {
                console.error('Paystack inline error:', err);
                if (data.authorization_url) {
                    window.location.href = data.authorization_url;
                    resolve({ success: true, redirect: true, url: data.authorization_url });
                } else {
                    resolve({ success: false, error: err.message });
                }
            }
        });

    } catch (err) {
        console.error('Paystack payment error:', err);
        return { success: false, error: err.message };
    }
}

// Exports
window.ensurePaystack = ensurePaystack;
window.processPaystackPayment = processPaystackPayment;
