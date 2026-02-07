// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

// Check if we're in a browser environment
if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// ✅ Inject required CSS for loading spinner and alerts
(function injectStyles() {
    if (document.getElementById('crypto-payments-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'crypto-payments-styles';
    style.textContent = `
        .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #e5e7eb;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: crypto-spin 0.8s linear infinite;
        }
        
        @keyframes crypto-spin {
            to { transform: rotate(360deg); }
        }
        
        .crypto-modal-fade-in {
            animation: crypto-fade-in 0.2s ease-out;
        }
        
        @keyframes crypto-fade-in {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        
        @keyframes crypto-slide-down {
            from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        
        @keyframes crypto-slide-up {
            from { opacity: 1; transform: translateX(-50%) translateY(0); }
            to { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        }
        
        .crypto-alert {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 40px 12px 16px;
            border-radius: 8px;
            font-family: 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            font-weight: 500;
            text-align: center;
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: crypto-slide-down 0.3s ease-out;
            max-width: 90%;
            min-width: 280px;
        }
        
        .crypto-alert.success {
            background-color: #10b981;
            color: #fff;
        }
        
        .crypto-alert.error {
            background-color: #ef4444;
            color: #fff;
        }
        
        .crypto-alert.info {
            background-color: #3b82f6;
            color: #fff;
        }
        
        .crypto-alert.warning {
            background-color: #f59e0b;
            color: #fff;
        }
        
        .crypto-alert-close {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255,255,255,0.2);
            border: none;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            font-size: 16px;
            color: #fff;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        
        .crypto-alert-close:hover {
            background: rgba(255,255,255,0.3);
        }
        
        .crypto-modal-close {
            position: absolute;
            top: 10px;
            right: 10px;
            background: #f3f4f6;
            border: none;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            font-size: 18px;
            color: #6b7280;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .crypto-modal-close:hover {
            background: #e5e7eb;
            color: #374151;
        }
        
        /* Additional styles for modals */
        .hidden {
            display: none !important;
        }
        
        .flex {
            display: flex;
        }
        
        .items-center {
            align-items: center;
        }
        
        .justify-center {
            justify-content: center;
        }
        
        .mx-auto {
            margin-left: auto;
            margin-right: auto;
        }
        
        .rounded-xl {
            border-radius: 0.75rem;
        }
        
        .rounded-lg {
            border-radius: 0.5rem;
        }
        
        .rounded {
            border-radius: 0.25rem;
        }
        
        .bg-black\\/80 {
            background-color: rgba(0, 0, 0, 0.8);
        }
        
        .bg-white {
            background-color: #fff;
        }
        
        .bg-gray-100 {
            background-color: #f3f4f6;
        }
        
        .bg-gray-200 {
            background-color: #e5e7eb;
        }
        
        .bg-gray-800 {
            background-color: #1f2937;
        }
        
        .bg-blue-600 {
            background-color: #2563eb;
        }
        
        .bg-green-600 {
            background-color: #059669;
        }
        
        .bg-red-600 {
            background-color: #dc2626;
        }
        
        .bg-yellow-400 {
            background-color: #fbbf24;
        }
        
        .bg-orange-500 {
            background-color: #f97316;
        }
        
        .bg-purple-500 {
            background-color: #8b5cf6;
        }
        
        .bg-gradient-to-r {
            background-image: linear-gradient(to right, var(--tw-gradient-stops));
        }
        
        .from-blue-600 {
            --tw-gradient-from: #2563eb;
            --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(37, 99, 235, 0));
        }
        
        .to-purple-600 {
            --tw-gradient-to: #7c3aed;
        }
        
        .hover\\:from-blue-700:hover {
            --tw-gradient-from: #1d4ed8;
        }
        
        .hover\\:to-purple-700:hover {
            --tw-gradient-to: #6d28d9;
        }
        
        .hover\\:bg-blue-700:hover {
            background-color: #1d4ed8;
        }
        
        .hover\\:bg-gray-300:hover {
            background-color: #d1d5db;
        }
        
        .hover\\:bg-gray-900:hover {
            background-color: #111827;
        }
        
        .hover\\:bg-green-700:hover {
            background-color: #047857;
        }
        
        .hover\\:bg-red-700:hover {
            background-color: #b91c1c;
        }
        
        .hover\\:bg-yellow-500:hover {
            background-color: #f59e0b;
        }
        
        .hover\\:bg-orange-600:hover {
            background-color: #ea580c;
        }
        
        .hover\\:bg-purple-600:hover {
            background-color: #7c3aed;
        }
        
        .text-white {
            color: #fff;
        }
        
        .text-gray-500 {
            color: #6b7280;
        }
        
        .text-gray-600 {
            color: #4b5563;
        }
        
        .text-gray-700 {
            color: #374151;
        }
        
        .text-blue-500 {
            color: #3b82f6;
        }
        
        .text-red-500 {
            color: #ef4444;
        }
        
        .text-sm {
            font-size: 0.875rem;
        }
        
        .text-xs {
            font-size: 0.75rem;
        }
        
        .text-lg {
            font-size: 1.125rem;
        }
        
        .text-2xl {
            font-size: 1.5rem;
        }
        
        .font-bold {
            font-weight: 700;
        }
        
        .font-medium {
            font-weight: 500;
        }
        
        .font-semibold {
            font-weight: 600;
        }
        
        .font-mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        
        .p-2 {
            padding: 0.5rem;
        }
        
        .p-3 {
            padding: 0.75rem;
        }
        
        .p-6 {
            padding: 1.5rem;
        }
        
        .py-2 {
            padding-top: 0.5rem;
            padding-bottom: 0.5rem;
        }
        
        .py-3 {
            padding-top: 0.75rem;
            padding-bottom: 0.75rem;
        }
        
        .px-3 {
            padding-left: 0.75rem;
            padding-right: 0.75rem;
        }
        
        .pr-6 {
            padding-right: 1.5rem;
        }
        
        .mb-2 {
            margin-bottom: 0.5rem;
        }
        
        .mb-3 {
            margin-bottom: 0.75rem;
        }
        
        .mb-4 {
            margin-bottom: 1rem;
        }
        
        .mt-2 {
            margin-top: 0.5rem;
        }
        
        .mt-3 {
            margin-top: 0.75rem;
        }
        
        .mt-4 {
            margin-top: 1rem;
        }
        
        .mt-6 {
            margin-top: 1.5rem;
        }
        
        .my-3 {
            margin-top: 0.75rem;
            margin-bottom: 0.75rem;
        }
        
        .w-full {
            width: 100%;
        }
        
        .w-80 {
            width: 20rem;
        }
        
        .max-w-\\[90vw\\] {
            max-width: 90vw;
        }
        
        .max-w-\\[95vw\\] {
            max-width: 95vw;
        }
        
        .gap-1 {
            gap: 0.25rem;
        }
        
        .gap-2 {
            gap: 0.5rem;
        }
        
        .grid {
            display: grid;
        }
        
        .grid-cols-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        
        .break-all {
            word-break: break-all;
        }
        
        .border {
            border-width: 1px;
            border-color: #d1d5db;
        }
        
        .border-t {
            border-top-width: 1px;
            border-top-color: #d1d5db;
        }
        
        .border-b {
            border-bottom-width: 1px;
            border-bottom-color: #d1d5db;
        }
        
        .shadow-md {
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        
        .focus\\:ring-2:focus {
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
        }
        
        .focus\\:ring-blue-500:focus {
            --tw-ring-color: #3b82f6;
        }
        
        .focus\\:ring-red-500:focus {
            --tw-ring-color: #ef4444;
        }
        
        .focus\\:border-blue-500:focus {
            border-color: #3b82f6;
        }
        
        .outline-none {
            outline: 2px solid transparent;
            outline-offset: 2px;
        }
        
        .transition-colors {
            transition-property: color, background-color, border-color;
            transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
            transition-duration: 150ms;
        }
        
        .transition-all {
            transition-property: all;
            transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
            transition-duration: 150ms;
        }
        
        .z-50 {
            z-index: 50;
        }
        
        .fixed {
            position: fixed;
        }
        
        .inset-0 {
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
        }
        
        .relative {
            position: relative;
        }
        
        .text-center {
            text-align: center;
        }
        
        .min-h-6 {
            min-height: 1.5rem;
        }
        
        /* QR Code specific styles */
        .qr-code-container {
            width: 200px;
            height: 200px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            background: white;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .qr-code-canvas {
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .qr-code-canvas:hover {
            transform: scale(1.02);
        }
        
        .qr-fallback {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
        }
        
        .ring-2 {
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
        }
        
        .ring-blue-500 {
            --tw-ring-color: #3b82f6;
        }
    `;
    document.head.appendChild(style);
})();

// ✅ Load QRCode.js library dynamically
function loadQRCodeLibrary() {
    return new Promise((resolve, reject) => {
        if (typeof QRCode !== 'undefined') {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            console.log('✅ QRCode.js library loaded');
            resolve();
        };
        script.onerror = () => {
            console.warn('Failed to load QRCode.js, using fallback');
            resolve(); // Still resolve to use fallback
        };
        
        document.head.appendChild(script);
    });
}

// ✅ Ensure Paystack fallback exists
if (typeof window.initiatePaystackPayment !== 'function') {
    window.initiatePaystackPayment = function() {
        console.warn('[Paystack] initiatePaystackPayment not defined - showing fallback');
        alert('Card payments are being set up. Please use crypto payment or QR code for now.');
        return false;
    };
}

// ✅ Config uses data attributes or hardcoded values
const scriptTag = document.currentScript || document.querySelector('script[src*="crypto-payments"]');

const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        RPC_URL: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: 56,
        EXPLORER: "https://bscscan.com/tx/",
        WALLET_ADDRESS: scriptTag?.dataset?.bscWallet || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/",
        WALLET_ADDRESS: scriptTag?.dataset?.tronWallet || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: scriptTag?.dataset?.wcProjectId || "61d9b98f81731dffa9988c0422676fc5"
    },
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000,
        ATTEMPT_TIMEOUT: 5 * 60 * 1000
    }
};

const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    TIMEOUT: 'TIMEOUT',
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    INITIALIZATION_ERROR: 'INITIALIZATION_ERROR',
    DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// ======================================================
// 🛡️  ERROR HANDLING CLASS
// ======================================================

class PaymentError extends Error {
    constructor(message, code, metadata = {}) {
        super(message);
        this.name = 'PaymentError';
        this.code = code;
        this.metadata = metadata;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PaymentError);
        }
    }
}

// ======================================================
// 🔌  UTILITY FUNCTIONS
// ======================================================

function validateInputs(participantId, voteCount) {
    if (!participantId || typeof participantId !== 'string') {
        throw new PaymentError('Invalid participant ID', ERROR_CODES.INVALID_INPUT);
    }
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) {
        throw new PaymentError('Invalid vote count', ERROR_CODES.INVALID_INPUT);
    }
}

function getAttempts(participantId) {
    try {
        return JSON.parse(sessionStorage.getItem(`crypto_pay_attempts_${participantId}`) || '[]');
    } catch {
        return [];
    }
}

function setAttempts(participantId, attempts) {
    try {
        sessionStorage.setItem(`crypto_pay_attempts_${participantId}`, JSON.stringify(attempts));
    } catch (e) {
        console.warn('[RateLimit] Failed to persist attempts:', e);
    }
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = getAttempts(participantId).filter(
        t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT
    );
    
    if (attempts.length >= CONFIG.LIMITS.MAX_RETRIES) {
        throw new PaymentError(
            'Too many payment attempts. Please try again later.',
            ERROR_CODES.RATE_LIMIT,
            { attempts: attempts.length }
        );
    }
    
    attempts.push(now);
    setAttempts(participantId, attempts);
}

function trackEvent(name, metadata = {}) {
    try {
        if (window.analytics) {
            window.analytics.track(name, metadata);
        }
        console.log(`[Analytics] ${name}`, metadata);
    } catch (e) {
        console.error('Tracking error:', e);
    }
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isInAppBrowser() {
    // Check if we're inside a wallet's in-app browser (MOBILE ONLY)
    // This should NOT match desktop browser extensions like MetaMask
    if (!isMobileDevice()) {
        return false; // Desktop browsers with wallet extensions are NOT in-app browsers
    }
    
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('metamask') || 
           ua.includes('trust') || 
           ua.includes('tokenpocket') ||
           ua.includes('imtoken') ||
           ua.includes('coinbase');
    // Note: Removed window.ethereum checks since those match desktop extensions too
}

function getWalletDeepLinks(network, recipient, amount) {
    // Deep links for popular mobile wallets
    const chainId = network === 'BSC' ? 56 : 1;
    const usdtAddress = network === 'BSC' ? CONFIG.BSC.USDT_ADDRESS : '';
    
    return {
        metamask: `https://metamask.app.link/send/${usdtAddress}@${chainId}/transfer?address=${recipient}&uint256=${amount}e18`,
        trust: `trust://send?asset=c20000714_t${usdtAddress}&address=${recipient}&amount=${amount}`,
        tokenpocket: `tpoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
            action: 'transfer',
            chain: 'BSC',
            contract: usdtAddress,
            to: recipient,
            amount: amount.toString()
        }))}`,
        // Generic WalletConnect deep link
        walletconnect: `wc:`
    };
}

function showMobileWalletModal(network, recipient, amount) {
    return new Promise((resolve) => {
        const hasInjectedWallet = window.ethereum || window.BinanceChain;
        const deepLinks = getWalletDeepLinks(network, recipient, amount);
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">💳 Connect Wallet</h3>
                <p class="text-sm text-gray-600 mb-4">Choose your wallet to pay <strong>${amount} USDT</strong></p>
                
                ${hasInjectedWallet ? `
                <button id="useInjectedWallet" class="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-3 rounded-lg mb-3 flex items-center justify-center gap-2 font-semibold transition-all shadow-md">
                    <span>🔗</span> Connect Current Wallet
                </button>
                <div class="text-xs text-gray-400 mb-3">— or open another wallet —</div>
                ` : ''}
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="openMetaMask" class="bg-orange-500 hover:bg-orange-600 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>🦊</span> MetaMask
                    </button>
                    <button id="openTrust" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>🛡️</span> Trust
                    </button>
                    <button id="openTokenPocket" class="bg-purple-500 hover:bg-purple-600 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>💰</span> TokenPocket
                    </button>
                    <button id="openOther" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>📱</span> Other
                    </button>
                </div>
                
                <div class="border-t pt-3 mt-2">
                    <p class="text-xs text-gray-500 mb-2">Already paid? Enter transaction hash:</p>
                    <input type="text" id="txHashInput" placeholder="0x..." class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm transition-colors">✅ Confirm Payment</button>
                </div>
                
                <button id="cancelPayment" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded text-sm mt-2 transition-colors">Cancel</button>
            </div>
        `);

        // Close handlers
        modal.querySelector('#modalCloseX').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        modal.querySelector('#cancelPayment').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };

        // Use injected wallet (if in wallet browser)
        if (hasInjectedWallet) {
            modal.querySelector('#useInjectedWallet').onclick = () => { 
                modal.remove(); 
                resolve({ success: false, useInjected: true }); 
            };
        }

        // Open wallet apps via deep links
        modal.querySelector('#openMetaMask').onclick = () => {
            window.location.href = deepLinks.metamask;
            // Keep modal open - user will return after wallet interaction
        };
        
        modal.querySelector('#openTrust').onclick = () => {
            window.location.href = deepLinks.trust;
        };
        
        modal.querySelector('#openTokenPocket').onclick = () => {
            window.location.href = deepLinks.tokenpocket;
        };
        
        modal.querySelector('#openOther').onclick = () => {
            // Show address and amount for manual sending
            modal.remove();
            resolve({ success: false, showManual: true });
        };

        // Confirm payment with tx hash
        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ 
                    success: true, 
                    manual: true, 
                    txHash, 
                    explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` 
                });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };
    });
}

function showMobileTronWalletModal(recipient, amount) {
    return new Promise((resolve) => {
        const hasTronLink = window.tronWeb && window.tronWeb.ready;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">💳 TRON Payment</h3>
                <p class="text-sm text-gray-600 mb-4">Pay <strong>${amount} USDT</strong> (TRC-20)</p>
                
                ${hasTronLink ? `
                <button id="useTronLink" class="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-3 rounded-lg mb-3 flex items-center justify-center gap-2 font-semibold transition-all shadow-md">
                    <span>🔴</span> Pay with TronLink
                </button>
                ` : ''}
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="openTronLink" class="bg-red-600 hover:bg-red-700 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>🔴</span> TronLink
                    </button>
                    <button id="openTrustTron" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>🛡️</span> Trust
                    </button>
                </div>
                
                <div class="bg-gray-100 p-3 rounded mb-3">
                    <p class="text-xs text-gray-500 mb-1">Send to this address:</p>
                    <div class="text-xs font-mono break-all text-gray-700">${recipient}</div>
                    <button id="copyAddress" class="text-blue-500 hover:text-blue-700 text-xs mt-2 transition-colors">📋 Copy Address</button>
                </div>
                
                <div class="border-t pt-3">
                    <p class="text-xs text-gray-500 mb-2">Already paid? Enter transaction hash:</p>
                    <input type="text" id="txHashInput" placeholder="Transaction hash..." class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-red-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm transition-colors">✅ Confirm Payment</button>
                </div>
                
                <button id="cancelPayment" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded text-sm mt-2 transition-colors">Cancel</button>
            </div>
        `);

        // Close handlers
        modal.querySelector('#modalCloseX').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        modal.querySelector('#cancelPayment').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };

        // Use TronLink directly
        if (hasTronLink) {
            modal.querySelector('#useTronLink').onclick = () => { 
                modal.remove(); 
                resolve({ success: false, useTronLink: true }); 
            };
        }

        // Open wallet apps
        modal.querySelector('#openTronLink').onclick = () => {
            window.location.href = `tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
                action: 'transfer',
                contract: CONFIG.TRON.USDT_ADDRESS,
                to: recipient,
                amount: (amount * 1e6).toString()
            }))}`;
        };
        
        modal.querySelector('#openTrustTron').onclick = () => {
            window.location.href = `trust://send?asset=c195_tTR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&address=${recipient}&amount=${amount}`;
        };

        // Copy address
        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    const btn = modal.querySelector('#copyAddress');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        // Confirm payment
        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (txHash && /^[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ 
                    success: true, 
                    manual: true, 
                    txHash, 
                    explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` 
                });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };
    });
}

async function waitForWalletProvider(timeout = 3000) {
    return new Promise((resolve) => {
        if (window.ethereum) {
            resolve(true);
            return;
        }
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.ethereum) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                resolve(false);
            }
        }, 100);
    });
}

async function requestWalletConnection() {
    if (!window.ethereum) return false;
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        return accounts && accounts.length > 0;
    } catch (error) {
        console.warn('[Wallet] Connection request failed:', error.message);
        return false;
    }
}

function openWalletApp(walletType = 'metamask') {
    const currentUrl = encodeURIComponent(window.location.href);
    const deepLinks = {
        metamask: `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`,
        trustwallet: `https://link.trustwallet.com/open_url?coin_id=60&url=${currentUrl}`,
        tokenpocket: `tpoutside://open?params=${currentUrl}`,
    };
    return deepLinks[walletType] || deepLinks.metamask;
}

// ======================================================
// 📱  QR CODE IMPLEMENTATION (UPDATED - FIXED FOR BSC)
// ======================================================

/**
 * Create payment QR code content in proper format for wallets
 * @param {string} network - 'BSC' or 'TRON'
 * @param {string} recipient - Wallet address
 * @param {number} amount - Amount in USDT
 * @returns {string} QR code content
 */
function createPaymentQRContent(network, recipient, amount) {
    if (network === 'BSC') {
        // CRITICAL FIX: Use BSC-specific format to avoid ETH confusion
        // Most wallets don't handle EIP-681 well for BSC, so we use simple address
        // with additional info in plain text format that wallets can parse
        
        const amountWei = (amount * 1e18).toString();
        
        // Option 1: BSC-specific format (works with Binance Wallet, Trust Wallet)
        const bscFormat = `bsc:${recipient}?amount=${amount}&token=USDT&contract=${CONFIG.BSC.USDT_ADDRESS}`;
        
        // Option 2: Plain JSON with all details (for wallets that can parse JSON)
        const jsonFormat = JSON.stringify({
            type: "bsc_payment",
            address: recipient,
            amount: amount,
            token: "USDT",
            contract: CONFIG.BSC.USDT_ADDRESS,
            chainId: 56,
            network: "BSC"
        });
        
        // Option 3: Simple text instructions (most compatible)
        const textFormat = `Send ${amount} USDT (BSC/BEP-20)
To: ${recipient}
Token: USDT
Contract: ${CONFIG.BSC.USDT_ADDRESS}
Network: Binance Smart Chain (Chain ID: 56)
Amount: ${amount} USDT`;
        
        // Use BSC format as primary
        console.log('[BSC QR Options]', {
            bscFormat,
            jsonFormat: jsonFormat.substring(0, 100) + '...',
            textFormat: textFormat.substring(0, 100) + '...'
        });
        
        return bscFormat;
        
    } else if (network === 'TRON') {
        // TRON specific format for TronLink and other TRON wallets
        const amountSun = (amount * 1e6).toString();
        return `tron://pay?to=${recipient}&amount=${amountSun}&token=${CONFIG.TRON.USDT_ADDRESS}`;
    }
    
    // Fallback to plain address
    return recipient;
}

/**
 * Generate QR code for payment
 * @param {string} text - Text to encode in QR
 * @param {string} elementId - ID of element to render QR in
 */
function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn('[QR] Element not found:', elementId);
        return;
    }
    
    // Clear element
    element.innerHTML = '';
    element.className = 'qr-code-container';
    
    try {
        // Try to use QRCode.js library if available
        if (typeof QRCode !== 'undefined') {
            const canvas = document.createElement('canvas');
            canvas.className = 'qr-code-canvas';
            canvas.width = 200;
            canvas.height = 200;
            element.appendChild(canvas);
            
            // Generate QR code
            QRCode.toCanvas(canvas, text, {
                width: 180,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#FFFFFF'
                }
            }, (error) => {
                if (error) {
                    console.error('[QR] Canvas generation error:', error);
                    showFallbackQR(element, text);
                } else {
                    // Add click to copy functionality
                    canvas.title = 'Click to copy payment details';
                    canvas.onclick = () => {
                        navigator.clipboard.writeText(text)
                            .then(() => showCryptoAlert('Payment details copied to clipboard!', 'success', 2000))
                            .catch(() => showCryptoAlert('Failed to copy', 'error'));
                    };
                }
            });
        } else {
            // QRCode.js not loaded, use image API fallback
            showFallbackQR(element, text);
        }
    } catch (error) {
        console.error('[QR] Generation error:', error);
        showFallbackQR(element, text);
    }
}

/**
 * Show fallback QR code using external API
 * @param {HTMLElement} element - Element to render in
 * @param {string} text - Text to encode
 */
function showFallbackQR(element, text) {
    const encodedText = encodeURIComponent(text);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=10&data=${encodedText}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.alt = 'QR Code';
    img.style.width = '180px';
    img.style.height = '180px';
    img.className = 'rounded-lg';
    
    img.onerror = () => {
        // Final fallback - show text
        element.innerHTML = `
            <div class="qr-fallback">
                <div class="text-xs text-gray-500 mb-2">QR Code unavailable</div>
                <div class="text-xs font-mono break-all bg-gray-100 p-2 rounded">${text.substring(0, 30)}...</div>
                <button onclick="navigator.clipboard.writeText('${text}').then(() => showCryptoAlert('Copied!', 'success'))" class="text-blue-500 hover:text-blue-700 text-xs mt-2">
                    📋 Copy Payment Details
                </button>
            </div>
        `;
    };
    
    element.appendChild(img);
}

// ======================================================
// 🔔 DISMISSIBLE ALERT SYSTEM
// ======================================================

/**
 * Show a dismissible alert message
 * @param {string} message - The message to display
 * @param {string} type - Alert type: 'success', 'error', 'info', 'warning'
 * @param {number} duration - Auto-dismiss after ms (0 = manual dismiss only)
 * @returns {HTMLElement} The alert element
 */
function showCryptoAlert(message, type = "info", duration = 5000) {
    // Remove any existing alert
    const existingAlert = document.getElementById("crypto-alert");
    if (existingAlert) {
        existingAlert.remove();
    }
    
    // Create alert container
    const alertBox = document.createElement("div");
    alertBox.id = "crypto-alert";
    alertBox.className = `crypto-alert ${type}`;
    
    // Create message span
    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;
    alertBox.appendChild(messageSpan);
    
    // Create close button
    const closeBtn = document.createElement("button");
    closeBtn.className = "crypto-alert-close";
    closeBtn.innerHTML = "×";
    closeBtn.setAttribute("aria-label", "Close alert");
    closeBtn.onclick = () => dismissAlert(alertBox);
    alertBox.appendChild(closeBtn);
    
    document.body.appendChild(alertBox);
    
    // Auto-dismiss after duration
    if (duration > 0) {
        setTimeout(() => dismissAlert(alertBox), duration);
    }
    
    return alertBox;
}

/**
 * Dismiss an alert with animation
 * @param {HTMLElement} alertBox - The alert element to dismiss
 */
function dismissAlert(alertBox) {
    if (!alertBox || !alertBox.parentNode) return;
    
    alertBox.style.animation = "crypto-slide-up 0.3s ease-out forwards";
    setTimeout(() => {
        if (alertBox.parentNode) {
            alertBox.remove();
        }
    }, 300);
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const tronNetwork = await window.tronWeb.trx.getNodeInfo();
                if (tronNetwork && tronNetwork.net) return 'TRON';
            } catch (e) {
                console.debug('TRON detection error:', e);
            }
        }
        
        if (window.ethereum) {
            try {
                const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                if (chainId === '0x38') return 'BSC';
            } catch (e) {
                console.debug('BSC detection error:', e);
            }
        }
    } catch (error) {
        console.warn('Network detection error:', error);
    }
    return null;
}

async function loadWalletConnect() {
    try {
        if (window.EthereumProvider) return window.EthereumProvider;
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = CONFIG.WALLETCONNECT.SRC;
            script.crossOrigin = 'anonymous';
            
            // Set a timeout in case script hangs
            const timeout = setTimeout(() => {
                reject(new PaymentError(
                    'WalletConnect loading timed out. Your browser may be blocking external scripts. Please try the QR code option instead.',
                    ERROR_CODES.PROVIDER_ERROR
                ));
            }, 15000);
            
            script.onload = () => {
                clearTimeout(timeout);
                // Give it a moment for the module to initialize
                setTimeout(() => {
                    if (!window.EthereumProvider) {
                        reject(new PaymentError(
                            'WalletConnect blocked by browser. Please try the QR code option or disable tracking prevention.',
                            ERROR_CODES.PROVIDER_ERROR
                        ));
                        return;
                    }
                    console.log('✅ WalletConnect SDK loaded');
                    resolve(window.EthereumProvider);
                }, 500);
            };
            
            script.onerror = () => {
                clearTimeout(timeout);
                reject(new PaymentError(
                    'Failed to load WalletConnect. Please try the QR code option instead.',
                    ERROR_CODES.PROVIDER_ERROR
                ));
            };
            
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error('WalletConnect loading error:', error);
        throw new PaymentError(
            'WalletConnect unavailable. Please use QR code payment instead.',
            ERROR_CODES.PROVIDER_ERROR,
            { originalError: error }
        );
    }
}

function normalizeProvider(provider) {
    if (provider && typeof provider.request === 'function') {
        return provider;
    }
    if (provider && provider.provider && typeof provider.provider.request === 'function') {
        return provider.provider;
    }
    if (window.ethereum) {
        return window.ethereum;
    }
    throw new PaymentError('No valid provider found', ERROR_CODES.PROVIDER_ERROR);
}

function createEthersProvider(eip1193Provider) {
    if (typeof ethers === 'undefined') {
        throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
    }
    return new ethers.providers.Web3Provider(eip1193Provider);
}

async function connectWalletMobile() {
    try {
        console.debug('[WalletConnect] Loading SDK...');
        const EthereumProvider = await loadWalletConnect();
        
        console.debug('[WalletConnect] Initializing provider...');
        const provider = await EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [CONFIG.BSC.CHAIN_ID],
            showQrModal: true,
            qrModalOptions: { 
                themeMode: 'dark',
                enableExplorer: true 
            },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment",
                url: window.location.origin,
                icons: [
                    `${window.location.origin}/images/logo.png`,
                    `${window.location.origin}/favicon.ico`
                ].filter(Boolean)
            }
        });
        
        console.debug('[WalletConnect] Connecting...');
        await provider.connect();
        
        // ✅ FIX #6: Verify chain after connection
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId !== `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`) {
            console.warn('[WalletConnect] Wrong chain detected:', chainId);
            // Try to switch chain
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}` }]
                });
            } catch (switchError) {
                throw new PaymentError(
                    'Please switch to BSC network in your wallet',
                    ERROR_CODES.NETWORK_ERROR,
                    { currentChain: chainId, requiredChain: '0x38' }
                );
            }
        }
        
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts returned from WalletConnect');
        }
        
        console.debug('[WalletConnect] Connected:', accounts[0]);
        return provider;
    } catch (error) {
        console.error('[WalletConnect] Error:', error);
        throw new PaymentError(
            error.message || 'Failed to connect via WalletConnect',
            ERROR_CODES.WALLET_ERROR,
            { originalError: error }
        );
    }
}

async function ensureBSCNetworkDesktop(eip1193Provider) {
    if (isMobileDevice()) {
        console.debug('[Network] Skipping network switch on mobile');
        return;
    }
    
    try {
        const chainId = await eip1193Provider.request({ method: 'eth_chainId' });
        const targetChainId = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
        
        if (chainId !== targetChainId) {
            try {
                await eip1193Provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetChainId }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await eip1193Provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: targetChainId,
                            chainName: 'Binance Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: [CONFIG.BSC.RPC_URL],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw switchError;
                }
            }
        }
    } catch (error) {
        console.warn('[Network] Switch failed:', error.message);
    }
}

// ======================================================
// 🏦  PAYMENT PROCESSING
// ======================================================

async function initializeCryptoPayment(participantId, voteCount, network) {
    try {
        trackEvent('payment_initiated', { participantId, voteCount, network });
        
        const response = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                network: network.toLowerCase()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new PaymentError(
                errorData.message || 'Backend initialization failed',
                ERROR_CODES.NETWORK_ERROR,
                { status: response.status, ...errorData }
            );
        }

        return await response.json();
    } catch (error) {
        throw new PaymentError(
            error.message || 'Payment initialization failed',
            ERROR_CODES.NETWORK_ERROR,
            { originalError: error }
        );
    }
}

async function executeBSCTransferUnified(eip1193Provider, recipient, amount) {
    try {
        console.debug('[BSC Transfer] Starting unified transfer');
        
        const accounts = await eip1193Provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        console.debug('[BSC Transfer] From:', from);
        
        if (typeof ethers === 'undefined') {
            throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
        }
        
        const BSC_USDT_DECIMALS = 18;
        const amountWei = ethers.utils.parseUnits(amount.toString(), BSC_USDT_DECIMALS);
        
        const iface = new ethers.utils.Interface([
            "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
        
        console.debug('[BSC Transfer] Sending transaction...');
        
        const txHash = await eip1193Provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.BSC.USDT_ADDRESS,
                data: data
            }]
        });
        
        console.debug('[BSC Transfer] TX Hash:', txHash);
        
        return {
            txHash: txHash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}`
        };
    } catch (error) {
        console.error('[BSC Transfer] Error:', error);
        
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        
        throw new PaymentError(
            error.message || 'BSC transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function executeTronTransfer(recipient, amount) {
    try {
        if (!window.tronWeb || !window.tronWeb.ready) {
            throw new PaymentError('TronWeb not available', ERROR_CODES.PROVIDER_ERROR);
        }

        const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
        
        const TRON_USDT_DECIMALS = 6;
        const amountSun = Math.floor(amount * Math.pow(10, TRON_USDT_DECIMALS));
        
        const tx = await contract.transfer(recipient, amountSun).send();

        if (!tx || !tx.transaction || !tx.transaction.txID) {
            throw new PaymentError('TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
        }

        return {
            txHash: tx.transaction.txID,
            network: 'TRON',
            explorerUrl: `${CONFIG.TRON.EXPLORER}${tx.transaction.txID}`
        };
    } catch (error) {
        throw new PaymentError(
            error.message || 'TRON transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function finalizePayment(txHash, network) {
    try {
        const response = await fetch('/api/onedream/finalize-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction_hash: txHash,
                network: network.toLowerCase()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new PaymentError(
                errorData.message || 'Payment finalization failed',
                ERROR_CODES.NETWORK_ERROR,
                { status: response.status, ...errorData }
            );
        }

        return await response.json();
    } catch (error) {
        throw new PaymentError(
            error.message || 'Payment finalization failed',
            ERROR_CODES.NETWORK_ERROR,
            { originalError: error }
        );
    }
}

// ======================================================
// 🧩  UI COMPONENTS (Updated with proper close handlers)
// ======================================================

function createModal(content, className = '') {
    const modal = document.createElement('div');
    modal.className = `fixed inset-0 bg-black/80 flex items-center justify-center z-50 ${className}`;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    
    // ✅ FIX: Add click-outside-to-close functionality
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            // Clicking the backdrop closes the modal
            modal.remove();
        }
    });
    
    return modal;
}

function showPaymentStatusModal(network, amount) {
    const modal = createModal(`
        <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw] relative">
            <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
            <div class="flex justify-between items-center mb-3 pr-6">
                <h3 class="font-bold text-lg">${network} USDT Payment</h3>
                <span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'BSC' ? 'BEP-20' : 'TRC-20'}</span>
            </div>
            
            <!-- Clear amount display -->
            <div class="bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg mb-4 border border-blue-200">
                <div class="text-2xl font-bold text-gray-800">${amount} USDT</div>
                <div class="text-sm text-gray-600 mt-1">on ${network === 'BSC' ? 'Binance Smart Chain' : 'TRON Network'}</div>
            </div>
            
            <div id="statusText" class="min-h-6 mb-4 text-sm">Initializing payment...</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden">
                <p class="text-xs text-gray-500 mb-1">Transaction confirmed!</p>
                <a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline inline-flex items-center gap-1">
                    <span>🔗</span> View on explorer →
                </a>
            </div>
            <button id="closeModal" class="mt-4 text-gray-500 hover:text-gray-700 text-sm transition-colors">Close</button>
        </div>
    `);
    
    // ✅ FIX: Attach close handlers
    const closeX = modal.querySelector('#modalCloseX');
    const closeBtn = modal.querySelector('#closeModal');
    
    if (closeX) {
        closeX.onclick = () => modal.remove();
    }
    if (closeBtn) {
        closeBtn.onclick = () => modal.remove();
    }
    
    return modal;
}

// ======================================================
// 📊  MODAL STATUS HELPER FUNCTIONS
// ======================================================

function updateStatus(modal, text) {
    const element = modal.querySelector('#statusText');
    if (element) element.textContent = text;
}

function successStatus(modal, txHash, explorerUrl) {
    updateStatus(modal, '✅ Payment confirmed');
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
    
    const txLink = modal.querySelector('#txLink');
    if (txLink) {
        const link = txLink.querySelector('a');
        if (link) link.href = explorerUrl;
        txLink.classList.remove('hidden');
    }
    
    // Auto-close after 5 seconds
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, error) {
    let message = error.message || 'Payment failed';
    
    // Provide user-friendly message for common errors
    if (error.message && error.message.includes('ethers.BrowserProvider')) {
        message = 'Wallet connection error - please refresh and try again';
    }
    
    updateStatus(modal, `❌ ${message}`);
    
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
    
    const closeBtn = modal.querySelector('#closeModal');
    if (closeBtn) closeBtn.classList.remove('hidden');
}

function showNetworkSelectionModal(preferredNetwork) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl w-80 text-center relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-4 pr-6">Choose Network</h3>
                <div class="mb-4">
                    <button id="bsc" class="w-full bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 py-4 rounded-lg mb-3 flex flex-col items-center justify-center gap-1 transition-all shadow-md">
                        <span class="text-lg">🟡</span>
                        <span class="font-bold">BSC (BEP-20)</span>
                        <span class="text-xs text-gray-700">USDT on Binance Smart Chain</span>
                        ${preferredNetwork === 'BSC' ? '<span class="text-xs text-green-600 font-medium mt-1">✓ Network Detected</span>' : ''}
                    </button>
                    <button id="tron" class="w-full bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white py-4 rounded-lg flex flex-col items-center justify-center gap-1 transition-all shadow-md">
                        <span class="text-lg">🔴</span>
                        <span class="font-bold">TRON (TRC-20)</span>
                        <span class="text-xs">USDT on TRON Network</span>
                        ${preferredNetwork === 'TRON' ? '<span class="text-xs text-green-200 font-medium mt-1">✓ Network Detected</span>' : ''}
                    </button>
                </div>
                <button id="cancel" class="mt-2 text-gray-500 hover:text-gray-700 text-sm transition-colors">Cancel</button>
            </div>
        `);

        // ✅ FIX: Attach all close/cancel handlers
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve(null); };
        }
        
        modal.querySelector('#bsc').onclick = () => { modal.remove(); resolve('BSC'); };
        modal.querySelector('#tron').onclick = () => { modal.remove(); resolve('TRON'); };
        modal.querySelector('#cancel').onclick = () => { modal.remove(); resolve(null); };

        if (preferredNetwork) {
            setTimeout(() => {
                const el = modal.querySelector(`#${preferredNetwork.toLowerCase()}`);
                if (el) el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
            }, 100);
        }
    });
}

// ======================================================
// 🖥️  DESKTOP WALLET MODAL
// ======================================================

function showDesktopWalletModal() {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">📱 Choose Payment Method</h3>
                <p class="text-sm text-gray-600 mb-4">How would you like to pay?</p>
                <button id="useWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2 flex items-center justify-center gap-2 transition-colors">
                    <span>🔗</span> WalletConnect (Recommended)
                </button>
                <button id="useQR" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2 flex items-center justify-center gap-2 transition-colors">
                    <span>📱</span> Pay via QR Code
                </button>
                <button id="goBack" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded mt-2 transition-colors">← Back</button>
            </div>
        `);

        // ✅ FIX: Attach close handler
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve(null); };
        }

        modal.querySelector('#useWalletConnect').onclick = () => { modal.remove(); resolve('walletconnect'); };
        modal.querySelector('#useQR').onclick = () => { modal.remove(); resolve('qr'); };
        modal.querySelector('#goBack').onclick = () => { modal.remove(); resolve('back'); };
    });
}

// ======================================================
// 🔄  UPDATED BSC MANUAL MODAL (FIXED - Clear BSC USDT display)
// ======================================================

async function showBSCManualModal(recipient, amount, isDesktop = false) {
    // Load QR code library first
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const hasBrowserWallet = window.ethereum || window.BinanceChain;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                
                <!-- Header with clear BSC indication -->
                <div class="flex items-center justify-center gap-2 mb-3">
                    <div class="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-bold">BSC</div>
                    <h3 class="font-bold text-lg">USDT Payment</h3>
                </div>
                
                <!-- Prominent Amount Display -->
                <div class="bg-gradient-to-r from-yellow-100 to-yellow-50 border-2 border-yellow-300 p-4 rounded-lg mb-4">
                    <div class="text-3xl font-bold text-gray-800">${amount} USDT</div>
                    <div class="text-sm text-yellow-700 font-medium mt-1">BEP-20 on Binance Smart Chain</div>
                </div>
                
                <!-- Clear payment address -->
                <p class="text-sm font-medium mb-2">Send to this BSC address:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-300 bg-yellow-50">${recipient}</div>
                
                <!-- QR Code -->
                <div id="bscQR" class="mx-auto mb-4"></div>
                <p class="text-xs text-gray-500 mb-1">Scan QR with wallet app</p>
                
                <!-- Clear instructions -->
                <div class="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-3 text-left">
                    <p class="text-xs font-semibold text-blue-800 mb-2">📋 How to pay:</p>
                    <ol class="text-xs text-blue-700 list-decimal pl-4 space-y-1">
                        <li>Scan QR or copy address above</li>
                        <li>Open your wallet (MetaMask, Trust, Binance, etc.)</li>
                        <li><strong>Switch to BSC network</strong> if not already</li>
                        <li>Select <strong>USDT (BEP-20)</strong> token</li>
                        <li>Enter amount: <strong>${amount} USDT</strong></li>
                        <li>Review and confirm transaction</li>
                    </ol>
                </div>
                
                <!-- Warning -->
                <div class="bg-red-50 border border-red-200 p-2 rounded mb-3">
                    <p class="text-xs text-red-600 font-medium">⚠️ Only send USDT on BSC network (BEP-20)!</p>
                    <p class="text-xs text-red-500">Do not send ETH or other tokens to this address.</p>
                </div>
                
                <!-- Action buttons -->
                <div class="grid grid-cols-2 gap-2 mb-4">
                    <button id="copyAddress" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm transition-colors flex items-center justify-center gap-1">
                        <span>📋</span> Copy Address
                    </button>
                    <button id="viewOnBscScan" class="bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-sm transition-colors flex items-center justify-center gap-1">
                        <span>🔍</span> Verify on BscScan
                    </button>
                </div>
                
                ${isDesktop && hasBrowserWallet ? `
                <div class="border-t border-b py-3 my-3">
                    <p class="text-sm font-medium mb-2">💻 Connect Browser Wallet:</p>
                    <button id="connectBrowserWallet" class="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded mb-2 flex items-center justify-center gap-2 transition-colors">
                        <span>🦊</span> Connect MetaMask (Direct Payment)
                    </button>
                    <p class="text-xs text-gray-500">Use browser extension to pay directly without QR code</p>
                </div>
                ` : ''}
                
                <!-- Transaction hash input -->
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (0x...)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid ${amount} USDT</button>
                </div>
                <button id="closeBSC" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        // Generate QR code with BSC-specific format
        const qrContent = createPaymentQRContent('BSC', recipient, amount);
        console.log('[BSC QR] Content:', qrContent);
        console.log('[BSC Payment Details]', {
            amount: amount + ' USDT',
            network: 'BSC (Binance Smart Chain)',
            standard: 'BEP-20',
            recipient: recipient,
            contract: CONFIG.BSC.USDT_ADDRESS,
            chainId: 56
        });
        generateQR(qrContent, 'bscQR');

        // ✅ FIX: Attach close handler
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        }

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    showCryptoAlert('BSC address copied to clipboard!', 'success', 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        modal.querySelector('#viewOnBscScan').onclick = () => {
            window.open(`https://bscscan.com/address/${recipient}`, '_blank');
        };

        // Browser wallet connection (for desktop only)
        if (isDesktop && hasBrowserWallet) {
            modal.querySelector('#connectBrowserWallet').onclick = () => {
                modal.remove();
                resolve({ success: false, connectBrowserWallet: true });
            };
        }

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm(`No transaction hash entered. Are you sure you have already sent ${amount} USDT on BSC network?`)) {
                    return;
                }
            }
            
            modal.remove();
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format (should start with 0x and be 64 characters)', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeBSC').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

// ======================================================
// 🔄  UPDATED TRON MANUAL MODAL
// ======================================================

async function showTronManualModal(recipient, amount) {
    // Load QR code library first
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                
                <!-- Header with clear TRON indication -->
                <div class="flex items-center justify-center gap-2 mb-3">
                    <div class="bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">TRON</div>
                    <h3 class="font-bold text-lg">USDT Payment</h3>
                </div>
                
                <!-- Prominent Amount Display -->
                <div class="bg-gradient-to-r from-red-100 to-red-50 border-2 border-red-300 p-4 rounded-lg mb-4">
                    <div class="text-3xl font-bold text-gray-800">${amount} USDT</div>
                    <div class="text-sm text-red-700 font-medium mt-1">TRC-20 on TRON Network</div>
                </div>
                
                <!-- Clear payment address -->
                <p class="text-sm font-medium mb-2">Send to this TRON address:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-300 bg-red-50">${recipient}</div>
                
                <!-- QR Code -->
                <div id="tronQR" class="mx-auto mb-4"></div>
                <p class="text-xs text-gray-500 mb-1">Scan QR with Tron wallet</p>
                
                <!-- Clear instructions -->
                <div class="bg-blue-50 border border-blue-200 p-3 rounded-lg mb-3 text-left">
                    <p class="text-xs font-semibold text-blue-800 mb-2">📋 How to pay:</p>
                    <ol class="text-xs text-blue-700 list-decimal pl-4 space-y-1">
                        <li>Scan QR or copy address above</li>
                        <li>Open TronLink or other TRON wallet</li>
                        <li>Select <strong>USDT (TRC-20)</strong> token</li>
                        <li>Enter amount: <strong>${amount} USDT</strong></li>
                        <li>Review and confirm transaction</li>
                    </ol>
                </div>
                
                <!-- Warning -->
                <div class="bg-red-50 border border-red-200 p-2 rounded mb-3">
                    <p class="text-xs text-red-600 font-medium">⚠️ Only send USDT on TRON network (TRC-20)!</p>
                    <p class="text-xs text-red-500">Do not send TRX or other tokens to this address.</p>
                </div>
                
                <!-- Action buttons -->
                <button id="copyAddress" class="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm mb-3 transition-colors flex items-center justify-center gap-1">
                    <span>📋</span> Copy TRON Address
                </button>
                
                <!-- Transaction hash input -->
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (64 chars)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid ${amount} USDT</button>
                </div>
                <button id="closeTron" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        // Generate QR code with proper TRON payment format
        const qrContent = createPaymentQRContent('TRON', recipient, amount);
        console.log('[TRON QR] Content:', qrContent);
        generateQR(qrContent, 'tronQR');

        // ✅ FIX: Attach close handler
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        }

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    const btn = modal.querySelector('#copyAddress');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy TRON Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm(`No transaction hash entered. Are you sure you have already sent ${amount} USDT on TRON network?`)) {
                    return;
                }
            }
            
            modal.remove();
            if (txHash && /^[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format (should be 64 characters)', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeTron').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

// ======================================================
// 🚀  MAIN ENTRY POINT
// ======================================================

async function initiateCryptoPayment(participantId, voteCount, amount) {
    let modal = null;
    
    try {
        // Validate inputs
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        // Detect preferred network
        const preferredNetwork = await detectPreferredNetwork();
        
        // Show network selection
        const selectedNetwork = await showNetworkSelectionModal(preferredNetwork);
        if (!selectedNetwork) {
            return { success: false, cancelled: true };
        }
        
        // Get wallet address based on network
        const recipient = selectedNetwork === 'BSC' 
            ? CONFIG.BSC.WALLET_ADDRESS 
            : CONFIG.TRON.WALLET_ADDRESS;
        
        // For BSC: Show different options for mobile vs desktop
        if (selectedNetwork === 'BSC') {
            const isMobile = isMobileDevice();
            const isInWalletBrowser = isInAppBrowser();
            
            // If we're inside a wallet's browser, use the injected provider directly
            if (isInWalletBrowser && window.ethereum) {
                console.log('[Payment] Detected in-app wallet browser, using injected provider');
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Connecting wallet...');
                
                try {
                    const connected = await requestWalletConnection();
                    if (!connected) {
                        throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                    }
                    
                    await ensureBSCNetworkDesktop(window.ethereum);
                    
                    updateStatus(modal, 'Confirm in wallet...');
                    const result = await executeBSCTransferUnified(window.ethereum, recipient, amount);
                    
                    updateStatus(modal, 'Finalizing...');
                    await finalizePayment(result.txHash, selectedNetwork);
                    
                    successStatus(modal, result.txHash, result.explorerUrl);
                    
                    return { 
                        success: true, 
                        ...result,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: result.txHash
                    };
                } catch (walletError) {
                    if (modal) modal.remove();
                    throw walletError;
                }
            }
            
            // Mobile device - show mobile wallet modal with deep links
            if (isMobile) {
                const mobileResult = await showMobileWalletModal(selectedNetwork, recipient, amount);
                
                if (mobileResult.cancelled) {
                    return { success: false, cancelled: true };
                }
                
                // User wants to use injected wallet
                if (mobileResult.useInjected && window.ethereum) {
                    modal = showPaymentStatusModal(selectedNetwork, amount);
                    updateStatus(modal, 'Connecting wallet...');
                    
                    try {
                        const connected = await requestWalletConnection();
                        if (!connected) {
                            throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                        }
                        
                        await ensureBSCNetworkDesktop(window.ethereum);
                        
                        updateStatus(modal, 'Confirm in wallet...');
                        const result = await executeBSCTransferUnified(window.ethereum, recipient, amount);
                        
                        updateStatus(modal, 'Finalizing...');
                        await finalizePayment(result.txHash, selectedNetwork);
                        
                        successStatus(modal, result.txHash, result.explorerUrl);
                        
                        return { 
                            success: true, 
                            ...result,
                            participant_id: participantId,
                            payment_amount: amount,
                            payment_intent_id: result.txHash
                        };
                    } catch (walletError) {
                        if (modal) modal.remove();
                        throw walletError;
                    }
                }
                
                // User chose "Other" - show manual payment
                if (mobileResult.showManual) {
                    const manualResult = await showBSCManualModal(recipient, amount, false);
                    if (manualResult.success) {
                        return {
                            ...manualResult,
                            participant_id: participantId,
                            payment_amount: amount,
                            payment_intent_id: manualResult.txHash || `manual_${Date.now()}`
                        };
                    }
                    return manualResult;
                }
                
                // User confirmed payment with tx hash
                if (mobileResult.success) {
                    return {
                        ...mobileResult,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: mobileResult.txHash || `manual_${Date.now()}`
                    };
                }
                
                return mobileResult;
            }
            
            // DESKTOP: Go directly to QR modal with browser wallet option
            const manualResult = await showBSCManualModal(recipient, amount, true);
            
            // User cancelled
            if (manualResult.cancelled) {
                return { success: false, cancelled: true };
            }
            
            // If user clicked "Connect MetaMask" button in QR modal
            if (manualResult.connectBrowserWallet) {
                // User chose to connect browser wallet - proceed with payment
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Connecting browser wallet...');
                
                try {
                    const connected = await requestWalletConnection();
                    if (!connected) {
                        throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                    }
                    
                    await ensureBSCNetworkDesktop(window.ethereum);
                    
                    updateStatus(modal, 'Confirm in wallet...');
                    const result = await executeBSCTransferUnified(window.ethereum, recipient, amount);
                    
                    updateStatus(modal, 'Finalizing...');
                    await finalizePayment(result.txHash, selectedNetwork);
                    
                    successStatus(modal, result.txHash, result.explorerUrl);
                    
                    return { 
                        success: true, 
                        ...result,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: result.txHash
                    };
                } catch (walletError) {
                    if (modal) modal.remove();
                    throw walletError;
                }
            }
            
            // User submitted manual payment confirmation
            if (manualResult.success) {
                return {
                    ...manualResult,
                    participant_id: participantId,
                    payment_amount: amount,
                    payment_intent_id: manualResult.txHash || `manual_${Date.now()}`
                };
            }
            
            return manualResult;
        }
        
        // TRON network handling
        const hasTronWallet = window.tronWeb && window.tronWeb.ready;
        const isMobileTron = isMobileDevice();
        
        // Mobile TRON handling
        if (isMobileTron) {
            // Check if in TronLink app browser
            if (hasTronWallet) {
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Confirm in TronLink...');
                const result = await executeTronTransfer(recipient, amount);
                
                updateStatus(modal, 'Finalizing...');
                await finalizePayment(result.txHash, selectedNetwork);
                
                successStatus(modal, result.txHash, result.explorerUrl);
                
                return { 
                    success: true, 
                    ...result,
                    participant_id: participantId,
                    payment_amount: amount,
                    payment_intent_id: result.txHash
                };
            }
            
            // Show mobile TRON wallet modal with deep links
            const mobileResult = await showMobileTronWalletModal(recipient, amount);
            
            if (mobileResult.useTronLink) {
                // User chose to use TronLink (in-app browser)
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Confirm in TronLink...');
                const result = await executeTronTransfer(recipient, amount);
                
                updateStatus(modal, 'Finalizing...');
                await finalizePayment(result.txHash, selectedNetwork);
                
                successStatus(modal, result.txHash, result.explorerUrl);
                
                return { 
                    success: true, 
                    ...result,
                    participant_id: participantId,
                    payment_amount: amount,
                    payment_intent_id: result.txHash
                };
            }
            
            if (mobileResult.success) {
                return {
                    ...mobileResult,
                    participant_id: participantId,
                    payment_amount: amount,
                    payment_intent_id: mobileResult.txHash || `manual_${Date.now()}`
                };
            }
            
            return mobileResult;
        }
        
        // Desktop TRON handling
        if (!hasTronWallet) {
            // No TronLink - show manual QR modal
            const manualResult = await showTronManualModal(recipient, amount);
            
            if (manualResult.success) {
                return {
                    ...manualResult,
                    participant_id: participantId,
                    payment_amount: amount,
                    payment_intent_id: manualResult.txHash || `manual_${Date.now()}`
                };
            }
            return manualResult;
        }
        
        // TronLink is available - proceed with transaction
        modal = showPaymentStatusModal(selectedNetwork, amount);
        updateStatus(modal, 'Confirm in TronLink...');
        const result = await executeTronTransfer(recipient, amount);
        
        updateStatus(modal, 'Finalizing...');
        await finalizePayment(result.txHash, selectedNetwork);
        
        successStatus(modal, result.txHash, result.explorerUrl);
        
        return { 
            success: true, 
            ...result,
            participant_id: participantId,
            payment_amount: amount,
            payment_intent_id: result.txHash
        };
        
    } catch (error) {
        console.error('[CryptoPayment] Error:', error);
        
        if (modal) {
            errorStatus(modal, error);
        } else {
            showCryptoAlert(error.message || 'Payment failed. Please try again.', 'error');
        }
        
        trackEvent('payment_error', { 
            error: error.message, 
            code: error.code,
            participantId 
        });
        
        return { success: false, error: error.message };
    }
}

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.processCryptoPayment = initiateCryptoPayment; // ✅ Alias for vote-payments.js compatibility
window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    process: initiateCryptoPayment, // ✅ Alias
    showBSCManualModal,
    showTronManualModal,
    showNetworkSelectionModal,
    showAlert: showCryptoAlert,  // ✅ Export alert function
    dismissAlert,                 // ✅ Export dismiss function
    generateQR,                   // ✅ Export QR function
    createPaymentQRContent,       // ✅ Export QR content creator
    loadQRCodeLibrary,            // ✅ Export QR library loader
    CONFIG,
    ERROR_CODES
};

// ✅ Set ready flag for external scripts to check
window.CryptoPaymentsReady = true;

// ✅ Dispatch custom event to notify listeners that module is loaded
document.dispatchEvent(new CustomEvent('cryptoPaymentsReady'));

console.log('✅ Crypto Payments module loaded with BSC USDT support (no ETH confusion)');