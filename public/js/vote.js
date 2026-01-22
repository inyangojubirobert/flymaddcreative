/**
 * ONE DREAM INITIATIVE - VOTE MODULE
 * Unified Script: Handles UI, Supabase Data, and Payment Orchestration.
 */
console.log('📦 Vote.js Loading...');

(function () {
    'use strict';

    // ========================================
    // GLOBAL STATE
    // ========================================
    window.currentParticipant = null;
    window.selectedVoteAmount = 1;
    window.selectedCost = 2.0;
    window.selectedPaymentMethod = '';

    // ========================================
    // PAGE INITIALIZATION
    // ========================================
    window.addEventListener('SupabaseReady', async () => {
        console.log('🎬 Supabase is ready. Initializing Vote page...');
        await initializePage();
    });

    document.addEventListener('DOMContentLoaded', async () => {
        if (window.__onedreamSupabase) await initializePage();
    });

    async function initializePage() {
        if (window.pageInitialized) return;
        window.pageInitialized = true;

        const params = new URLSearchParams(window.location.search);
        const username = params.get('user') || params.get('username');
        const userCode = params.get('code');

        if (!username && !userCode) {
            showError('To vote, search for the participant using their username or user code.');
            return;
        }

        try {
            window.currentParticipant = userCode
                ? await window.fetchParticipantByUserCode(userCode)
                : await window.fetchParticipantByUsername(username);

            if (!window.currentParticipant) {
                showError('Participant not found.');
                return;
            }

            showParticipant();
            initializeVoteSelection();
            console.log('✅ Page Initialization Complete');
        } catch (err) {
            console.error('Failed to load participant:', err);
            showError(`Failed to load participant: ${err.message}`);
        }
    }

    // ========================================
    // WALLET CONNECT / SDK LOADER
    // ========================================
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

        // Wait briefly for shared loader
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

        // Fallback: direct load
        try {
            return await window.loadWalletConnect?.() || null;
        } catch (err) {
            console.warn('Direct loadWalletConnect fallback failed:', err);
            return null;
        }
    }

    // ========================================
    // HANDLE VOTE / PAYMENT
    // ========================================
    async function handleVote() {
        if (!window.selectedPaymentMethod) {
            alert('Please choose a payment method before proceeding.');
            return;
        }

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
                const prov = await ensureSharedWalletLoader();
                if (!prov && !window.EthereumProvider) {
                    console.warn('WalletConnect initialization failed for selected crypto method.');
                    throw new Error('Wallet connection failed. Please choose another payment method or try again.');
                }
                if (typeof window.processCryptoPayment !== 'function') {
                    throw new Error('Crypto payment module not loaded. Please refresh.');
                }
                paymentResult = await window.processCryptoPayment();
            } else if (window.selectedPaymentMethod === 'paystack') {
                if (typeof window.processPaystackPayment !== 'function') {
                    throw new Error('Paystack payment module not loaded. Please refresh.');
                }
                paymentResult = await window.processPaystackPayment();
                if (paymentResult?.redirect) return; // handled by redirect
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
        } catch (err) {
            console.error('Vote processing failed:', err);
            alert(`Error: ${err.message}`);
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
        const res = await fetch('/api/onedream/vote', {
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

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to record votes');
        }

        const data = await res.json();
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
            const parts = (p.name || '').trim().split(/\s+/).filter(Boolean);
            initialsEl.textContent = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
        }

        const sharedGoal = (window.leadership?.goal) || (window.leadershipStats?.goal);
        const goal = Number(sharedGoal) || 1000000;
        const totalVotes = Number(p.total_votes) || 0;

        document.getElementById('currentVotes').textContent = totalVotes.toLocaleString();
        const votesRemaining = Math.max(goal - totalVotes, 0);
        const votesToGoalEl = document.getElementById('votesToGoal');
        if (votesToGoalEl) votesToGoalEl.textContent = votesRemaining.toLocaleString();

        const progress = Math.min((totalVotes / goal) * 100, 100);
        document.getElementById('progressPercentage')?.textContent = `${progress.toFixed(1)}%`;
        document.getElementById('progressBar')?.style.width = `${progress}%`;
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

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                customInput.value = '';
                btn.classList.add('active');
                window.selectedVoteAmount = parseInt(btn.dataset.amount);
                window.selectedCost = parseFloat(btn.dataset.cost);
                updateUI();
            });
        });

        customInput?.addEventListener('input', () => {
            buttons.forEach(b => b.classList.remove('active'));
            const amount = parseInt(customInput.value) || 1;
            window.selectedVoteAmount = amount;
            window.selectedCost = amount * 2.0;
            updateUI();
        });

        initializePaymentMethods();

        const voteBtn = document.getElementById('voteButton');
        voteBtn?.addEventListener('click', handleVote);
    }

    function isPaymentMethodAvailable(method) {
        if (!method) return false;
        if (method === 'paystack') return typeof window.processPaystackPayment === 'function' || typeof window.PaystackPop !== 'undefined';
        if (method === 'crypto') return typeof window.processCryptoPayment === 'function' || typeof window.EthereumProvider !== 'undefined' || typeof window.ethereum !== 'undefined';
        return false;
    }

    function initializePaymentMethods() {
        const buttons = document.querySelectorAll('.payment-method-btn');
        if (!buttons || buttons.length === 0) return;

        buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.method === window.selectedPaymentMethod));

        const voteBtn = document.getElementById('voteButton');
        if (voteBtn) voteBtn.disabled = !window.selectedPaymentMethod;

        if (initializePaymentMethods.__wired) return;
        document.addEventListener('click', e => {
            const btn = e.target.closest?.('.payment-method-btn');
            if (!btn) return;

            const method = btn.dataset.method || '';
            window.selectedPaymentMethod = method;

            buttons.forEach(b => b.classList.toggle('active', b === btn));
            if (voteBtn) voteBtn.disabled = false;

            console.log('Payment method selected:', method, 'available:', isPaymentMethodAvailable(method));
            if (!isPaymentMethodAvailable(method)) {
                window.appToast?.('Note: Selected payment method may be unavailable in this browser.', 4000);
            }
        });
        initializePaymentMethods.__wired = true;
    }

    function updateUI() {
        document.getElementById('totalCost')?.textContent = window.selectedCost.toFixed(2);
        const textEl = document.getElementById('voteButtonText');
        if (textEl) textEl.textContent = `Purchase ${window.selectedVoteAmount} Vote${window.selectedVoteAmount > 1 ? 's' : ''} - $${window.selectedCost.toFixed(2)}`;
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
    // GLOBAL EXPORTS
    // ========================================
    window.closeSuccessModal = closeSuccessModal;
    window.WALLETCONNECT_PROJECT_ID ||= '61d9b98f81731dffa9988c0422676fc5';

    console.log('✅ Vote.js initialization logic exported.');

})();
