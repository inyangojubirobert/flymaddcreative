/**
 * ONE DREAM INITIATIVE - VOTE MODULE
 * Vote.js: Handles UI, Supabase Data, and Paystack Payments Only.
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

    // ========================================
    // HANDLE VOTE / PAYSTACK PAYMENT ONLY
    // ========================================
    async function handleVote() {
        if (!window.selectedPaymentMethod) {
            alert('Please choose a payment method before proceeding.');
            return;
        }

        if (!isPaymentMethodAvailable(window.selectedPaymentMethod)) {
            alert('The selected payment method appears unavailable. Please choose another method.');
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

            // ⚡ ONLY PAYSTACK
            if (window.selectedPaymentMethod === 'paystack') {
                if (typeof window.processPaystackPayment !== 'function') {
                    throw new Error('Paystack payment module not loaded. Please refresh.');
                }
                paymentResult = await window.processPaystackPayment();
                if (paymentResult && paymentResult.redirect) return;
            } else {
                throw new Error('Selected payment method not available yet');
            }

            if (!paymentResult?.success) {
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
    function showParticipant() { /* same as original code */ }
    function showError(message) { /* same as original code */ }
    function initializeVoteSelection() { /* same as original code */ }
    function isPaymentMethodAvailable(method) {
        if (!method) return false;
        // ⚡ PAYSTACK ONLY
        return method === 'paystack' && (typeof window.processPaystackPayment === 'function' || typeof window.PaystackPop !== 'undefined');
    }
    function initializePaymentMethods() { /* same as original code */ }
    function updateUI() { /* same as original code */ }
    function showSuccessModal() { /* same as original code */ }
    function closeSuccessModal() { /* same as original code */ }

    // ========================================
    // GLOBAL EXPORTS (Window Scope)
    // ========================================
    window.closeSuccessModal = closeSuccessModal;

    console.log('✅ Vote.js (Paystack only) initialization logic exported.');
})();
