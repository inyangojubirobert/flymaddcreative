/**
 * ONE DREAM INITIATIVE - VOTE MODULE
 * Unified Script: Handles UI, Supabase Data, and Payment Orchestration.
 */

console.log('📦 Vote.js Loading...');

(function () {
    'use strict';

    // ========================================
    // 0. DEFENSIVE BUFFER POLYFILL CHECK
    // ========================================
    try {
        if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined' && typeof buffer !== 'undefined') {
            window.Buffer = buffer.Buffer;
            console.log('✅ Buffer polyfill applied (vote.js)');
        }
    } catch (e) {
        console.warn('Buffer polyfill check failed:', e);
    }

    // ========================================
    // GLOBAL STATE
    // ========================================
    window.currentParticipant = null;
    window.selectedVoteAmount = 1;
    window.selectedCost = 2.0;
    // Do not pre-select a payment method — user must choose explicitly
    window.selectedPaymentMethod = '';

    // ========================================
    // PAGE INITIALIZATION
    // ========================================
    window.addEventListener('SupabaseReady', async function () {
        console.log('🎬 Supabase is ready. Initializing Vote page...');
        await initializePage();
    });

    document.addEventListener('DOMContentLoaded', async function () {
        if (window.__onedreamSupabase) {
            await initializePage();
        }
    });

    async function initializePage() {
        if (window.pageInitialized) return;
        window.pageInitialized = true;

        const urlParams = new URLSearchParams(window.location.search);
        const username = urlParams.get('user') || urlParams.get('username');
        const userCode = urlParams.get('code');

        if (!username && !userCode) {
            showError('To vote, search for the participant using their username or user code.');
            return;
        }

        try {
            if (userCode) {
                window.currentParticipant = await window.fetchParticipantByUserCode(userCode);
            } else {
                window.currentParticipant = await window.fetchParticipantByUsername(username);
            }

            if (!window.currentParticipant) {
                showError('Participant not found.');
                return;
            }

            showParticipant();
            initializeVoteSelection();
            console.log('✅ Page Initialization Complete');
        } catch (error) {
            console.error('Failed to load participant:', error);
            showError(`Failed to load participant: ${error.message}`);
        }
    }

    /* ======================================================
        SDK LOADER: Prefer shared loader, fallback to UMD injection
    ====================================================== */
    async function ensureSharedWalletLoader(timeout = 2500) {
        // Try shared loader first
        if (typeof window.loadWalletConnect === 'function') {
            try {
                const prov = await window.loadWalletConnect();
                return prov || null;
            } catch (e) {
                console.warn('Shared loadWalletConnect failed:', e);
            }
        }

        // Wait briefly for a shared loader to appear
        const start = Date.now();
        while (typeof window.loadWalletConnect !== 'function' && (Date.now() - start) < timeout) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (typeof window.loadWalletConnect === 'function') {
            try {
                const prov = await window.loadWalletConnect();
                return prov || null;
            } catch (e) {
                console.warn('Shared loadWalletConnect failed after wait:', e);
            }
        }

        // Fallback: ask crypto-payments to load directly
        try {
            const prov = await window.loadWalletConnect?.();
            return prov || null;
        } catch (err) {
            console.warn('Direct loadWalletConnect fallback failed:', err);
            return null;
        }
    }

    // ========================================
    // HANDLE VOTE / PAYMENT
    // ========================================
    async function handleVote() {
        // Validate user explicitly selected a payment method
        if (!window.selectedPaymentMethod) {
            alert('Please choose a payment method before proceeding.');
            return;
        }

        // Quick availability check
        if (!isPaymentMethodAvailable(window.selectedPaymentMethod)) {
            alert('The selected payment method appears unavailable in this browser. Please choose another method or try again later.');
            return;
        }

        if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
            alert('Please select a valid vote amount');
            return;
        }

        const voteButton = document.getElementById('voteButton');
        const spinner = document.getElementById('voteButtonSpinner');
        const buttonText = document.getElementById('voteButtonText');

        voteButton.disabled = true;
        spinner.classList.remove('hidden');
        const originalText = buttonText.textContent;
        buttonText.textContent = 'Preparing Secure Payment...';

        try {
            let paymentResult;

            if (window.selectedPaymentMethod === 'crypto') {
                // Try to ensure walletconnect/provider available
                const prov = await ensureSharedWalletLoader();
                if (!prov && !window.EthereumProvider) {
                    // WalletConnect initialization failed — instruct user to choose another payment method
                    console.warn('WalletConnect initialization failed for selected crypto method.');
                    throw new Error('Wallet connection failed. Please choose another payment method or try again.');
                } else {
                    if (typeof window.processCryptoPayment !== 'function') {
                        throw new Error('Crypto payment module not loaded. Please refresh.');
                    }
                    paymentResult = await window.processCryptoPayment();
                }
            } else if (window.selectedPaymentMethod === 'paystack') {
                if (typeof window.processPaystackPayment !== 'function') {
                    throw new Error('Paystack payment module not loaded. Please refresh.');
                }
                paymentResult = await window.processPaystackPayment();
                if (paymentResult && paymentResult.redirect) return;
            } else {
                throw new Error('Selected payment method not available yet');
            }

            if (!paymentResult?.success) {
                if (paymentResult?.error?.includes('rejected')) return;
                throw new Error(paymentResult?.error || 'Payment failed');
            }

            buttonText.textContent = 'Finalizing Votes...';
            await recordVotesAfterPayment(paymentResult);

            showSuccessModal();
        } catch (error) {
            console.error('Vote processing failed:', error);
            alert(`Error: ${error.message}`);
        } finally {
            voteButton.disabled = false;
            spinner.classList.add('hidden');
            buttonText.textContent = originalText;
            updateUI();
        }
    }

    // ========================================
    // RECORD VOTES AFTER PAYMENT
    // ========================================
    async function recordVotesAfterPayment(paymentResult) {
        const response = await fetch('/api/onedream/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: window.currentParticipant.id,
                vote_count: window.selectedVoteAmount,
                payment_amount: window.selectedCost,
                payment_method: window.selectedPaymentMethod,
                payment_intent_id: paymentResult.txHash || paymentResult.payment_intent_id,
                payment_status: 'completed',
                voter_info: { userAgent: navigator.userAgent }
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to record votes');
        }

        const data = await response.json();
        if (data.participant) {
            window.currentParticipant.total_votes = data.participant.total_votes;
            showParticipant();
        }
    }

    // ========================================
    // DISPLAY & UI HELPERS
    // ========================================
    function showParticipant() {
        if (!window.currentParticipant) return;
        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('participantCard').classList.remove('hidden');

        const p = window.currentParticipant;
        document.getElementById('participantName').textContent = p.name || p.display_name || 'Unnamed';
        document.getElementById('participantUsername').textContent = p.username || p.handle || 'unknown';
        document.getElementById('participantEmail').textContent = p.email || p.contact || '';

        const initialsEl = document.getElementById('participantInitials');
        if (initialsEl) {
            const nameParts = (p.name || '').trim().split(/\s+/).filter(Boolean);
            const initials = (nameParts[0]?.[0] || '') + (nameParts[1]?.[0] || '');
            initialsEl.textContent = (initials || '?').toUpperCase();
        }

        const sharedGoal = (window.leadership && window.leadership.goal) || (window.leadershipStats && window.leadershipStats.goal);
        const goal = Number(sharedGoal) || 1000000;

        const totalVotes = Number(p.total_votes) || 0;
        document.getElementById('currentVotes').textContent = totalVotes.toLocaleString();

        const votesRemaining = Math.max(goal - totalVotes, 0);
        const votesToGoalEl = document.getElementById('votesToGoal');
        if (votesToGoalEl) votesToGoalEl.textContent = votesRemaining.toLocaleString();

        const progress = Math.min((totalVotes / goal) * 100, 100);
        const progressPctEl = document.getElementById('progressPercentage');
        if (progressPctEl) progressPctEl.textContent = `${progress.toFixed(1)}%`;

        const progressBar = document.getElementById('progressBar');
        if (progressBar) progressBar.style.width = `${progress}%`;
    }

    function showError(message) {
        document.getElementById('loadingState').classList.add('hidden');
        const errEl = document.getElementById('errorMessage');
        if (errEl) errEl.textContent = message;
        document.getElementById('errorState').classList.remove('hidden');
    }

    function initializeVoteSelection() {
        const buttons = document.querySelectorAll('.vote-amount-btn');
        const customInput = document.getElementById('customVoteAmount');

        buttons.forEach(button => {
            button.addEventListener('click', function () {
                buttons.forEach(btn => btn.classList.remove('active'));
                customInput.value = '';
                this.classList.add('active');
                window.selectedVoteAmount = parseInt(this.dataset.amount);
                window.selectedCost = parseFloat(this.dataset.cost);
                updateUI();
            });
        });

        customInput.addEventListener('input', function () {
            buttons.forEach(btn => btn.classList.remove('active'));
            const amount = parseInt(this.value) || 1;
            window.selectedVoteAmount = amount;
            window.selectedCost = amount * 2.0;
            updateUI();
        });

        initializePaymentMethods();
        const voteBtn = document.getElementById('voteButton');
        if (voteBtn) voteBtn.addEventListener('click', handleVote);
    }

    // small helper: check if a payment method is ready (quick, best-effort)
    function isPaymentMethodAvailable(method) {
        if (!method) return false;
        if (method === 'paystack') return typeof window.processPaystackPayment === 'function' || typeof window.PaystackPop !== 'undefined';
        if (method === 'crypto') return typeof window.processCryptoPayment === 'function' || typeof window.EthereumProvider !== 'undefined' || typeof window.ethereum !== 'undefined';
        return false;
    }

    function initializePaymentMethods() {
        // Do not add click handlers here — main.js wires buttons to avoid duplicate listeners.
        // This function now only sets the initial active state based on current selection.
        const buttons = document.querySelectorAll('.payment-method-btn');
        if (!buttons || buttons.length === 0) return;
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.method === window.selectedPaymentMethod);
        });

        // Ensure Vote button disabled until user picks a method
        const voteBtn = document.getElementById('voteButton');
        if (voteBtn) voteBtn.disabled = !window.selectedPaymentMethod;

        // Listen for user choosing a payment method to enable the Vote button and log availability
        // This is minimal and does not duplicate the main.js handler responsibilities.
        if (!initializePaymentMethods.__wired) {
            document.addEventListener('click', (e) => {
                const btn = e.target.closest && e.target.closest('.payment-method-btn');
                if (!btn) return;
                const method = btn.dataset.method;
                // Sync global state (main.js also sets this)
                window.selectedPaymentMethod = method || '';
                // Visual (ensure active)
                buttons.forEach(b => b.classList.toggle('active', b === btn));
                // Enable vote button now that user explicitly chose a method
                if (voteBtn) voteBtn.disabled = false;
                // Log and provide quick feedback if method appears unavailable
                console.log('Payment method selected:', method, 'available:', isPaymentMethodAvailable(method));
                if (!isPaymentMethodAvailable(method)) {
                  // Friendly non-blocking notice so user knows why a later attempt might fail
                  window.appToast && window.appToast('Note: Selected payment method may be unavailable in this browser.', 4000);
                }
            });
            initializePaymentMethods.__wired = true;
        }
    }

    function updateUI() {
        const costEl = document.getElementById('totalCost');
        const textEl = document.getElementById('voteButtonText');
        if (costEl) costEl.textContent = window.selectedCost.toFixed(2);
        if (textEl) {
            textEl.textContent = `Purchase ${window.selectedVoteAmount} Vote${window.selectedVoteAmount > 1 ? 's' : ''} - $${window.selectedCost.toFixed(2)}`;
        }
    }

    function showSuccessModal() {
        document.getElementById('successParticipantName').textContent = window.currentParticipant.name;
        document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
        document.getElementById('successModal').classList.remove('hidden');
    }

    function closeSuccessModal() {
        document.getElementById('successModal').classList.add('hidden');
        updateUI();
    }

    // ========================================
    // GLOBAL EXPORTS (Window Scope)
    // ========================================
    window.closeSuccessModal = closeSuccessModal;
    window.WALLETCONNECT_PROJECT_ID = window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5';

    console.log('✅ Vote.js initialization logic exported.');

})();