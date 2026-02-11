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
            
            // Check for pending Paystack payment (user returning from hosted checkout)
            await checkPendingPaystackPayment();
            
            console.log('✅ Page Initialization Complete');
        } catch (error) {
            console.error('Failed to load participant:', error);
            showError(`Failed to load participant: ${error.message}`);
        }
    }

    // ========================================
    // 🔄 CHECK PENDING PAYSTACK PAYMENT (Hosted Checkout Return)
    // ========================================
    async function checkPendingPaystackPayment() {
        const urlParams = new URLSearchParams(window.location.search);
        const paymentSuccess = urlParams.get('payment_success');
        const paystackRef = urlParams.get('reference') || urlParams.get('trxref');
        
        // Check if returning from Paystack hosted checkout
        if (!paymentSuccess && !paystackRef) {
            return; // Not a payment return
        }
        
        console.log('[Vote] Detected return from Paystack:', { paymentSuccess, paystackRef });
        
        // Get stored payment info
        const storedPaymentStr = sessionStorage.getItem('pending_paystack_payment');
        if (!storedPaymentStr) {
            console.warn('[Vote] No pending payment info found in session');
            // Still try to verify if we have a reference
            if (!paystackRef) {
                return;
            }
        }
        
        let storedPayment = {};
        try {
            storedPayment = storedPaymentStr ? JSON.parse(storedPaymentStr) : {};
        } catch (e) {
            console.error('[Vote] Failed to parse stored payment:', e);
        }
        
        // Use URL reference or stored reference
        const paymentReference = paystackRef || storedPayment.payment_intent_id;
        
        if (!paymentReference) {
            console.error('[Vote] No payment reference found');
            showVoteAlert('❌ Payment verification failed - no reference found', 'error');
            return;
        }
        
        try {
            showVoteAlert('🔄 Verifying payment...', 'info', 0);
            
            // Verify the payment with backend
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
            console.log('[Vote] Payment verification result:', verifyData);
            
            if (!verifyData.success && !verifyData.verified) {
                throw new Error(verifyData.message || 'Payment could not be verified');
            }
            
            // Record the votes
            await recordVotesAfterPayment({
                participant_id: storedPayment.participant_id || window.currentParticipant?.id,
                payment_amount: storedPayment.payment_amount || verifyData.amount,
                payment_intent_id: paymentReference,
                vote_count: storedPayment.vote_count || Math.floor((verifyData.amount || 2) / 2)
            });
            
            // Clear stored payment info
            sessionStorage.removeItem('pending_paystack_payment');
            
            // Clean up URL
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

    /* ======================================================
        SDK LOADER: Use shared loader from crypto-payments.js
        with retry logic and mobile QR support
    ====================================================== */
    
    async function ensureWalletConnectReady(retries = 3, delay = 2000) {
        // Check if already available
        if (window.EthereumProvider) {
            console.log('[Vote] ✅ WalletConnect already available');
            return window.EthereumProvider;
        }

        // Use shared loader from crypto-payments.js (preferred)
        if (window.loadWalletConnectShared) {
            try {
                console.log('[Vote] Using shared WalletConnect loader...');
                const provider = await window.loadWalletConnectShared(retries, delay);
                if (provider) {
                    console.log('[Vote] ✅ WalletConnect ready via shared loader');
                    return provider;
                }
            } catch (e) {
                console.warn('[Vote] Shared loader failed:', e.message);
            }
        }

        // Fallback to CryptoPayments module
        if (window.CryptoPayments?.loadWalletConnect) {
            try {
                console.log('[Vote] Using CryptoPayments.loadWalletConnect...');
                const provider = await window.CryptoPayments.loadWalletConnect(retries, delay);
                if (provider) return provider;
            } catch (e) {
                console.warn('[Vote] CryptoPayments loader failed:', e.message);
            }
        }

        // Last resort: check for injected wallet
        if (window.ethereum) {
            console.log('[Vote] Using injected ethereum provider');
            return window.ethereum;
        }

        console.warn('[Vote] No WalletConnect provider available');
        return null;
    }

    // ========================================
    // 🎨 WALLET CONNECTION UI OVERLAY (FlyMadd Creative Branded)
    // ========================================
    
    // Inject overlay styles with FlyMadd Creative branding
    (function injectOverlayStyles() {
        if (document.getElementById('wallet-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'wallet-overlay-styles';
        style.textContent = `
            /* FlyMadd Creative Brand Colors */
            :root {
                --flymadd-red: #e63946;
                --flymadd-blue: #1d3557;
                --flymadd-light-blue: #457b9d;
                --flymadd-cream: #f1faee;
                --flymadd-gold: #f59e0b;
                --flymadd-success: #10b981;
            }
            
            /* Import Poppins font */
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
            
            #walletConnectOverlay {
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                animation: overlay-fade-in 0.3s ease-out;
                font-family: 'Poppins', 'Montserrat', -apple-system, sans-serif;
            }
            
            @keyframes overlay-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            #walletConnectOverlay.hidden {
                animation: overlay-fade-out 0.25s ease-in forwards;
                pointer-events: none;
            }
            
            @keyframes overlay-fade-out {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            
            #walletConnectOverlay .overlay-card {
                animation: card-slide-up 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            }
            
            @keyframes card-slide-up {
                from { opacity: 0; transform: translateY(30px) scale(0.9); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            
            /* Dual-color spinner */
            #walletConnectOverlay .wallet-spinner {
                width: 56px;
                height: 56px;
                border: 4px solid var(--flymadd-cream);
                border-top-color: var(--flymadd-red);
                border-right-color: var(--flymadd-gold);
                border-radius: 50%;
                animation: wallet-spin 1s cubic-bezier(0.5, 0, 0.5, 1) infinite;
            }
            
            @keyframes wallet-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            /* Pulsing ring behind spinner */
            #walletConnectOverlay .pulse-ring {
                position: absolute;
                width: 72px;
                height: 72px;
                border: 2px solid var(--flymadd-red);
                border-radius: 50%;
                animation: pulse-ring 1.5s ease-out infinite;
            }
            
            @keyframes pulse-ring {
                0% { transform: scale(0.8); opacity: 0.6; }
                100% { transform: scale(1.5); opacity: 0; }
            }
            
            /* Text fade transition */
            #walletConnectOverlay .fade-text {
                transition: opacity 0.2s ease, transform 0.2s ease;
            }
            
            #walletConnectOverlay .fade-text.changing {
                opacity: 0;
                transform: translateY(-5px);
            }
            
            /* Typing cursor effect */
            #walletConnectOverlay .typing-cursor::after {
                content: '|';
                animation: blink-cursor 0.8s step-end infinite;
                color: var(--flymadd-gold);
                margin-left: 2px;
            }
            
            @keyframes blink-cursor {
                50% { opacity: 0; }
            }
            
            /* Step indicators */
            #walletConnectOverlay .step-indicator {
                transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            #walletConnectOverlay .step-active {
                background: linear-gradient(135deg, var(--flymadd-red), var(--flymadd-gold));
                animation: step-pulse 1.5s ease-in-out infinite;
                transform: scale(1.1);
            }
            
            @keyframes step-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(230, 57, 70, 0.5); }
                50% { box-shadow: 0 0 0 10px rgba(230, 57, 70, 0); }
            }
            
            #walletConnectOverlay .step-complete {
                background: var(--flymadd-success);
                animation: step-complete 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            @keyframes step-complete {
                0% { transform: scale(0.5) rotate(-180deg); }
                60% { transform: scale(1.2) rotate(10deg); }
                100% { transform: scale(1) rotate(0deg); }
            }
            
            /* Success icon pop */
            #walletConnectOverlay .status-icon {
                font-size: 64px;
                line-height: 1;
                animation: icon-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
            }
            
            @keyframes icon-pop {
                0% { transform: scale(0) rotate(-30deg); opacity: 0; }
                50% { transform: scale(1.3) rotate(10deg); }
                100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }
            
            /* Confetti particles */
            #walletConnectOverlay .confetti-piece {
                position: absolute;
                animation: confetti-fall 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
            }
            
            @keyframes confetti-fall {
                0% { 
                    transform: translateY(0) rotate(0deg) scale(1); 
                    opacity: 1; 
                }
                100% { 
                    transform: translateY(120px) rotate(720deg) scale(0.5); 
                    opacity: 0; 
                }
            }
            
            /* Shimmer effect on success */
            #walletConnectOverlay .shimmer {
                background: linear-gradient(
                    90deg,
                    transparent 0%,
                    rgba(255, 255, 255, 0.4) 50%,
                    transparent 100%
                );
                background-size: 200% 100%;
                animation: shimmer 1.5s ease-in-out infinite;
            }
            
            @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
            
            /* Hint slide-in */
            #walletConnectOverlay .hint-text {
                animation: hint-slide-in 0.4s ease-out;
            }
            
            @keyframes hint-slide-in {
                from { opacity: 0; transform: translateY(-15px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            /* Cancel button hover */
            #walletConnectOverlay .cancel-btn {
                transition: all 0.25s ease;
            }
            
            #walletConnectOverlay .cancel-btn:hover {
                background: #f3f4f6;
                transform: scale(1.02);
            }
            
            #walletConnectOverlay .cancel-btn:active {
                transform: scale(0.98);
            }
            
            /* Progress bar for timeout */
            #walletConnectOverlay .timeout-bar {
                height: 3px;
                background: linear-gradient(90deg, var(--flymadd-red), var(--flymadd-gold));
                border-radius: 2px;
                animation: timeout-shrink 30s linear forwards;
                transform-origin: left;
            }
            
            @keyframes timeout-shrink {
                from { transform: scaleX(1); }
                to { transform: scaleX(0); }
            }
            
            /* Add error shake animation */
            #walletConnectOverlay .shake {
                animation: error-shake 0.5s ease-in-out;
            }
            
            @keyframes error-shake {
                0%, 100% { transform: translateX(0); }
                20%, 60% { transform: translateX(-8px); }
                40%, 80% { transform: translateX(8px); }
            }
            
            /* Step indicator with icons */
            #walletConnectOverlay .step-icon {
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            #walletConnectOverlay .step-pending .step-icon::before {
                content: '';
                width: 8px;
                height: 8px;
                background: #9ca3af;
                border-radius: 50%;
            }
            
            #walletConnectOverlay .step-active .step-icon::before {
                content: '⏳';
                font-size: 14px;
                animation: hourglass-spin 2s ease-in-out infinite;
            }
            
            @keyframes hourglass-spin {
                0%, 100% { transform: rotate(0deg); }
                50% { transform: rotate(180deg); }
            }
            
            #walletConnectOverlay .step-complete .step-icon::before {
                content: '✓';
                font-size: 14px;
                font-weight: bold;
            }
            
            #walletConnectOverlay .step-error .step-icon::before {
                content: '✕';
                font-size: 14px;
                font-weight: bold;
            }
            
            #walletConnectOverlay .step-error {
                background: #ef4444 !important;
            }
            
            /* Step label transitions */
            #walletConnectOverlay .step-label {
                transition: color 0.3s ease, font-weight 0.3s ease;
            }
            
            #walletConnectOverlay .step-active ~ .step-label {
                color: #1d3557;
                font-weight: 500;
            }
            
            /* Connector line animation */
            #walletConnectOverlay .step-connector {
                position: relative;
                overflow: hidden;
            }
            
            #walletConnectOverlay .step-connector::after {
                content: '';
                position: absolute;
                left: 0;
                top: 0;
                height: 100%;
                width: 0;
                background: var(--flymadd-success);
                transition: width 0.5s ease;
            }
            
            #walletConnectOverlay .step-connector.filled::after {
                width: 100%;
            }
        `;
        document.head.appendChild(style);
    })();

    // Helper to detect mobile devices
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Smooth text transition helper
    function animateTextChange(element, newText, callback) {
        if (!element) return;
        element.classList.add('changing');
        setTimeout(() => {
            element.textContent = newText;
            element.classList.remove('changing');
            if (callback) callback();
        }, 200);
    }

    // Create confetti explosion
    function createConfetti(container, count = 25) {
        if (!container) return;
        const colors = ['#e63946', '#f59e0b', '#1d3557', '#457b9d', '#10b981', '#f1faee'];
        const shapes = ['circle', 'square', 'triangle'];
        
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            
            const color = colors[Math.floor(Math.random() * colors.length)];
            const size = 6 + Math.random() * 10;
            const shape = shapes[Math.floor(Math.random() * shapes.length)];
            const startX = 40 + Math.random() * 20; // Center area
            const drift = (Math.random() - 0.5) * 100;
            
            piece.style.cssText = `
                left: ${startX}%;
                top: 20%;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                border-radius: ${shape === 'circle' ? '50%' : shape === 'square' ? '2px' : '0'};
                ${shape === 'triangle' ? `clip-path: polygon(50% 0%, 0% 100%, 100% 100%);` : ''}
                animation-delay: ${Math.random() * 0.3}s;
                --drift: ${drift}px;
            `;
            
            // Add horizontal drift
            piece.animate([
                { transform: 'translateX(0) translateY(0) rotate(0deg)', opacity: 1 },
                { transform: `translateX(${drift}px) translateY(150px) rotate(${Math.random() * 720}deg)`, opacity: 0 }
            ], {
                duration: 1000 + Math.random() * 500,
                easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                fill: 'forwards'
            });
            
            container.appendChild(piece);
            setTimeout(() => piece.remove(), 1500);
        }
    }

    // Show branded connecting overlay with detailed status
    function showConnectingOverlay(message = 'Connecting to wallet...', subMessage = null) {
        let overlay = document.getElementById('walletConnectOverlay');
        
        const defaultSubMessage = isMobileDevice() 
            ? '📱 Opening your wallet app...' 
            : '🔗 Scan QR code with your wallet';
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'walletConnectOverlay';
            overlay.className = 'fixed inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/90 flex items-center justify-center z-[100]';
            overlay.innerHTML = `
                <div class="overlay-card bg-white p-8 rounded-3xl text-center max-w-sm mx-4 relative overflow-hidden">
                    <!-- Timeout progress bar -->
                    <div id="timeoutBar" class="timeout-bar absolute top-0 left-0 right-0"></div>
                    
                    <!-- Decorative gradient border -->
                    <div class="absolute inset-0 bg-gradient-to-r from-[#e63946] via-[#f59e0b] to-[#1d3557] opacity-5 rounded-3xl pointer-events-none"></div>
                    
                    <!-- Content -->
                    <div class="relative z-10">
                        <!-- Spinner container -->
                        <div id="spinnerContainer" class="relative flex items-center justify-center mb-6 h-20">
                            <div class="pulse-ring"></div>
                            <div class="pulse-ring" style="animation-delay: 0.5s;"></div>
                            <div id="overlaySpinner" class="wallet-spinner relative z-10"></div>
                        </div>
                        
                        <!-- Status icon (hidden by default) -->
                        <div id="overlayIcon" class="status-icon hidden mb-4"></div>
                        
                        <!-- Success confetti container -->
                        <div id="confettiContainer" class="absolute inset-0 pointer-events-none overflow-hidden"></div>
                        
                        <!-- Title with fade transition -->
                        <h3 id="overlayTitle" class="fade-text text-xl font-semibold mb-2" style="color: #1d3557;">
                            ${message}
                        </h3>
                        
                        <!-- Subtitle with fade transition -->
                        <p id="overlaySubMessage" class="fade-text text-sm mb-5" style="color: #457b9d;">
                            ${subMessage || defaultSubMessage}
                        </p>
                        
                        <!-- Enhanced Step indicators with icons -->
                        <div id="overlaySteps" class="hidden mb-5">
                            <div class="flex justify-center items-start gap-2">
                                <!-- Step 1 -->
                                <div class="flex flex-col items-center" style="min-width: 70px;">
                                    <div id="step1" class="step-indicator step-pending w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 mb-1 shadow-sm">
                                        <span class="step-icon"></span>
                                    </div>
                                    <span id="step1Label" class="step-label text-[10px] text-gray-400 font-medium text-center leading-tight">
                                        Initialize
                                    </span>
                                </div>
                                
                                <!-- Connector 1 -->
                                <div id="connector1" class="step-connector w-6 h-0.5 bg-gray-200 rounded mt-5"></div>
                                
                                <!-- Step 2 -->
                                <div class="flex flex-col items-center" style="min-width: 70px;">
                                    <div id="step2" class="step-indicator step-pending w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 mb-1 shadow-sm">
                                        <span class="step-icon"></span>
                                    </div>
                                    <span id="step2Label" class="step-label text-[10px] text-gray-400 font-medium text-center leading-tight">
                                        Connect
                                    </span>
                                </div>
                                
                                <!-- Connector 2 -->
                                <div id="connector2" class="step-connector w-6 h-0.5 bg-gray-200 rounded mt-5"></div>
                                
                                <!-- Step 3 -->
                                <div class="flex flex-col items-center" style="min-width: 70px;">
                                    <div id="step3" class="step-indicator step-pending w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 mb-1 shadow-sm">
                                        <span class="step-icon"></span>
                                    </div>
                                    <span id="step3Label" class="step-label text-[10px] text-gray-400 font-medium text-center leading-tight">
                                        Confirm
                                    </span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Hint text -->
                        <p id="overlayHint" class="hint-text text-xs hidden mb-4 p-3 rounded-lg" style="color: #e63946; background: rgba(230, 57, 70, 0.08);">
                            💡 Don't see the wallet popup? Make sure your wallet app is open and unlocked.
                        </p>
                        
                        <!-- Cancel button -->
                        <button id="cancelConnect" class="cancel-btn px-6 py-2.5 text-sm font-medium rounded-xl" 
                                style="color: #457b9d; background: #f8fafc; border: 1px solid #e2e8f0;">
                            Cancel
                        </button>
                        
                        <!-- Powered by badge -->
                        <p class="text-[10px] mt-5 flex items-center justify-center gap-1" style="color: #9ca3af;">
                            <span>🔒</span> Secured by <span style="color: #e63946; font-weight: 600;">FlyMadd</span> Creative
                        </p>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            
            overlay.querySelector('#cancelConnect').onclick = () => {
                hideConnectingOverlay();
                window.__walletConnectCancelled = true;
            };
            
            // Show hint after 6 seconds
            setTimeout(() => {
                const hint = overlay.querySelector('#overlayHint');
                if (hint && !overlay.classList.contains('hidden')) {
                    hint.classList.remove('hidden');
                }
            }, 6000);
        } else {
            updateOverlayMessage(message, subMessage || defaultSubMessage);
            overlay.classList.remove('hidden');
            // Reset timeout bar
            const bar = overlay.querySelector('#timeoutBar');
            if (bar) {
                bar.style.animation = 'none';
                bar.offsetHeight; // Trigger reflow
                bar.style.animation = 'timeout-shrink 30s linear forwards';
            }
        }
        
        window.__walletConnectCancelled = false;
        return overlay;
    }

    function hideConnectingOverlay() {
        const overlay = document.getElementById('walletConnectOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
            // Reset state after animation
            setTimeout(() => {
                const spinner = overlay.querySelector('#spinnerContainer');
                const icon = overlay.querySelector('#overlayIcon');
                const steps = overlay.querySelector('#overlaySteps');
                const hint = overlay.querySelector('#overlayHint');
                const title = overlay.querySelector('#overlayTitle');
                const subMessage = overlay.querySelector('#overlaySubMessage');
                const card = overlay.querySelector('.overlay-card');
                
                if (spinner) spinner.classList.remove('hidden');
                if (icon) { icon.classList.add('hidden'); icon.textContent = ''; }
                if (steps) steps.classList.add('hidden');
                if (hint) hint.classList.add('hidden');
                if (card) card.classList.remove('shake');
                
                // Reset title color
                if (title) title.style.color = '#1d3557';
                if (subMessage) {
                    subMessage.classList.remove('shimmer');
                    subMessage.style.color = '#457b9d';
                }
                
                // Reset step indicators and connectors
                for (let i = 1; i <= 3; i++) {
                    const step = overlay.querySelector(`#step${i}`);
                    const connector = overlay.querySelector(`#connector${i}`);
                    if (step) {
                        step.className = 'step-indicator w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold mb-1 shadow-sm';
                        step.textContent = i;
                    }
                    if (connector) connector.style.background = '#e5e7eb';
                }
            }, 300);
        }
    }

    function updateOverlayMessage(title, subMessage = null) {
        const titleEl = document.querySelector('#walletConnectOverlay #overlayTitle');
        const subEl = document.querySelector('#walletConnectOverlay #overlaySubMessage');
        
        if (titleEl) animateTextChange(titleEl, title);
        if (subEl && subMessage) animateTextChange(subEl, subMessage);
    }

    function updateOverlayStep(stepNumber, status = 'active') {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        
        const steps = overlay.querySelector('#overlaySteps');
        if (steps) steps.classList.remove('hidden');
        
        // Step labels for each phase
        const stepLabels = {
            1: { pending: 'Initialize', active: 'Setting up...', complete: 'Ready ✓' },
            2: { pending: 'Connect', active: 'Connecting...', complete: 'Connected ✓' },
            3: { pending: 'Confirm', active: 'Confirming...', complete: 'Done ✓' }
        };
        
        for (let i = 1; i <= 3; i++) {
            const step = overlay.querySelector(`#step${i}`);
            const connector = overlay.querySelector(`#connector${i - 1}`);
            const label = overlay.querySelector(`#step${i}Label`);
            
            if (step) {
                // Determine step state
                let stepState;
                if (i < stepNumber) {
                    stepState = 'complete';
                } else if (i === stepNumber) {
                    stepState = status; // 'active' or 'error'
                } else {
                    stepState = 'pending';
                }
                
                // Apply step styling
                step.className = `step-indicator step-${stepState} w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-1 shadow-sm`;
                
                if (stepState === 'complete') {
                    step.classList.add('step-complete', 'text-white');
                    step.style.background = '#10b981';
                    step.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
                } else if (stepState === 'active') {
                    step.classList.add('step-active', 'text-white');
                    step.style.background = 'linear-gradient(135deg, #e63946, #f59e0b)';
                    step.innerHTML = '<span class="text-lg">⏳</span>';
                } else if (stepState === 'error') {
                    step.classList.add('step-error', 'text-white');
                    step.style.background = '#ef4444';
                    step.innerHTML = '<span class="text-lg">✕</span>';
                } else {
                    step.classList.add('step-pending', 'text-gray-500');
                    step.style.background = '#e5e7eb';
                    step.innerHTML = `<span class="step-icon">${i}</span>`;
                }
                
                // Update label
                if (label && stepLabels[i]) {
                    label.textContent = stepLabels[i][stepState] || stepLabels[i].pending;
                    label.style.color = stepState === 'active' ? '#1d3557' : 
                                        stepState === 'complete' ? '#10b981' : 
                                        stepState === 'error' ? '#ef4444' : '#9ca3af';
                    label.style.fontWeight = stepState === 'active' ? '600' : '500';
                }
                
                // Update connector
                if (connector && i > 1) {
                    if (i <= stepNumber) {
                        connector.classList.add('filled');
                        connector.style.background = '#10b981';
                    } else {
                        connector.classList.remove('filled');
                        connector.style.background = '#e5e7eb';
                    }
                }
            }
        }
    }

    // Mark a step as errored
    function setStepError(stepNumber, errorMessage = null) {
        updateOverlayStep(stepNumber, 'error');
        if (errorMessage) {
            updateOverlayMessage('Connection Issue', errorMessage);
        }
    }

    function showOverlaySuccess(message = 'Payment Confirmed!') {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        
        // Complete all steps first
        completeAllSteps();
        
        const spinnerContainer = overlay.querySelector('#spinnerContainer');
        const icon = overlay.querySelector('#overlayIcon');
        const title = overlay.querySelector('#overlayTitle');
        const subMessage = overlay.querySelector('#overlaySubMessage');
        const confettiContainer = overlay.querySelector('#confettiContainer');
        const timeoutBar = overlay.querySelector('#timeoutBar');
        const cancelBtn = overlay.querySelector('#cancelConnect');
        
        if (timeoutBar) timeoutBar.style.display = 'none';
        if (spinnerContainer) spinnerContainer.classList.add('hidden');
        if (icon) {
            icon.classList.remove('hidden');
            icon.textContent = '🎉';
        }
        if (title) {
            title.textContent = message;
            title.style.color = '#10b981';
        }
        if (subMessage) {
            subMessage.textContent = 'Your votes are being recorded...';
            subMessage.classList.add('shimmer');
            subMessage.style.color = '#10b981';
        }
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
        
        // Create confetti explosion
        if (confettiContainer) createConfetti(confettiContainer, 30);
        
        // Auto-hide after 2.5s
        setTimeout(hideConnectingOverlay, 2500);
    }

    function showOverlayError(message = 'Connection Failed') {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        
        const spinnerContainer = overlay.querySelector('#spinnerContainer');
        const icon = overlay.querySelector('#overlayIcon');
        const title = overlay.querySelector('#overlayTitle');
        const subMessage = overlay.querySelector('#overlaySubMessage');
        const card = overlay.querySelector('.overlay-card');
        const timeoutBar = overlay.querySelector('#timeoutBar');
        const cancelBtn = overlay.querySelector('#cancelConnect');
        
        // Hide timeout bar
        if (timeoutBar) timeoutBar.style.display = 'none';
        
        // Add shake effect
        if (card) {
            card.classList.add('shake');
        }
        
        if (spinnerContainer) spinnerContainer.classList.add('hidden');
        if (icon) {
            icon.classList.remove('hidden');
            icon.textContent = '😔';
        }
        if (title) {
            title.textContent = message;
            title.style.color = '#e63946';
        }
        if (subMessage) {
            subMessage.innerHTML = `
                Please try again or choose another payment method.
                <button id="retryConnect" class="block mx-auto mt-3 px-4 py-2 text-sm font-medium rounded-lg text-white" 
                        style="background: linear-gradient(135deg, #e63946, #f59e0b);">
                    🔄 Try Again
                </button>
            `;
            subMessage.style.color = '#6b7280';
        }
        
        // Change cancel button text
        if (cancelBtn) {
            cancelBtn.textContent = 'Choose Different Method';
        }
        
        // Add retry handler
        const retryBtn = overlay.querySelector('#retryConnect');
        if (retryBtn) {
            retryBtn.onclick = () => {
                hideConnectingOverlay();
                // Trigger crypto payment again after a brief delay
                setTimeout(() => {
                    if (window.handleCryptoPayment) {
                        window.handleCryptoPayment();
                    }
                }, 300);
            };
        }
    }

    // Complete all steps on success
    function completeAllSteps() {
        const overlay = document.getElementById('walletConnectOverlay');
        if (!overlay) return;
        
        const steps = overlay.querySelector('#overlaySteps');
        if (steps) steps.classList.remove('hidden');
        
        // Mark all steps as complete with animation delay
        for (let i = 1; i <= 3; i++) {
            setTimeout(() => {
                updateOverlayStep(i + 1); // This marks step i as complete
            }, (i - 1) * 200);
        }
    }

    // ========================================
    // 💳 PAYSTACK PAYMENT INTEGRATION
    // ========================================

    /**
     * Check if Paystack is available
     */
    function isPaystackAvailable() {
        return typeof window.processPaystackPayment === 'function';
    }

    /**
     * Handle Paystack payment - wrapper for processPaystackPayment
     * This is exported for compatibility but uses the paystack-payments.js module
     */
    async function handlePaystackPayment(participantId, voteCount, amount) {
        console.log('[Paystack] handlePaystackPayment called:', { participantId, voteCount, amount });
        
        if (!isPaystackAvailable()) {
            throw new Error('Paystack payment not available. Please refresh the page.');
        }
        
        // Use the dedicated Paystack module
        return await window.processPaystackPayment();
    }

    // ========================================
    // 🔐 CRYPTO PAYMENT MODULE LOADER
    // ========================================

    /**
     * Wait for the crypto payments module to be ready
     */
    async function waitForCryptoPayments(timeout = 5000) {
        return new Promise((resolve, reject) => {
            if (window.initiateCryptoPayment && window.CryptoPaymentsReady) {
                resolve(true);
                return;
            }
            
            const startTime = Date.now();
            
            const handleReady = () => {
                cleanup();
                resolve(true);
            };
            
            document.addEventListener('cryptoPaymentsReady', handleReady);
            
            const checkInterval = setInterval(() => {
                if (window.initiateCryptoPayment && window.CryptoPaymentsReady) {
                    cleanup();
                    resolve(true);
                } else if (Date.now() - startTime > timeout) {
                    cleanup();
                    reject(new Error('Crypto payment module failed to load. Please refresh the page.'));
                }
            }, 100);
            
            function cleanup() {
                clearInterval(checkInterval);
                document.removeEventListener('cryptoPaymentsReady', handleReady);
            }
        });
    }

    // ========================================
    // 💳 HANDLE VOTE / PAYMENT (UPDATED)
    // ========================================
    async function handleVote(event) {
        event.preventDefault();
        
        const voteButton = event.target;
        const originalText = voteButton.textContent;
        
        try {
            // Disable button during processing
            voteButton.disabled = true;
            voteButton.textContent = 'Processing...';

            // Get vote details - prioritize window.currentParticipant (set from URL)
            const participantId = window.currentParticipant?.id ||
                                  voteButton.dataset.participantId || 
                                  document.querySelector('[data-participant-id]')?.dataset.participantId;
            const voteCount = parseInt(document.querySelector('#voteCount')?.value || 
                                           document.querySelector('[name="vote_count"]')?.value || 1);
            const amount = parseFloat(document.querySelector('#voteAmount')?.value || 
                                  document.querySelector('[name="amount"]')?.value || voteCount * 2.0); // $2 per vote
            
            if (!participantId) {
                throw new Error('No participant selected');
            }
            
            if (!voteCount || voteCount < 1) {
                throw new Error('Please enter a valid vote count');
            }
            
            showVoteAlert('🔄 Processing payment...', 'info', 0);
            
            // Route payment based on selected method
            let paymentResult;
            
            if (window.selectedPaymentMethod === 'paystack') {
                // Process Paystack payment using the dedicated module
                if (typeof window.processPaystackPayment !== 'function') {
                    throw new Error('Paystack payment not available. Please refresh the page.');
                }
                paymentResult = await window.processPaystackPayment();
            } else if (window.selectedPaymentMethod === 'crypto') {
                // Process crypto payment
                paymentResult = await handleCryptoPayment(participantId, voteCount, amount);
            } else {
                throw new Error('Please select a payment method');
            }
            
            // Remove processing alert
            document.getElementById('vote-alert')?.remove();
            
            console.log('[Vote] Payment result:', paymentResult);
            
            // Check if payment was successful
            if (!paymentResult || !paymentResult.success) {
                if (paymentResult?.cancelled) {
                    console.log('[Vote] Payment cancelled by user');
                    showVoteAlert('Payment cancelled', 'info');
                    return;
                }
                throw new Error(paymentResult?.error || 'Payment failed');
            }
            
            // Check if this is a redirect flow (hosted checkout)
            // In this case, user is being redirected to payment page - don't record yet
            if (paymentResult.redirect) {
                console.log('[Vote] Redirecting to payment page - will record vote on return');
                // Vote will be recorded when user returns from payment page
                // See checkPendingPaystackPayment() below
                return;
            }
            
            // Validate payment_intent_id before recording
            const finalPaymentIntentId = paymentResult.payment_intent_id || paymentResult.txHash || paymentResult.reference;
            if (!finalPaymentIntentId) {
                console.error('[Vote] Payment succeeded but missing transaction reference:', paymentResult);
                throw new Error('Payment completed but transaction reference is missing. Please contact support.');
            }
            
            // Record votes using the payment result fields
            await recordVotesAfterPayment({
                participant_id: paymentResult.participant_id || participantId,
                payment_amount: paymentResult.payment_amount || amount,
                payment_intent_id: finalPaymentIntentId,
                vote_count: voteCount
            });
            
            // Optionally refresh vote count display
            if (typeof refreshVoteCount === 'function') {
                refreshVoteCount();
            }
            
        } catch (error) {
            console.error('[Vote] Processing failed:', error);
            
            // Only show alert if not already shown by recordVotesAfterPayment
            const existingAlert = document.getElementById('vote-alert');
            if (!existingAlert || !existingAlert.textContent.includes('❌')) {
                showVoteAlert(error.message || 'Failed to process vote. Please try again.', 'error');
            }
            
        } finally {
            // Re-enable button
            voteButton.disabled = false;
            voteButton.textContent = originalText;
        }
    }

    // Dedicated crypto payment handler with detailed status updates
    async function handleCryptoPayment(participantId, voteCount, amount) {
        try {
            await waitForCryptoPayments(5000);
            
            if (typeof window.initiateCryptoPayment !== 'function') {
                throw new Error('Crypto payment module not loaded. Please refresh the page.');
            }
            
            console.log('[Vote] Starting crypto payment:', { participantId, voteCount, amount });
            
            const result = await window.initiateCryptoPayment(
                String(participantId), 
                Number(voteCount), 
                Number(amount)
            );
            
            console.log('[Vote] Crypto payment result:', result);
            return result;
            
        } catch (error) {
            console.error('[Vote] Crypto payment error:', error);
            throw error;
        }
    }

    // ======================================================
    // 🔔 ALERT UTILITY FUNCTION
    // ======================================================

    /**
     * Show a styled alert message to the user
     * @param {string} message - The message to display
     * @param {string} type - Alert type: 'success', 'error', or 'info'
     * @param {number} duration - How long to show the alert (ms), 0 for permanent
     */
    function showVoteAlert(message, type = "info", duration = 5000) {
        // Remove any existing alert
        const existingAlert = document.getElementById("vote-alert");
        if (existingAlert) existingAlert.remove();
        
        // Create alert container
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
        
        // Style based on type
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
        
        // Add animation keyframes if not exists
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
        
        // Auto-remove after duration
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

    /**
     * Record votes after successful payment
     */
    async function recordVotesAfterPayment({ participant_id, payment_amount, payment_intent_id, vote_count }) {
        // Validate required fields
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
            
            // Determine payment method based on payment_intent_id format
            const isPaystack = payment_intent_id.startsWith('ODI_') || payment_intent_id.startsWith('paystack_');
            const isCrypto = payment_intent_id.startsWith('0x') || payment_intent_id.startsWith('CRYPTO_') || payment_intent_id.length === 64;
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
                    vote_count: vote_count || Math.floor(Number(payment_amount) / 2) // $2 per vote
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
            
            // Show success modal
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

    // small helper: check if a payment method is ready (quick, best-effort)
    function isPaymentMethodAvailable(method) {
        if (!method) return false;
        if (method === 'paystack') {
            return isPaystackAvailable();
        }
        if (method === 'crypto') {
            return typeof window.processCryptoPayment === 'function' || 
                   typeof window.CryptoPayments !== 'undefined' ||
                   typeof window.EthereumProvider !== 'undefined' || 
                   typeof window.ethereum !== 'undefined' ||
                   window.tronWeb?.ready;
        }
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
                  if (window.appToast) {
                    window.appToast('Note: Selected payment method may be unavailable in this browser.', 4000);
                  } else {
                    console.warn('Selected payment method may be unavailable:', method);
                  }
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
        if (!window.currentParticipant) return;
        const modal = document.getElementById('successModal');
        if (!modal) return;
        
        document.getElementById('successParticipantName').textContent = window.currentParticipant.name || 'Participant';
        document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
        document.getElementById('successModal').classList.remove('hidden');
    }

    function closeSuccessModal() {
        const modal = document.getElementById('successModal');
        if (modal) modal.classList.add('hidden');
        updateUI();
    }

    function refreshVoteCount() {
        // This function would refresh the vote count from the server
        // For now, we'll just reload the participant data
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
    // GLOBAL EXPORTS (Window Scope)
    // ========================================
    window.closeSuccessModal = closeSuccessModal;
    window.handleCryptoPayment = handleCryptoPayment;
    window.handlePaystackPayment = handlePaystackPayment;
    window.ensureWalletConnectReady = ensureWalletConnectReady;
    window.showConnectingOverlay = showConnectingOverlay;
    window.hideConnectingOverlay = hideConnectingOverlay;
    window.updateOverlayMessage = updateOverlayMessage;
    window.updateOverlayStep = updateOverlayStep;
    window.setStepError = setStepError;
    window.showOverlaySuccess = showOverlaySuccess;
    window.showOverlayError = showOverlayError;
    window.completeAllSteps = completeAllSteps;
    window.isPaystackAvailable = isPaystackAvailable;
    window.WALLETCONNECT_PROJECT_ID = window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5';

    console.log('✅ Vote.js initialization logic exported.');

})();