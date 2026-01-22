/**
 * ONE DREAM INITIATIVE – VOTE ORCHESTRATOR
 * Handles UI, participant loading, vote selection, and vote recording.
 * NO payment SDK logic here.
 */

console.log('📦 vote.js loaded');

(function () {
    'use strict';

    // ========================================
    // GLOBAL STATE (SINGLE SOURCE OF TRUTH)
    // ========================================
    window.currentParticipant = null;
    window.selectedVoteAmount = 1;
    window.selectedCost = 2.00;
    window.selectedPaymentMethod = '';

    let pageInitialized = false;

    // ========================================
    // INIT
    // ========================================
    window.addEventListener('SupabaseReady', initializePage);
    document.addEventListener('DOMContentLoaded', initializePage);

    async function initializePage() {
        if (pageInitialized || !window.__onedreamSupabase) return;
        pageInitialized = true;

        const params = new URLSearchParams(window.location.search);
        const username = params.get('username') || params.get('user');
        const code = params.get('code');

        if (!username && !code) {
            return showError('Please search for a participant to vote.');
        }

        try {
            window.currentParticipant = code
                ? await window.fetchParticipantByUserCode(code)
                : await window.fetchParticipantByUsername(username);

            if (!window.currentParticipant) {
                return showError('Participant not found.');
            }

            showParticipant();
            initializeVoteSelection();
            initializePaymentMethods();

        } catch (err) {
            console.error(err);
            showError('Failed to load participant.');
        }
    }

    // ========================================
    // MAIN VOTE HANDLER
    // ========================================
    async function handleVote() {
        if (!window.selectedPaymentMethod) {
            alert('Please select a payment method.');
            return;
        }

        const voteBtn = document.getElementById('voteButton');
        const spinner = document.getElementById('voteButtonSpinner');
        const text = document.getElementById('voteButtonText');

        voteBtn.disabled = true;
        spinner.classList.remove('hidden');
        text.textContent = 'Processing payment...';

        try {
            if (typeof window.processVotePayment !== 'function') {
                throw new Error('Payment router not loaded');
            }

            const paymentResult = await window.processVotePayment();
            if (paymentResult?.redirect) return;

            if (!paymentResult?.success) {
                throw new Error('Payment failed');
            }

            await recordVotes(paymentResult);
            showSuccessModal();

        } catch (err) {
            alert(err.message || 'Payment failed');
            console.error(err);
        } finally {
            voteBtn.disabled = false;
            spinner.classList.add('hidden');
            updateUI();
        }
    }

    // ========================================
    // BACKEND RECORD
    // ========================================
    async function recordVotes(payment) {
        const res = await fetch('/api/onedream/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: window.currentParticipant.id,
                vote_count: window.selectedVoteAmount,
                payment_amount: window.selectedCost,
                payment_method: payment.payment_method,
                payment_reference: payment.payment_reference
            })
        });

        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            throw new Error(e.error || 'Vote recording failed');
        }

        const data = await res.json();
        window.currentParticipant.total_votes = data.participant.total_votes;
        showParticipant();
    }

    // ========================================
    // UI HELPERS (KEEP YOUR EXISTING ONES)
    // ========================================
    function showParticipant() { /* unchanged */ }
    function showError(msg) { /* unchanged */ }
    function initializeVoteSelection() { /* unchanged */ }
    function initializePaymentMethods() { /* unchanged */ }
    function updateUI() { /* unchanged */ }
    function showSuccessModal() { /* unchanged */ }
    function closeSuccessModal() { /* unchanged */ }

    // ========================================
    // EXPORTS
    // ========================================
    window.handleVote = handleVote;
    window.closeSuccessModal = closeSuccessModal;

})();
