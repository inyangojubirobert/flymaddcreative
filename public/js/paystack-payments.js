// Wait for an existing Paystack inline script to expose PaystackPop.
// Do NOT fetch/import inline.js here; vote.html should load it with a <script> tag.
async function ensurePaystack(timeout = 5000) {
    if (typeof window === 'undefined') throw new Error('Browser environment required');
    if (window.PaystackPop) return;
    if (window._paystackLoading) return window._paystackLoading;

    window._paystackLoading = new Promise((resolve, reject) => {
        const start = Date.now();
        (function wait() {
            if (window.PaystackPop) return resolve();
            if (Date.now() - start > timeout) return reject(new Error('PaystackPop not available after wait'));
            setTimeout(wait, 50);
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
            console.error('create-payment-intent failed:', err);
            throw new Error(err.error || 'Failed to initialize Paystack payment');
        }

        const data = await res.json();
        console.debug('Paystack init response:', data);

        // Validate returned data (amount presence)
        // Prefer a server-provided kobo value (amount_kobo) if available
        let amountKobo = null;
        if (typeof data.amount_kobo === 'number') amountKobo = data.amount_kobo;
        else if (typeof data.amount === 'number') {
            // If server returns an integer assumed to be NGN, convert to kobo
            amountKobo = Math.round(data.amount * 100);
        } else {
            // unable to determine amount reliably
            console.warn('Paystack init response missing amount; falling back to server redirect if available');
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'Invalid payment amount from server' };
        }

        if (amountKobo <= 0) {
            console.warn('Invalid amountKobo:', amountKobo);
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'Invalid payment amount' };
        }

        // Ensure PaystackPop available
        try {
            await ensurePaystack();
        } catch (e) {
            console.warn('Paystack inline SDK not available or blocked:', e);
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

        return await new Promise((resolve) => {
            const options = {
                key,
                email,
                amount: amountKobo,
                reference: data.reference || data.payment_intent_id,
                callback: function (response) {
                    resolve({ success: true, payment_intent_id: response.reference, raw: response, redirect: false });
                },
                onClose: function () {
                    resolve({ success: false, error: 'User closed Paystack dialog', redirect: false });
                }
            };

            try {
                let handler = null;
                if (typeof window.PaystackPop.setup === 'function') {
                    handler = window.PaystackPop.setup(options);
                } else if (typeof window.PaystackPop === 'function') {
                    try { handler = new window.PaystackPop(options); } catch (e) { handler = window.PaystackPop(options); }
                }

                if (handler && typeof handler.openIframe === 'function') {
                    try {
                        handler.openIframe();
                    } catch (popupErr) {
                        console.warn('Paystack inline popup failed to open (fallback):', popupErr);
                        if (data.authorization_url) {
                            window.location.href = data.authorization_url;
                            resolve({ success: true, redirect: true, url: data.authorization_url });
                        } else {
                            resolve({ success: false, error: 'Paystack popup failed and no redirect available' });
                        }
                    }
                } else {
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
        return { success: false, error: err.message || 'Unknown Paystack error' };
    }
}

// Export to window for vote.js to call
window.ensurePaystack = ensurePaystack;
window.processPaystackPayment = processPaystackPayment;
