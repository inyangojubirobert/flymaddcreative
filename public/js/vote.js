/**
 * ONE DREAM INITIATIVE - VOTE MODULE
 * Unified Script: Handles UI, Supabase Data, and Payment Orchestration.
 */

console.log('📦 Vote.js Loading...');
 
// Ensure Node Buffer is available in browsers for libraries that expect it
async function ensureBufferPolyfill() {
    if (typeof window !== 'undefined' && typeof window.Buffer !== 'undefined') return;
    return new Promise((resolve) => {
        try {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js';
            s.onload = () => {
                try { window.Buffer = window.buffer?.Buffer || window.Buffer; } catch (e) {}
                resolve();
            };
            s.onerror = () => { console.warn('Buffer polyfill failed to load'); resolve(); };
            document.head.appendChild(s);
        } catch (e) { resolve(); }
    });
}

ensureBufferPolyfill().then(() => {
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

        /* ======================================================
            🚀 SDK LOADER: Fixes "Cannot read init of undefined"
        ====================================================== */
        async function loadWalletConnect() {
            if (window.EthereumProvider) return window.EthereumProvider;

            return new Promise((resolve, reject) => {
                console.log('⏳ Injecting WalletConnect SDK...');
                const script = document.createElement('script');
                script.src = "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
                script.onload = () => {
                    // Some UMD bundles set different globals — check common ones
                    setTimeout(() => {
                        const provider = window.EthereumProvider || window.WalletConnectProvider || window.WalletConnect || window.walletconnect || null;
                        if (provider) return resolve(provider);
                        return reject(new Error('WalletConnect loaded but provider global not found'));
                    }, 0);
                };
                script.onerror = () => reject(new Error("Failed to load WalletConnect library."));
                document.head.appendChild(script);
            });
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

            if (!voteButton || !spinner || !buttonText) {
                console.warn('Vote UI elements missing', { voteButton, spinner, buttonText });
                alert('UI not ready. Please refresh the page.');
                return;
            }

            // UI State: Loading
            voteButton.disabled = true;
            spinner.classList.remove('hidden');
            const originalText = buttonText.textContent || '';
            buttonText.textContent = 'Preparing Secure Payment...';

            try {
                let paymentResult;

                if (window.selectedPaymentMethod === 'crypto') {
                    // Ensure SDK is ready
                    await loadWalletConnect();
                    
                    if (typeof window.processCryptoPayment !== 'function') {
                        throw new Error('Crypto payment module not loaded. Please refresh.');
                    }
                    
                    paymentResult = await window.processCryptoPayment();
                } else if (window.selectedPaymentMethod === 'paystack') {
                    if (typeof window.processPaystackPayment !== 'function') {
                        throw new Error('Paystack payment module not loaded. Please refresh.');
                    }
                    paymentResult = await window.processPaystackPayment();
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
                try { if (voteButton) voteButton.disabled = false; } catch (e) {}
                try { if (spinner) spinner.classList.add('hidden'); } catch (e) {}
                try { if (buttonText) buttonText.textContent = originalText; } catch (e) {}
                try { updateUI(); } catch (e) {}
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
            const loadingState = document.getElementById('loadingState');
            const participantCard = document.getElementById('participantCard');
            if (loadingState) loadingState.classList.add('hidden');
            if (participantCard) participantCard.classList.remove('hidden');

            const p = window.currentParticipant;
            const nameEl = document.getElementById('participantName');
            const usernameEl = document.getElementById('participantUsername');
            const votesEl = document.getElementById('currentVotes');
            if (nameEl) nameEl.textContent = p.name || '';
            if (usernameEl) usernameEl.textContent = p.username || '';
            if (votesEl) votesEl.textContent = (p.total_votes || 0).toLocaleString();
            
            const goal = 1000000;
            const progress = Math.min(((p.total_votes || 0) / goal) * 100, 100);
            const progressPerc = document.getElementById('progressPercentage');
            const progressBar = document.getElementById('progressBar');
            if (progressPerc) progressPerc.textContent = `${progress.toFixed(1)}%`;
            if (progressBar && progressBar.style) progressBar.style.width = `${progress}%`;
        }

        function showError(message) {
            const loadingState = document.getElementById('loadingState');
            const errorMessage = document.getElementById('errorMessage');
            const errorState = document.getElementById('errorState');
            if (loadingState) loadingState.classList.add('hidden');
            if (errorMessage) errorMessage.textContent = message;
            if (errorState) errorState.classList.remove('hidden');
        }

        function initializeVoteSelection() {
            const buttons = document.querySelectorAll('.vote-amount-btn');
            const customInput = document.getElementById('customVoteAmount');

            if (buttons && buttons.length) {
                buttons.forEach(button => {
                    button.addEventListener('click', function () {
                        buttons.forEach(btn => btn.classList.remove('active'));
                        if (customInput) customInput.value = '';
                        this.classList.add('active');
                        window.selectedVoteAmount = parseInt(this.dataset.amount) || 1;
                        window.selectedCost = parseFloat(this.dataset.cost) || (window.selectedVoteAmount * 2.0);
                        updateUI();
                    });
                });
            }

            if (customInput) {
                customInput.addEventListener('input', function () {
                    if (buttons && buttons.length) buttons.forEach(btn => btn.classList.remove('active'));
                    const amount = parseInt(this.value) || 1;
                    window.selectedVoteAmount = amount;
                    window.selectedCost = amount * 2.0;
                    updateUI();
                });
            }

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
            const nameEl = document.getElementById('successParticipantName');
            const countEl = document.getElementById('successVoteCount');
            const modal = document.getElementById('successModal');
            if (nameEl && window.currentParticipant) nameEl.textContent = window.currentParticipant.name || '';
            if (countEl) countEl.textContent = String(window.selectedVoteAmount || 0);
            if (modal) modal.classList.remove('hidden');
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
});