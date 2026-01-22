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
    // 🔑 CRITICAL FIX: wait for public config to load
    if (window.__publicConfigReady) {
        await window.__publicConfigReady;
    }

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
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                payment_method: 'paystack'
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('create-payment-intent failed:', err);
            throw new Error(err.error || 'Failed to initialize Paystack payment');
        }

        const data = await res.json();
        console.debug('Paystack init response:', data);

        // Prefer client config, fallback to server-provided key
        const configuredKey =
            (typeof window.PAYSTACK_PUBLIC_KEY === 'string' && window.PAYSTACK_PUBLIC_KEY.trim())
                ? window.PAYSTACK_PUBLIC_KEY.trim()
                : (typeof data.public_key === 'string' ? data.public_key.trim() : '');

        // Basic validation: Paystack public keys start with "pk_"
        const keyLooksValid =
            typeof configuredKey === 'string' &&
            configuredKey.length > 10 &&
            /^pk_/.test(configuredKey);

        if (!keyLooksValid) {
            console.error('Paystack public key missing or invalid:', configuredKey);

            const canRedirect =
                typeof data.authorization_url === 'string' &&
                data.authorization_url.startsWith('http');

            const userChoice = confirm(
                'Payment setup error: Paystack public key is missing or invalid.\n' +
                'The site can fall back to a secure external checkout page.\n\n' +
                'Do you want to proceed?'
            );

            if (userChoice && canRedirect) {
                console.info('Redirecting to Paystack hosted checkout');
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }

            return {
                success: false,
                error: 'Invalid Paystack public key; inline checkout unavailable'
            };
        }

        // Determine amount in kobo
        let amountKobo = null;

        if (typeof data.amount_kobo === 'number' && Number.isFinite(data.amount_kobo)) {
            amountKobo = data.amount_kobo;
        } else if (typeof data.amount === 'number' && Number.isFinite(data.amount)) {
            amountKobo = Math.round(data.amount * 100);
        } else if (typeof data.amount === 'string' && !isNaN(Number(data.amount))) {
            amountKobo = Math.round(Number(data.amount) * 100);
        }

        if (!amountKobo || amountKobo <= 0) {
            console.warn('Invalid amount from server:', data);
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'Invalid payment amount from server' };
        }

        // Ensure inline SDK exists
        try {
            await ensurePaystack();
        } catch (e) {
            console.warn('Paystack SDK unavailable:', e);
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'Paystack SDK unavailable' };
        }

        if (typeof window.PaystackPop === 'undefined') {
            console.warn('PaystackPop still undefined after ensurePaystack');
            if (data.authorization_url) {
                window.location.href = data.authorization_url;
                return { success: true, redirect: true, url: data.authorization_url };
            }
            return { success: false, error: 'PaystackPop not defined' };
        }

        const email =
            (window.currentUser && window.currentUser.email) ||
            'support@flymaddcreative.online';

        return await new Promise((resolve) => {
            const options = {
                key: configuredKey,
                email,
                amount: amountKobo,
                reference: data.reference || data.payment_intent_id,
                callback: (response) => {
                    resolve({
                        success: true,
                        payment_intent_id: response.reference,
                        raw: response,
                        redirect: false
                    });
                },
                onClose: () => {
                    resolve({
                        success: false,
                        error: 'User closed Paystack dialog',
                        redirect: false
                    });
                }
            };

            try {
                let handler = null;

                if (typeof window.PaystackPop.setup === 'function') {
                    handler = window.PaystackPop.setup(options);
                } else if (typeof window.PaystackPop === 'function') {
                    handler = new window.PaystackPop(options);
                }

                if (handler && typeof handler.openIframe === 'function') {
                    handler.openIframe();
                } else if (data.authorization_url) {
                    window.location.href = data.authorization_url;
                    resolve({ success: true, redirect: true, url: data.authorization_url });
                } else {
                    resolve({ success: false, error: 'Paystack handler unavailable' });
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

// Export for vote.js
window.ensurePaystack = ensurePaystack;
window.processPaystackPayment = processPaystackPayment;
