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
    window.selectedPaymentMethod = 'crypto'; // Default

    // ========================================
    // PAGE INITIALIZATION (THE FIX)
    // ========================================
    
    // We listen for the custom 'SupabaseReady' event from our config script
    window.addEventListener('SupabaseReady', async function () {
        console.log('🎬 Supabase is ready. Initializing Vote page...');
        await initializePage();
    });

    // Fallback: If Supabase takes too long, try DOMContentLoaded
    document.addEventListener('DOMContentLoaded', async function () {
        if (window.__onedreamSupabase) {
            await initializePage();
        }
    });

    async function initializePage() {
        // Prevent double-initialization
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
            // Use the globally exported fetch functions from supabase-config.js
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

    // --- NEW: small helper to wait for a condition (used to wait for shared loader)
    async function waitFor(predicate, timeout = 3000, interval = 100) {
        const start = Date.now();
        while (!predicate()) {
            if (Date.now() - start > timeout) throw new Error('Timed out waiting for condition');
            await new Promise(r => setTimeout(r, interval));
        }
    }

    // ========================================
    // HANDLE VOTE / PAYMENT (CLEANED & MERGED)
    // ========================================
    async function handleVote() {
        if (window.selectedPaymentMethod === 'crypto' && typeof window.processCryptoPayment !== 'function') {
            alert("Payment system is still loading. Please wait 2 seconds and try again.");
            return;
        }
        
        if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
            alert('Please select a valid vote amount');
            return;
        }

        const voteButton = document.getElementById('voteButton');
        const spinner = document.getElementById('voteButtonSpinner');
        const buttonText = document.getElementById('voteButtonText');

        // UI State: Loading
        voteButton.disabled = true;
        spinner.classList.remove('hidden');
        const originalText = buttonText.textContent;
        buttonText.textContent = 'Preparing Secure Payment...';

        try {
            let paymentResult;

            if (window.selectedPaymentMethod === 'crypto') {
                // Use the shared loader exposed by crypto-payments.js (avoid re-loading SDK here)
                try {
                    if (typeof window.loadWalletConnect === 'function') {
                        await window.loadWalletConnect();
                    } else {
                        // wait briefly for the global loader to be defined (e.g. other script is still initializing)
                        await waitFor(() => typeof window.loadWalletConnect === 'function', 2500);
                        await window.loadWalletConnect();
                    }
                } catch (loaderErr) {
                    console.warn('WalletConnect loader unavailable:', loaderErr);
                    throw new Error('Payment system initialization failed. Please refresh the page.');
                }

                if (typeof window.processCryptoPayment !== 'function') {
                    throw new Error('Crypto payment module not loaded. Please refresh.');
                }
                
                paymentResult = await window.processCryptoPayment();
            } else {
                throw new Error('Selected payment method not available yet');
            }

            // Validate Result
            if (!paymentResult?.success) {
                if (paymentResult?.error?.includes('rejected')) return; 
                throw new Error(paymentResult?.error || 'Payment failed');
            }

            // UI State: Recording
            buttonText.textContent = 'Finalizing Votes...';
            await recordVotesAfterPayment(paymentResult);
            
            // UI State: Success
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
            const err = await response.json();
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

        // Basic fields
        document.getElementById('participantName').textContent = p.name || p.display_name || 'Unnamed';
        document.getElementById('participantUsername').textContent = p.username || p.handle || 'unknown';
        document.getElementById('participantEmail').textContent = p.email || p.contact || '';

        // Initials for avatar
        const initialsEl = document.getElementById('participantInitials');
        if (initialsEl) {
            const nameParts = (p.name || '').trim().split(/\s+/).filter(Boolean);
            const initials = (nameParts[0]?.[0] || '') + (nameParts[1]?.[0] || '');
            initialsEl.textContent = initials.toUpperCase() || '?';
        }

        // Determine goal: prefer shared leadership value if present, otherwise fallback
        const sharedGoal = (window.leadership && window.leadership.goal) || (window.leadershipStats && window.leadershipStats.goal);
        const goal = Number(sharedGoal) || 1000000;

        // Dynamic stats
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
        document.getElementById('errorMessage').textContent = message;
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

    function initializePaymentMethods() {
        const buttons = document.querySelectorAll('.payment-method-btn');
        buttons.forEach(button => {
            button.addEventListener('click', function () {
                buttons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');
                window.selectedPaymentMethod = this.dataset.method;
                updateUI();
            });
        });
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