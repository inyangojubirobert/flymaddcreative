/**
 * ONE DREAM INITIATIVE - VOTE MODULE
 * Unified Script: Handles UI, Supabase Data, and Payment Orchestration.
 * UPDATED: Uses standalone BSC and TRON payment systems
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
    window.selectedCryptoNetwork = 'BSC'; // ✅ FIXED: Added default network

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
            
            // Check for pending Paystack payment
            await checkPendingPaystackPayment();
            
            console.log('✅ Page Initialization Complete');
        } catch (error) {
            console.error('Failed to load participant:', error);
            showError(`Failed to load participant: ${error.message}`);
        }
    }

    // ========================================
    // 🔄 CHECK PENDING PAYSTACK PAYMENT
    // ========================================
    async function checkPendingPaystackPayment() {
        const urlParams = new URLSearchParams(window.location.search);
        const paymentSuccess = urlParams.get('payment_success');
        const paystackRef = urlParams.get('reference') || urlParams.get('trxref');
        
        if (!paymentSuccess && !paystackRef) {
            return;
        }
        
        console.log('[Vote] Detected return from Paystack:', { paymentSuccess, paystackRef });
        
        const storedPaymentStr = sessionStorage.getItem('pending_paystack_payment');
        let storedPayment = {};
        try {
            storedPayment = storedPaymentStr ? JSON.parse(storedPaymentStr) : {};
        } catch (e) {
            console.error('[Vote] Failed to parse stored payment:', e);
        }
        
        const paymentReference = paystackRef || storedPayment.payment_intent_id;
        
        if (!paymentReference) {
            console.error('[Vote] No payment reference found');
            showVoteAlert('❌ Payment verification failed - no reference found', 'error');
            return;
        }
        
        try {
            showVoteAlert('🔄 Verifying payment...', 'info', 0);
            
            const verifyRes = await fetch('/api/onedream/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reference: paymentReference })
            });
            
            if (!verifyRes.ok) {
                const errData = await verifyRes.json().catch(() => ({}));
                throw new Error(errData.error || 'Payment verification failed');
            }
            
            const verifyData = await verifyRes.json();
            
            if (!verifyData.success && !verifyData.verified) {
                throw new Error(verifyData.message || 'Payment could not be verified');
            }
            
            await recordVotesAfterPayment({
                participant_id: storedPayment.participant_id || window.currentParticipant?.id,
                payment_amount: storedPayment.payment_amount || verifyData.amount,
                payment_intent_id: paymentReference,
                vote_count: storedPayment.vote_count || Math.floor((verifyData.amount || 2) / 2)
            });
            
            sessionStorage.removeItem('pending_paystack_payment');
            
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('payment_success');
            cleanUrl.searchParams.delete('reference');
            cleanUrl.searchParams.delete('trxref');
            window.history.replaceState({}, '', cleanUrl.toString());
            
        } catch (err) {
            console.error('[Vote] Payment verification error:', err);
            showVoteAlert(`❌ ${err.message}`, 'error');
            sessionStorage.removeItem('pending_paystack_payment');
        }
    }

    // ========================================
    // 🎨 WALLET CONNECTION UI OVERLAY
    // ========================================
    
    (function injectOverlayStyles() {
        if (document.getElementById('wallet-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'wallet-overlay-styles';
        style.textContent = ` /* ... your existing styles ... */ `;
        document.head.appendChild(style);
    })();

    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    function animateTextChange(element, newText, callback) {
        if (!element) return;
        element.classList.add('changing');
        setTimeout(() => {
            element.textContent = newText;
            element.classList.remove('changing');
            if (callback) callback();
        }, 200);
    }

    function createConfetti(container, count = 25) {
        // ... your existing confetti code ...
    }

    function showConnectingOverlay(message = 'Connecting to wallet...', subMessage = null) {
        // ... your existing overlay code ...
    }

    function hideConnectingOverlay() {
        const overlay = document.getElementById('walletConnectOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    function updateOverlayMessage(title, subMessage = null) {
        const titleEl = document.querySelector('#walletConnectOverlay #overlayTitle');
        const subEl = document.querySelector('#walletConnectOverlay #overlaySubMessage');
        if (titleEl) animateTextChange(titleEl, title);
        if (subEl && subMessage) animateTextChange(subEl, subMessage);
    }

    function updateOverlayStep(stepNumber, status = 'active') {
        // ... your existing step update code ...
    }

    function setStepError(stepNumber, errorMessage = null) {
        updateOverlayStep(stepNumber, 'error');
        if (errorMessage) {
            updateOverlayMessage('Connection Issue', errorMessage);
        }
    }

    function showOverlaySuccess(message = 'Payment Confirmed!') {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        setTimeout(hideConnectingOverlay, 1500);
    }

    function showOverlayError(message = 'Connection Failed') {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        setTimeout(hideConnectingOverlay, 2000);
    }

    function completeAllSteps() {
        // ... your existing steps completion code ...
    }

    // ========================================
    // 💳 PAYSTACK PAYMENT INTEGRATION
    // ========================================

    function isPaystackAvailable() {
        return typeof window.processPaystackPayment === 'function';
    }

    async function handlePaystackPayment(participantId, voteCount, amount) {
        console.log('[Paystack] handlePaystackPayment called:', { participantId, voteCount, amount });
        
        if (!isPaystackAvailable()) {
            throw new Error('Paystack payment not available. Please refresh the page.');
        }
        
        return await window.processPaystackPayment();
    }

    // ========================================
    // ❌ REMOVED: waitForCryptoPayments (legacy)
    // ✅ KEPT: waitForBSCPayments and waitForTRONPayments
    // ========================================

    /**
     * Wait for BSC Payments module to load
     */
    async function waitForBSCPayments(timeout = 5000) {
        return new Promise((resolve, reject) => {
            if (window.BSCPaymentsReady && window.BSCPayments) {
                resolve(true);
                return;
            }
            
            const startTime = Date.now();
            
            const handleReady = () => {
                cleanup();
                resolve(true);
            };
            
            document.addEventListener('bscPaymentsReady', handleReady);
            
            const checkInterval = setInterval(() => {
                if (window.BSCPaymentsReady && window.BSCPayments) {
                    cleanup();
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    cleanup();
                    reject(new Error('BSC payment module not loaded. Please refresh the page.'));
                }
            }, 100);
            
            function cleanup() {
                clearInterval(checkInterval);
                document.removeEventListener('bscPaymentsReady', handleReady);
            }
        });
    }

    /**
     * Wait for TRON Payments module to load
     */
    async function waitForTRONPayments(timeout = 5000) {
        return new Promise((resolve, reject) => {
            if (window.TRONPaymentsReady && window.TRONPayments) {
                resolve(true);
                return;
            }
            
            const startTime = Date.now();
            
            const handleReady = () => {
                cleanup();
                resolve(true);
            };
            
            document.addEventListener('tronPaymentsReady', handleReady);
            
            const checkInterval = setInterval(() => {
                if (window.TRONPaymentsReady && window.TRONPayments) {
                    cleanup();
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    cleanup();
                    reject(new Error('TRON payment module not loaded. Please refresh the page.'));
                }
            }, 100);
            
            function cleanup() {
                clearInterval(checkInterval);
                document.removeEventListener('tronPaymentsReady', handleReady);
            }
        });
    }

    /**
     * Handle crypto payment - routes to BSC or TRON based on network selection
     */
    async function handleCryptoPayment(participantId, voteCount, amount) {
        const selectedNetwork = window.selectedCryptoNetwork || 'BSC';
        
        console.log(`[Crypto] Processing ${selectedNetwork} payment:`, {
            participantId,
            voteCount,
            amount
        });

        if (selectedNetwork === 'BSC') {
            if (typeof window.BSCPayments?.initiate !== 'function') {
                await waitForBSCPayments(5000);
                if (typeof window.BSCPayments?.initiate !== 'function') {
                    throw new Error('BSC payment module not loaded. Please refresh the page.');
                }
            }
            
            showConnectingOverlay('Preparing BSC USDT Payment', 'Opening Trust Wallet...');
            
            try {
                const result = await window.BSCPayments.initiate(amount, {
                    recipient: window.BSC_CONFIG?.RECIPIENT_ADDRESS,
                    participantId: participantId,
                    voteCount: voteCount
                });
                
                hideConnectingOverlay();
                
                return {
                    success: result.success,
                    txHash: result.txHash,
                    payment_intent_id: result.txHash || result.paymentId,
                    payment_amount: amount,
                    participant_id: participantId,
                    vote_count: voteCount,
                    network: 'BSC',
                    cancelled: result.cancelled,
                    pendingConfirmation: result.pendingConfirmation
                };
            } catch (error) {
                hideConnectingOverlay();
                throw error;
            }
            
        } else if (selectedNetwork === 'TRON') {
            if (typeof window.TRONPayments?.initiate !== 'function') {
                await waitForTRONPayments(5000);
                if (typeof window.TRONPayments?.initiate !== 'function') {
                    throw new Error('TRON payment module not loaded. Please refresh the page.');
                }
            }
            
            showConnectingOverlay('Preparing TRON USDT Payment', 'Opening TronLink...');
            
            try {
                const result = await window.TRONPayments.initiate(amount, {
                    recipient: window.TRON_CONFIG?.RECIPIENT_ADDRESS,
                    participantId: participantId,
                    voteCount: voteCount
                });
                
                hideConnectingOverlay();
                
                return {
                    success: result.success,
                    txHash: result.txHash,
                    payment_intent_id: result.txHash || result.paymentId,
                    payment_amount: amount,
                    participant_id: participantId,
                    vote_count: voteCount,
                    network: 'TRON',
                    cancelled: result.cancelled,
                    pendingConfirmation: result.pendingConfirmation
                };
            } catch (error) {
                hideConnectingOverlay();
                throw error;
            }
        }
        
        throw new Error(`Unsupported network: ${selectedNetwork}`);
    }

    // ========================================
    // 💳 HANDLE VOTE / PAYMENT
    // ========================================
    async function handleVote(event) {
        event.preventDefault();
        
        const voteButton = event.target;
        const originalText = voteButton.textContent;
        
        try {
            voteButton.disabled = true;
            voteButton.textContent = 'Processing...';

            const participantId = window.currentParticipant?.id ||
                                  voteButton.dataset.participantId || 
                                  document.querySelector('[data-participant-id]')?.dataset.participantId;
            const voteCount = window.selectedVoteAmount;
            const amount = window.selectedCost;
            
            if (!participantId) {
                throw new Error('No participant selected');
            }
            
            if (!voteCount || voteCount < 1) {
                throw new Error('Please enter a valid vote count');
            }
            
            if (!window.selectedPaymentMethod) {
                throw new Error('Please select a payment method');
            }
            
            showVoteAlert('🔄 Processing payment...', 'info', 0);
            
            let paymentResult;
            
            if (window.selectedPaymentMethod === 'paystack') {
                if (typeof window.processPaystackPayment !== 'function') {
                    throw new Error('Paystack payment not available. Please refresh the page.');
                }
                paymentResult = await window.processPaystackPayment();
            } else if (window.selectedPaymentMethod === 'crypto') {
                paymentResult = await handleCryptoPayment(participantId, voteCount, amount);
            } else {
                throw new Error('Invalid payment method');
            }
            
            document.getElementById('vote-alert')?.remove();
            
            console.log('[Vote] Payment result:', paymentResult);
            
            if (!paymentResult || !paymentResult.success) {
                if (paymentResult?.cancelled) {
                    showVoteAlert('Payment cancelled', 'info');
                    return;
                }
                throw new Error(paymentResult?.error || 'Payment failed');
            }
            
            if (paymentResult.redirect) {
                console.log('[Vote] Redirecting to payment page');
                return;
            }
            
            const finalPaymentIntentId = paymentResult.payment_intent_id || paymentResult.txHash || paymentResult.reference;
            if (!finalPaymentIntentId) {
                throw new Error('Payment completed but transaction reference is missing. Please contact support.');
            }
            
            await recordVotesAfterPayment({
                participant_id: paymentResult.participant_id || participantId,
                payment_amount: paymentResult.payment_amount || amount,
                payment_intent_id: finalPaymentIntentId,
                vote_count: voteCount
            });
            
            if (typeof refreshVoteCount === 'function') {
                refreshVoteCount();
            }
            
        } catch (error) {
            console.error('[Vote] Processing failed:', error);
            
            const existingAlert = document.getElementById('vote-alert');
            if (!existingAlert || !existingAlert.textContent.includes('❌')) {
                showVoteAlert(error.message || 'Failed to process vote. Please try again.', 'error');
            }
            
        } finally {
            voteButton.disabled = false;
            voteButton.textContent = originalText;
        }
    }

    // ======================================================
    // 🔔 ALERT UTILITY FUNCTION
    // ======================================================

    function showVoteAlert(message, type = "info", duration = 5000) {
        const existingAlert = document.getElementById("vote-alert");
        if (existingAlert) existingAlert.remove();
        
        const alertBox = document.createElement("div");
        alertBox.id = "vote-alert";
        alertBox.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 15px 25px;
            border-radius: 8px;
            font-family: 'Montserrat', sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-align: center;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideDown 0.3s ease-out;
            max-width: 90%;
        `;
        
        switch (type) {
            case "success":
                alertBox.style.backgroundColor = "#10b981";
                alertBox.style.color = "#fff";
                break;
            case "error":
                alertBox.style.backgroundColor = "#ef4444";
                alertBox.style.color = "#fff";
                break;
            default:
                alertBox.style.backgroundColor = "#3b82f6";
                alertBox.style.color = "#fff";
        }
        
        alertBox.textContent = message;
        document.body.appendChild(alertBox);
        
        if (!document.getElementById("vote-alert-styles")) {
            const style = document.createElement("style");
            style.id = "vote-alert-styles";
            style.textContent = `
                @keyframes slideDown {
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes slideUp {
                    from { opacity: 1; transform: translateX(-50%) translateY(0); }
                    to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(style);
        }
        
        if (duration > 0) {
            setTimeout(() => {
                alertBox.style.animation = "slideUp 0.3s ease-out forwards";
                setTimeout(() => alertBox.remove(), 300);
            }, duration);
        }
        
        return alertBox;
    }

    // ======================================================
    // 📝 RECORD VOTES AFTER PAYMENT
    // ======================================================

    async function recordVotesAfterPayment({ participant_id, payment_amount, payment_intent_id, vote_count }) {
        const missing = [];
        if (!participant_id) missing.push("participant_id");
        if (payment_amount === undefined || payment_amount === null) missing.push("payment_amount");
        if (!payment_intent_id) missing.push("payment_intent_id");
        
        if (missing.length > 0) {
            const errorMsg = `Missing required fields: ${missing.join(", ")}`;
            showVoteAlert(`❌ ${errorMsg}`, "error");
            throw new Error(errorMsg);
        }
        
        try {
            console.log('[Vote] Recording votes:', { participant_id, payment_amount, payment_intent_id, vote_count });
            
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
            
            const isPaystack = payment_intent_id.startsWith('ODI_') || payment_intent_id.startsWith('paystack_');
            const isCrypto = payment_intent_id.startsWith('0x') || payment_intent_id.length === 64;
            const payment_method = isPaystack ? 'paystack' : (isCrypto ? 'crypto' : 'unknown');
            
            const response = await fetch("/api/onedream/vote", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "X-CSRF-TOKEN": csrfToken,
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    participant_id,
                    payment_amount,
                    payment_intent_id,
                    payment_method,
                    vote_count: vote_count || Math.floor(Number(payment_amount) / 2)
                }),
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMsg = errorData.message || `Vote recording failed: ${response.statusText}`;
                showVoteAlert(`❌ ${errorMsg}`, "error");
                throw new Error(errorMsg);
            }
            
            const result = await response.json();
            console.log("✅ Vote recorded successfully:", result);
            showVoteAlert("✅ Vote recorded successfully! Thank you for voting.", "success");
            
            showSuccessModal();
            
            return result;
            
        } catch (err) {
            console.error("❌ Error recording vote:", err);
            if (!err.message.includes("Missing required fields")) {
                showVoteAlert("❌ Error recording vote. Please try again.", "error");
            }
            throw err;
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

    // ✅ FIXED: Removed duplicate, now uses standalone BSC/TRON only
    function isPaymentMethodAvailable(method) {
        if (!method) return false;
        if (method === 'paystack') {
            return isPaystackAvailable();
        }
        if (method === 'crypto') {
            return (window.BSCPaymentsReady && window.BSCPayments) || 
                   (window.TRONPaymentsReady && window.TRONPayments);
        }
        return false;
    }

    function initializePaymentMethods() {
        const buttons = document.querySelectorAll('.payment-method-btn');
        if (!buttons || buttons.length === 0) return;
        
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.method === window.selectedPaymentMethod);
        });

        const voteBtn = document.getElementById('voteButton');
        if (voteBtn) voteBtn.disabled = !window.selectedPaymentMethod;

        if (!initializePaymentMethods.__wired) {
            document.addEventListener('click', (e) => {
                const btn = e.target.closest('.payment-method-btn');
                if (!btn) return;
                const method = btn.dataset.method;
                window.selectedPaymentMethod = method || '';
                buttons.forEach(b => b.classList.toggle('active', b === btn));
                if (voteBtn) voteBtn.disabled = false;
                console.log('Payment method selected:', method, 'available:', isPaymentMethodAvailable(method));
            });
            initializePaymentMethods.__wired = true;
        }

        // ✅ FIXED: Add network selector initialization
        initializeCryptoNetworkSelection();
    }

    // ========================================
    // 💳 CRYPTO NETWORK SELECTION
    // ========================================

    /**
     * Initialize crypto network selection UI
     */
    function initializeCryptoNetworkSelection() {
        const cryptoBtn = document.getElementById('cryptoBtn');
        if (!cryptoBtn) return;
        
        // Remove existing indicator if any
        const existingIndicator = document.getElementById('cryptoNetworkIndicator');
        if (existingIndicator) existingIndicator.remove();
        
        // Create network indicator
        const networkIndicator = document.createElement('div');
        networkIndicator.id = 'cryptoNetworkIndicator';
        networkIndicator.className = 'text-xs mt-2 flex items-center justify-center gap-2';
        networkIndicator.innerHTML = `
            <span class="text-white/70">Network:</span>
            <button id="changeNetworkBtn" class="bg-yellow-500 text-black px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 hover:bg-yellow-400 transition-colors">
                <span id="networkIcon">🟡</span>
                <span id="networkName">BSC</span>
                <span style="font-size: 10px;">▼</span>
            </button>
        `;
        
        cryptoBtn.appendChild(networkIndicator);
        
        // Add network change handler
        const changeBtn = document.getElementById('changeNetworkBtn');
        if (changeBtn) {
            changeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                if (typeof window.showNetworkSelector === 'function') {
                    const selected = await window.showNetworkSelector();
                    if (selected) {
                        window.selectedCryptoNetwork = selected;
                        const networkName = document.getElementById('networkName');
                        const networkIcon = document.getElementById('networkIcon');
                        const btn = document.getElementById('changeNetworkBtn');
                        
                        if (networkName) networkName.textContent = selected;
                        if (networkIcon) networkIcon.textContent = selected === 'BSC' ? '🟡' : '🔴';
                        
                        if (btn) {
                            btn.className = selected === 'BSC' 
                                ? 'bg-yellow-500 text-black px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 hover:bg-yellow-400 transition-colors'
                                : 'bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 hover:bg-red-500 transition-colors';
                        }
                    }
                }
            });
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
        if (!window.currentParticipant) return;
        const modal = document.getElementById('successModal');
        if (!modal) return;
        
        document.getElementById('successParticipantName').textContent = window.currentParticipant.name || 'Participant';
        document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
        modal.classList.remove('hidden');
    }

    function closeSuccessModal() {
        const modal = document.getElementById('successModal');
        if (modal) modal.classList.add('hidden');
        updateUI();
    }

    function refreshVoteCount() {
        if (window.currentParticipant && window.fetchParticipantByUsername) {
            window.fetchParticipantByUsername(window.currentParticipant.username)
                .then(participant => {
                    window.currentParticipant = participant;
                    showParticipant();
                })
                .catch(err => console.error('Failed to refresh vote count:', err));
        }
    }

    // ========================================
    // GLOBAL EXPORTS
    // ========================================
    window.closeSuccessModal = closeSuccessModal;
    window.handleCryptoPayment = handleCryptoPayment;
    window.handlePaystackPayment = handlePaystackPayment;
    window.ensureWalletConnectReady = null; // ✅ Deprecated
    window.showConnectingOverlay = showConnectingOverlay;
    window.hideConnectingOverlay = hideConnectingOverlay;
    window.updateOverlayMessage = updateOverlayMessage;
    window.updateOverlayStep = updateOverlayStep;
    window.setStepError = setStepError;
    window.showOverlaySuccess = showOverlaySuccess;
    window.showOverlayError = showOverlayError;
    window.completeAllSteps = completeAllSteps;
    window.isPaystackAvailable = isPaystackAvailable;
    window.showNetworkSelector = window.showNetworkSelector; // From vote-payments.js
    window.WALLETCONNECT_PROJECT_ID = window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5';

    console.log('✅ Vote.js initialized - Using standalone BSC/TRON modules');

})();