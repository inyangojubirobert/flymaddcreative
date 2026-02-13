// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

// Check if we're in a browser environment
// Check if ethers is available

if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}
if (typeof ethers === 'undefined') {
    console.warn('⚠️ Ethers.js not loaded - BSC transfers will fail');
    // Load ethers dynamically if needed
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
    document.head.appendChild(script);
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
// ✅ FIXED: QRCode library loader
function loadQRCodeLibrary() {
    return new Promise((resolve, reject) => {
        // Check if already loaded
        if (typeof QRCode !== 'undefined') {
            console.log('✅ QRCode library already loaded');
            resolve();
            return;
        }
        
        // Try multiple CDNs
        const cdnUrls = [
            'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
            'https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js'
        ];
        
        let currentIndex = 0;
        
        function tryLoadNext() {
            if (currentIndex >= cdnUrls.length) {
                console.warn('⚠️ All QR CDNs failed, using fallback');
                resolve(); // Still resolve to use fallback
                return;
            }
            
            const script = document.createElement('script');
            script.src = cdnUrls[currentIndex];
            script.crossOrigin = 'anonymous';
            
            script.onload = () => {
                console.log(`✅ QRCode loaded from CDN ${currentIndex + 1}`);
                resolve();
            };
            
            script.onerror = () => {
                console.warn(`❌ CDN ${currentIndex + 1} failed, trying next...`);
                currentIndex++;
                tryLoadNext();
            };
            
            document.head.appendChild(script);
        }
        
        tryLoadNext();
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
}

function getWalletDeepLinks(network, recipient, amount) {
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
        walletconnect: `wc:`
    };
}

// ======================================================
// 📱  MOBILE WALLET MODALS (BSC & TRON) - INTACT
// ======================================================

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

        modal.querySelector('#modalCloseX').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        modal.querySelector('#cancelPayment').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };

        if (hasInjectedWallet) {
            modal.querySelector('#useInjectedWallet').onclick = () => { 
                modal.remove(); 
                resolve({ success: false, useInjected: true }); 
            };
        }

        modal.querySelector('#openMetaMask').onclick = () => {
            window.location.href = deepLinks.metamask;
        };
        
        modal.querySelector('#openTrust').onclick = () => {
            window.location.href = deepLinks.trust;
        };
        
        modal.querySelector('#openTokenPocket').onclick = () => {
            window.location.href = deepLinks.tokenpocket;
        };
        
        modal.querySelector('#openOther').onclick = () => {
            modal.remove();
            resolve({ success: false, showManual: true });
        };

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

        modal.querySelector('#modalCloseX').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        modal.querySelector('#cancelPayment').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };

        if (hasTronLink) {
            modal.querySelector('#useTronLink').onclick = () => { 
                modal.remove(); 
                resolve({ success: false, useTronLink: true }); 
            };
        }

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

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    const btn = modal.querySelector('#copyAddress');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

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

// ======================================================
// 🆕  WALLETCONNECT FUNCTIONS (DESKTOP)
// ======================================================

// ============ BSC WALLETCONNECT ============
async function initBSCWalletConnect() {
    try {
        if (typeof window.EthereumProvider === 'undefined') {
            await loadWalletConnect();
        }
        
        if (!window.EthereumProvider) {
            throw new PaymentError(
                'WalletConnect not available. Please refresh and try again.',
                ERROR_CODES.PROVIDER_ERROR
            );
        }
        
        const provider = await window.EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [CONFIG.BSC.CHAIN_ID],
            showQrModal: true,
            qrModalOptions: {
                themeMode: 'light',
                enableExplorer: true,
                description: 'Connect your wallet to pay with BSC USDT'
            },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT BEP-20 Payment",
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.ico`]
            }
        });
        
        return provider;
        
    } catch (error) {
        console.error('[BSC WalletConnect] Init error:', error);
        throw new PaymentError(
            'Failed to initialize WalletConnect for BSC',
            ERROR_CODES.PROVIDER_ERROR,
            { originalError: error }
        );
    }
}

async function executeBSCWalletConnectTransfer(provider, recipient, amount) {
    try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        if (typeof ethers === 'undefined') {
            throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
        }
        
        const BSC_USDT_DECIMALS = 18;
        const amountWei = ethers.utils.parseUnits(amount.toString(), BSC_USDT_DECIMALS);
        
        const iface = new ethers.utils.Interface([
            "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
        
        const txHash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.BSC.USDT_ADDRESS,
                data: data
            }]
        });
        
        return {
            txHash: txHash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}`
        };
    } catch (error) {
        console.error('[BSC WalletConnect] Transfer error:', error);
        
        if (error.code === 4001 || error.message?.includes('rejected')) {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        
        throw new PaymentError(
            error.message || 'BSC USDT transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

function showBSCWalletConnectModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">🔗 BSC USDT via WalletConnect</h3>
                
                <div class="bg-gradient-to-r from-yellow-100 to-yellow-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-gray-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-gray-600">BEP-20 Network</div>
                </div>
                
                <div class="bg-blue-50 p-4 rounded-lg mb-4">
                    <div class="flex items-center justify-center mb-2">
                        <span class="text-3xl">🔗</span>
                    </div>
                    <p class="text-sm font-medium text-blue-800 mb-2">Connect with WalletConnect</p>
                    <p class="text-xs text-blue-600 mb-3">
                        Works with MetaMask, Trust Wallet, TokenPocket, and more
                    </p>
                    <button id="startWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition-colors shadow-md">
                        🔗 Connect Wallet
                    </button>
                </div>
                
                <div class="border-t border-b py-3 my-2">
                    <p class="text-xs text-gray-500 mb-2">📋 Payment details:</p>
                    <div class="text-xs text-left">
                        <div class="flex justify-between mb-1">
                            <span class="text-gray-600">Recipient:</span>
                            <span class="font-mono text-gray-800 truncate max-w-[180px]" title="${recipient}">
                                ${recipient.substring(0, 10)}...${recipient.substring(recipient.length - 8)}
                            </span>
                        </div>
                        <div class="flex justify-between mb-1">
                            <span class="text-gray-600">Token:</span>
                            <span class="text-yellow-600">USDT (BEP-20)</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Amount:</span>
                            <span class="font-bold">${amount} USDT</span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-2">
                    <button id="cancelWalletConnect" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded text-sm transition-colors">
                        Cancel
                    </button>
                </div>
            </div>
        `);
        
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { 
                modal.remove(); 
                resolve({ success: false, cancelled: true }); 
            };
        }
        
        const startBtn = modal.querySelector('#startWalletConnect');
        if (startBtn) {
            startBtn.onclick = () => {
                modal.remove();
                resolve({ success: true, method: 'walletconnect' });
            };
        }
        
        const cancelBtn = modal.querySelector('#cancelWalletConnect');
        if (cancelBtn) {
            cancelBtn.onclick = () => { 
                modal.remove(); 
                resolve({ success: false, cancelled: true }); 
            };
        }
    });
}

// ============ TRON WALLETCONNECT ============
async function initTronWalletConnect() {
    try {
        if (typeof window.EthereumProvider === 'undefined') {
            await loadWalletConnect();
        }
        
        if (!window.EthereumProvider) {
            throw new PaymentError(
                'WalletConnect not available. Please refresh and try again.',
                ERROR_CODES.PROVIDER_ERROR
            );
        }
        
        const provider = await window.EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [1], // Ethereum mainnet (works for TRON via WalletConnect)
            showQrModal: true,
            qrModalOptions: {
                themeMode: 'light',
                enableExplorer: true,
                description: 'Connect your TRON wallet (TronLink, Trust, TokenPocket)'
            },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT TRC-20 Payment",
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.ico`]
            }
        });
        
        return provider;
        
    } catch (error) {
        console.error('[TRON WalletConnect] Init error:', error);
        throw new PaymentError(
            'Failed to initialize WalletConnect for TRON',
            ERROR_CODES.PROVIDER_ERROR,
            { originalError: error }
        );
    }
}

async function executeTronWalletConnectTransfer(provider, recipient, amount) {
    try {
        const transferSignature = '0xa9059cbb';
        const TRON_USDT_DECIMALS = 6;
        const amountSun = BigInt(Math.round(parseFloat(amount) * 10 ** TRON_USDT_DECIMALS));
        
        let recipientHex = recipient;
        if (recipientHex.startsWith('T') && window.tronWeb) {
            recipientHex = window.tronWeb.address.toHex(recipient);
        } else {
            recipientHex = recipient;
        }
        
        const recipientPadded = recipientHex.padStart(64, '0');
        const amountPadded = amountSun.toString(16).padStart(64, '0');
        const data = transferSignature + recipientPadded + amountPadded;
        
        const accounts = await provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        const txHash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.TRON.USDT_ADDRESS,
                data: data,
                value: '0x0'
            }]
        });
        
        const tronTxHash = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
        
        console.log('[TRON WalletConnect] Transaction sent:', {
            txHash: txHash,
            tronHash: tronTxHash,
            explorerUrl: `${CONFIG.TRON.EXPLORER}${tronTxHash}`
        });
        
        return {
            txHash: tronTxHash,
            network: 'TRON',
            explorerUrl: `${CONFIG.TRON.EXPLORER}${tronTxHash}`,
            rawTxHash: txHash
        };
        
    } catch (error) {
        console.error('[TRON WalletConnect] Transfer error:', error);
        
        if (error.code === 4001 || error.message?.includes('rejected')) {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        
        throw new PaymentError(
            error.message || 'TRON USDT transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

function showTronWalletConnectModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">🔗 TRON USDT via WalletConnect</h3>
                
                <div class="bg-gradient-to-r from-red-100 to-red-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-red-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-red-600">TRC-20 Network</div>
                </div>
                
                <div class="bg-blue-50 p-4 rounded-lg mb-4">
                    <div class="flex items-center justify-center mb-2">
                        <span class="text-3xl">🔗</span>
                    </div>
                    <p class="text-sm font-medium text-blue-800 mb-2">Connect with WalletConnect</p>
                    <p class="text-xs text-blue-600 mb-3">
                        Works with TronLink, Trust Wallet, TokenPocket, and more
                    </p>
                    <button id="startWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition-colors shadow-md">
                        🔗 Connect Wallet
                    </button>
                </div>
                
                <div class="border-t border-b py-3 my-2">
                    <p class="text-xs text-gray-500 mb-2">📋 Payment details:</p>
                    <div class="text-xs text-left">
                        <div class="flex justify-between mb-1">
                            <span class="text-gray-600">Recipient:</span>
                            <span class="font-mono text-gray-800 truncate max-w-[180px]" title="${recipient}">
                                ${recipient.substring(0, 10)}...${recipient.substring(recipient.length - 8)}
                            </span>
                        </div>
                        <div class="flex justify-between mb-1">
                            <span class="text-gray-600">Token:</span>
                            <span class="text-red-600">USDT (TRC-20)</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600">Amount:</span>
                            <span class="font-bold">${amount} USDT</span>
                        </div>
                    </div>
                </div>
                
                <div class="mt-2">
                    <button id="cancelWalletConnect" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 py-2 rounded text-sm transition-colors">
                        Cancel
                    </button>
                </div>
            </div>
        `);
        
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { 
                modal.remove(); 
                resolve({ success: false, cancelled: true }); 
            };
        }
        
        const startBtn = modal.querySelector('#startWalletConnect');
        if (startBtn) {
            startBtn.onclick = () => {
                modal.remove();
                resolve({ success: true, method: 'walletconnect' });
            };
        }
        
        const cancelBtn = modal.querySelector('#cancelWalletConnect');
        if (cancelBtn) {
            cancelBtn.onclick = () => { 
                modal.remove(); 
                resolve({ success: false, cancelled: true }); 
            };
        }
    });
}

// ======================================================
// 📱  QR CODE IMPLEMENTATION
// ======================================================

function createPaymentQRContent(network, recipient, amount) {
    if (network === 'BSC') {
        return recipient; // Simple address for BSC
    } 
    else if (network === 'TRON') {
        // ✅ CORRECT: USDT TRC-20 format
        const amountSun = Math.floor(amount * 1e6).toString();
        
        // TronLink format (most compatible)
        return `tron:${CONFIG.TRON.USDT_ADDRESS}?function=transfer(address,uint256)&args=${recipient},${amountSun}`;
    }
    return recipient;
}
// ✅ FIXED: QR code generator with fallback
function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn('[QR] Element not found:', elementId);
        return;
    }
    
    element.innerHTML = '';
    element.className = 'qr-code-container';
    
    const wrapper = document.createElement('div');
    wrapper.className = 'text-center';
    
    const qrTitle = document.createElement('p');
    qrTitle.className = 'text-xs text-gray-500 mb-2';
    qrTitle.textContent = 'Scan with wallet app';
    
    const qrContainer = document.createElement('div');
    qrContainer.id = elementId + '_container';
    qrContainer.className = 'qr-code-container';
    
    wrapper.appendChild(qrTitle);
    wrapper.appendChild(qrContainer);
    element.appendChild(wrapper);
    
    const displayElement = document.getElementById(elementId + '_container');
    
    // Try QRCode library first
    if (typeof QRCode !== 'undefined') {
        try {
            // Check which API is available
            if (typeof QRCode.toCanvas === 'function') {
                const canvas = document.createElement('canvas');
                canvas.className = 'qr-code-canvas';
                canvas.width = 180;
                canvas.height = 180;
                displayElement.appendChild(canvas);
                
                QRCode.toCanvas(canvas, text, {
                    width: 160,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                }, (error) => {
                    if (error) {
                        console.error('[QR] Canvas error:', error);
                        useQRServerFallback(displayElement, text);
                    } else {
                        canvas.title = 'Click to copy';
                        canvas.onclick = () => copyToClipboard(text);
                    }
                });
            } 
            else if (typeof QRCode.toString === 'function') {
                // Alternative API
                const qrImage = QRCode.toString(text, { type: 'svg' });
                displayElement.innerHTML = qrImage;
            }
            else {
                useQRServerFallback(displayElement, text);
            }
        } catch (error) {
            console.error('[QR] Generation error:', error);
            useQRServerFallback(displayElement, text);
        }
    } else {
        useQRServerFallback(displayElement, text);
    }
}

// ✅ Helper: QR Server Fallback
function useQRServerFallback(element, text) {
    const encodedText = encodeURIComponent(text);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=10&data=${encodedText}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.alt = 'QR Code';
    img.style.width = '180px';
    img.style.height = '180px';
    img.className = 'rounded-lg';
    img.crossOrigin = 'anonymous';
    
    img.onerror = () => {
        // Final fallback - show text
        element.innerHTML = `
            <div class="qr-fallback">
                <div class="text-xs text-gray-500 mb-2">QR Code unavailable</div>
                <div class="text-xs font-mono break-all bg-gray-100 p-2 rounded">${text.substring(0, 30)}...</div>
                <button onclick="copyToClipboard('${text}')" class="text-blue-500 hover:text-blue-700 text-xs mt-2">
                    📋 Copy Payment Details
                </button>
            </div>
        `;
    };
    
    element.appendChild(img);
}

// ✅ Helper: Copy to clipboard
// function copyToClipboard(text) {
//     navigator.clipboard.writeText(text)
//         .then(() => showCryptoAlert('Copied!', 'success', 2000))
//         .catch(() => showCryptoAlert('Failed to copy', 'error'));
// }
// function showFallbackQR(element, text) {
//     const encodedText = encodeURIComponent(text);
//     const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=10&data=${encodedText}`;
    
//     const img = document.createElement('img');
//     img.src = qrUrl;
//     img.alt = 'QR Code';
//     img.style.width = '180px';
//     img.style.height = '180px';
//     img.className = 'rounded-lg';
    
//     img.onerror = () => {
//         element.innerHTML = `
//             <div class="qr-fallback">
//                 <div class="text-xs text-gray-500 mb-2">QR Code unavailable</div>
//                 <div class="text-xs font-mono break-all bg-gray-100 p-2 rounded">${text.substring(0, 30)}...</div>
//                 <button onclick="navigator.clipboard.writeText('${text}').then(() => showCryptoAlert('Copied!', 'success'))" class="text-blue-500 hover:text-blue-700 text-xs mt-2">
//                     📋 Copy Payment Details
//                 </button>
//             </div>
//         `;
//     };
    
//     element.appendChild(img);
// }

// ======================================================
// 🔄  TRON MANUAL MODAL (FALLBACK ONLY)
// ======================================================

async function showTronManualModal(recipient, amount) {
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const amountSun = BigInt(Math.round(parseFloat(amount) * 10 ** 6)).toString();
       const qrContent = `tron:${CONFIG.TRON.USDT_ADDRESS}?function=transfer(address,uint256)&args=${recipient},${amountSun}`;
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">📱 TRON USDT - QR Fallback</h3>
                
                <div class="bg-yellow-50 p-3 rounded mb-3 border border-yellow-200">
                    <p class="text-xs text-yellow-800">
                        ⚠️ WalletConnect failed. Use QR code as fallback.
                    </p>
                </div>
                
                <div class="bg-gradient-to-r from-red-100 to-red-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-red-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-red-600">TRC-20 Network</div>
                </div>
                
                <p class="text-sm mb-2">Send USDT (TRC-20) to:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-200">
                    ${recipient}
                </div>
                
                <div id="tronQR" class="mx-auto mb-4"></div>
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="copyAddress" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-xs transition-colors">
                        📋 Copy Address
                    </button>
                    <button id="viewOnTronscan" class="bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-xs transition-colors">
                        🔍 View on Tronscan
                    </button>
                </div>
                
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (64 characters)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-red-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">
                        ✅ I've Paid
                    </button>
                </div>
                
                <button id="closeTron" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">
                    Cancel
                </button>
            </div>
        `);

        setTimeout(() => {
            const qrContainer = modal.querySelector('#tronQR');
            if (qrContainer) {
                generateQR(qrContent, 'tronQR');
            }
        }, 100);

        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        }

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    const btn = modal.querySelector('#copyAddress');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        modal.querySelector('#viewOnTronscan').onclick = () => {
            window.open(`https://tronscan.org/#/address/${recipient}`, '_blank');
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
                resolve({ 
                    success: true, 
                    manual: true, 
                    txHash, 
                    explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` 
                });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format (64 hex characters)', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeTron').onclick = () => { 
            modal.remove(); 
            resolve({ success: false, cancelled: true }); 
        };
    });
}

// ======================================================
// 🔄  BSC MANUAL MODAL (FALLBACK ONLY)
// ======================================================

async function showBSCManualModal(recipient, amount) {
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">📱 BSC USDT - QR Fallback</h3>
                
                <div class="bg-yellow-50 p-3 rounded mb-3 border border-yellow-200">
                    <p class="text-xs text-yellow-800">
                        ⚠️ WalletConnect failed. Use QR code as fallback.
                    </p>
                </div>
                
                <div class="bg-gradient-to-r from-yellow-100 to-yellow-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-gray-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-gray-600">BEP-20 Network</div>
                </div>
                
                <p class="text-sm mb-2">Send to this BSC address:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-200">${recipient}</div>
                
                <div id="bscQR" class="mb-4"></div>
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="copyAddress" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-xs transition-colors">
                        📋 Copy Address
                    </button>
                    <button id="viewOnBscScan" class="bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-xs transition-colors">
                        🔍 View on BscScan
                    </button>
                </div>
                
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (0x...)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid</button>
                </div>
                <button id="closeBSC" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        const qrContent = createPaymentQRContent('BSC', recipient, amount);
        generateQR(qrContent, 'bscQR');

        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        }

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    const btn = modal.querySelector('#copyAddress');
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        modal.querySelector('#viewOnBscScan').onclick = () => {
            window.open(`https://bscscan.com/address/${recipient}`, '_blank');
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm(`No transaction hash entered. Are you sure you have already sent ${amount} USDT on BSC network?`)) {
                    return;
                }
            }
            
            modal.remove();
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ 
                    success: true, 
                    manual: true, 
                    txHash, 
                    explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` 
                });
            } else if (txHash) {
                showCryptoAlert('Invalid transaction hash format (should start with 0x and be 64 chars)', 'error');
                resolve({ success: false, error: 'Invalid transaction hash' });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeBSC').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

// ======================================================
// 🔔 ALERT SYSTEM
// ======================================================

function showCryptoAlert(message, type = "info", duration = 5000) {
    const existingAlert = document.getElementById("crypto-alert");
    if (existingAlert) {
        existingAlert.remove();
    }
    
    const alertBox = document.createElement("div");
    alertBox.id = "crypto-alert";
    alertBox.className = `crypto-alert ${type}`;
    
    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;
    alertBox.appendChild(messageSpan);
    
    const closeBtn = document.createElement("button");
    closeBtn.className = "crypto-alert-close";
    closeBtn.innerHTML = "×";
    closeBtn.setAttribute("aria-label", "Close alert");
    closeBtn.onclick = () => dismissAlert(alertBox);
    alertBox.appendChild(closeBtn);
    
    document.body.appendChild(alertBox);
    
    if (duration > 0) {
        setTimeout(() => dismissAlert(alertBox), duration);
    }
    
    return alertBox;
}

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
        
        // Try multiple CDNs
        const cdnUrls = [
            CONFIG.WALLETCONNECT.SRC,
            'https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.min.js',
            'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js'
        ];
        
        let lastError = null;
        
        for (const cdnUrl of cdnUrls) {
            try {
                console.log(`[WalletConnect] Trying CDN: ${cdnUrl}`);
                const provider = await loadWalletConnectFromCDN(cdnUrl);
                if (provider) return provider;
            } catch (error) {
                lastError = error;
                console.warn(`[WalletConnect] CDN failed:`, error.message);
            }
        }
        
        throw lastError || new Error('All WalletConnect CDNs failed');
        
    } catch (error) {
        console.error('[WalletConnect] Loading error:', error);
        return null; // Return null instead of throwing
    }
}

function loadWalletConnectFromCDN(cdnUrl) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = cdnUrl;
        script.crossOrigin = 'anonymous';
        
        const timeout = setTimeout(() => {
            reject(new Error('Timeout loading WalletConnect'));
        }, 10000);
        
        script.onload = () => {
            clearTimeout(timeout);
            // Check if loaded
            setTimeout(() => {
                if (window.EthereumProvider) {
                    resolve(window.EthereumProvider);
                } else {
                    reject(new Error('WalletConnect loaded but not initialized'));
                }
            }, 500);
        };
        
        script.onerror = () => {
            clearTimeout(timeout);
            reject(new Error(`Failed to load from ${cdnUrl}`));
        };
        
        document.head.appendChild(script);
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

async function ensureBSCNetworkDesktop(eip1193Provider) {
    if (isMobileDevice()) {
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
        const accounts = await eip1193Provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        if (typeof ethers === 'undefined') {
            throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
        }
        
        const BSC_USDT_DECIMALS = 18;
        const amountWei = ethers.utils.parseUnits(amount.toString(), BSC_USDT_DECIMALS);
        
        const iface = new ethers.utils.Interface([
            "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
        
        const txHash = await eip1193Provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.BSC.USDT_ADDRESS,
                data: data
            }]
        });
        
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
// 🧩  UI COMPONENTS
// ======================================================

function createModal(content, className = '') {
    const modal = document.createElement('div');
    modal.className = `fixed inset-0 bg-black/80 flex items-center justify-center z-50 ${className}`;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
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
                <h3 class="font-bold text-lg">${network} Payment</h3>
                <span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'BSC' ? 'BEP-20' : 'TRC-20'}</span>
            </div>
            <div class="text-2xl font-bold mb-4">${amount} USDT</div>
            <div id="statusText" class="min-h-6 mb-4">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden">
                <a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">View on explorer →</a>
            </div>
            <button id="closeModal" class="mt-4 text-gray-500 hover:text-gray-700 text-sm transition-colors">Close</button>
        </div>
    `);
    
    const closeX = modal.querySelector('#modalCloseX');
    const closeBtn = modal.querySelector('#closeModal');
    
    if (closeX) {
        closeX.onclick = () => { modal.remove(); };
    }
    if (closeBtn) {
        closeBtn.onclick = () => { modal.remove(); };
    }
    
    return modal;
}

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
    
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, error) {
    let message = error.message || 'Payment failed';
    
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
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-3 flex items-center justify-center gap-2 transition-colors">
                    <span>🟡</span> BSC (BEP-20)
                    ${preferredNetwork === 'BSC' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded flex items-center justify-center gap-2 transition-colors">
                    <span>🔴</span> TRON (TRC-20)
                    ${preferredNetwork === 'TRON' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="cancel" class="mt-4 text-gray-500 hover:text-gray-700 text-sm transition-colors">Cancel</button>
            </div>
        `);

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
                if (el) el.classList.add('ring-2', 'ring-blue-500');
            }, 100);
        }
    });
}

// ======================================================
// 🚀  MAIN ENTRY POINT (SINGLE VERSION)
// ======================================================

async function initiateCryptoPayment(participantId, voteCount, amount) {
    let modal = null;
    
    try {
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        const preferredNetwork = await detectPreferredNetwork();
        const selectedNetwork = await showNetworkSelectionModal(preferredNetwork);
        
        if (!selectedNetwork) {
            return { success: false, cancelled: true };
        }
        
        const recipient = selectedNetwork === 'BSC' 
            ? CONFIG.BSC.WALLET_ADDRESS 
            : CONFIG.TRON.WALLET_ADDRESS;
        
        // ============ BSC PAYMENT FLOW ============
        if (selectedNetwork === 'BSC') {
            const isMobile = isMobileDevice();
            const isInWalletBrowser = isInAppBrowser();
            
            // Mobile BSC flow (deep links - INTACT)
            if (isMobile) {
                if (isInWalletBrowser && window.ethereum) {
                    console.log('[Payment] Detected in-app wallet browser');
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
                
                const mobileResult = await showMobileWalletModal(selectedNetwork, recipient, amount);
                
                if (mobileResult.cancelled) {
                    return { success: false, cancelled: true };
                }
                
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
                
                if (mobileResult.showManual) {
                    const manualResult = await showBSCManualModal(recipient, amount);
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
            
            // ============ DESKTOP BSC FLOW - WALLETCONNECT ============
            console.log('[BSC] Desktop payment - using WalletConnect');
            
            const wcResult = await showBSCWalletConnectModal(recipient, amount);
            
            if (wcResult.cancelled) {
                return { success: false, cancelled: true };
            }
            
            if (wcResult.success) {
                modal = showPaymentStatusModal('BSC', amount);
                updateStatus(modal, 'Connecting to wallet...');
                
                try {
                    const provider = await initBSCWalletConnect();
                    
                    updateStatus(modal, 'Waiting for wallet connection...');
                    
                    const accounts = await provider.request({ method: 'eth_requestAccounts' });
                    
                    if (!accounts || accounts.length === 0) {
                        throw new PaymentError('No wallet connected', ERROR_CODES.WALLET_ERROR);
                    }
                    
                    await ensureBSCNetworkDesktop(provider);
                    
                    updateStatus(modal, 'Preparing USDT BEP-20 transfer...');
                    
                    const result = await executeBSCWalletConnectTransfer(provider, recipient, amount);
                    
                    updateStatus(modal, 'Finalizing payment...');
                    
                    await finalizePayment(result.txHash, 'BSC');
                    
                    successStatus(modal, result.txHash, result.explorerUrl);
                    
                    return {
                        success: true,
                        ...result,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: result.txHash
                    };
                    
                } catch (wcError) {
                    if (modal) modal.remove();
                    console.error('[BSC WalletConnect] Error:', wcError);
                    
                    const useFallback = confirm(
                        `WalletConnect failed: ${wcError.message}\n\nWould you like to use QR code instead?`
                    );
                    
                    if (useFallback) {
                        const fallbackResult = await showBSCManualModal(recipient, amount);
                        if (fallbackResult.success) {
                            return {
                                ...fallbackResult,
                                participant_id: participantId,
                                payment_amount: amount,
                                payment_intent_id: fallbackResult.txHash || `manual_${Date.now()}`
                            };
                        }
                        return fallbackResult;
                    }
                    
                    throw wcError;
                }
            }
            
            return wcResult;
        }
        
        // ============ TRON PAYMENT FLOW ============
        else {
            const hasTronWallet = window.tronWeb && window.tronWeb.ready;
            const isMobileTron = isMobileDevice();
            
            // Mobile TRON flow (deep links - INTACT)
            if (isMobileTron) {
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
                
                const mobileResult = await showMobileTronWalletModal(recipient, amount);
                
                if (mobileResult.useTronLink) {
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
            
            // ============ DESKTOP TRON FLOW - WALLETCONNECT ============
            console.log('[TRON] Desktop payment - using WalletConnect');
            
            const wcResult = await showTronWalletConnectModal(recipient, amount);
            
            if (wcResult.cancelled) {
                return { success: false, cancelled: true };
            }
            
            if (wcResult.success) {
                modal = showPaymentStatusModal('TRON', amount);
                updateStatus(modal, 'Connecting to wallet...');
                
                try {
                    const provider = await initTronWalletConnect();
                    
                    updateStatus(modal, 'Waiting for wallet connection...');
                    
                    const accounts = await provider.request({ method: 'eth_requestAccounts' });
                    
                    if (!accounts || accounts.length === 0) {
                        throw new PaymentError('No wallet connected', ERROR_CODES.WALLET_ERROR);
                    }
                    
                    updateStatus(modal, 'Preparing USDT TRC-20 transfer...');
                    
                    const result = await executeTronWalletConnectTransfer(provider, recipient, amount);
                    
                    updateStatus(modal, 'Finalizing payment...');
                    
                    await finalizePayment(result.txHash, 'TRON');
                    
                    successStatus(modal, result.txHash, result.explorerUrl);
                    
                    return {
                        success: true,
                        ...result,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: result.txHash
                    };
                    
                } catch (wcError) {
                    if (modal) modal.remove();
                    console.error('[TRON WalletConnect] Error:', wcError);
                    
                    const useFallback = confirm(
                        `WalletConnect failed: ${wcError.message}\n\nWould you like to use QR code instead?`
                    );
                    
                    if (useFallback) {
                        const fallbackResult = await showTronManualModal(recipient, amount);
                        if (fallbackResult.success) {
                            return {
                                ...fallbackResult,
                                participant_id: participantId,
                                payment_amount: amount,
                                payment_intent_id: fallbackResult.txHash || `manual_${Date.now()}`
                            };
                        }
                        return fallbackResult;
                    }
                    
                    throw wcError;
                }
            }
            
            return wcResult;
        }
        
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
// 📝  ADDITIONAL HELPER FUNCTIONS
// ======================================================

function createAlternativeBSCQR(recipient, amount) {
    const amountWei = (amount * 1e18).toString();
    
    const jsonRPC = JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_sendTransaction",
        params: [{
            to: CONFIG.BSC.USDT_ADDRESS,
            data: `0xa9059cbb000000000000000000000000${recipient.replace('0x', '')}${amountWei.replace('0x', '').padStart(64, '0')}`
        }],
        id: 1
    });
    
    const web3Format = `web3://send?address=${recipient}&amount=${amount}&token=${CONFIG.BSC.USDT_ADDRESS}&network=bsc&chainId=56`;
    
    const simpleFormat = `Send ${amount} USDT (BEP-20)
To: ${recipient}
Network: BSC (Binance Smart Chain)
Token: USDT (${CONFIG.BSC.USDT_ADDRESS})
Amount: ${amount} USDT`;
    
    return {
        jsonRPC,
        web3Format,
        simpleFormat
    };
}

function debugQRContent(network, recipient, amount) {
    const qrContent = createPaymentQRContent(network, recipient, amount);
    const alternatives = network === 'BSC' ? createAlternativeBSCQR(recipient, amount) : null;
    
    console.group('QR Code Debug Info');
    console.log('Network:', network);
    console.log('Recipient:', recipient);
    console.log('Amount:', amount, 'USDT');
    console.log('Primary QR Content:', qrContent);
    console.log('QR Content Length:', qrContent.length);
    
    if (network === 'BSC') {
        console.log('BSC Contract:', CONFIG.BSC.USDT_ADDRESS);
        console.log('Chain ID:', CONFIG.BSC.CHAIN_ID);
        console.log('Amount in Wei:', (amount * 1e18).toString());
        console.log('Alternative Formats:', alternatives);
        
        if (qrContent.startsWith('ethereum:')) {
            console.log('✅ Valid EIP-681 format detected');
            const parts = qrContent.split('/');
            console.log('Contract:', parts[0].split('@')[0].replace('ethereum:', ''));
            console.log('Chain ID:', parts[0].split('@')[1]);
            
            if (parts[1]) {
                const params = new URLSearchParams(parts[1].replace('transfer?', ''));
                console.log('Recipient:', params.get('address'));
                console.log('Amount (Wei):', params.get('uint256'));
            }
        }
    }
    
    console.groupEnd();
    
    return {
        primary: qrContent,
        alternatives: alternatives
    };
}

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.processCryptoPayment = initiateCryptoPayment;
window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    process: initiateCryptoPayment,
    showBSCManualModal,
    showTronManualModal,
    showNetworkSelectionModal,
    showAlert: showCryptoAlert,
    dismissAlert: dismissAlert,
    generateQR: generateQR,
    createPaymentQRContent: createPaymentQRContent,
    createAlternativeBSCQR: createAlternativeBSCQR,
    debugQRContent: debugQRContent,
    loadQRCodeLibrary: loadQRCodeLibrary,
    CONFIG: CONFIG,
    ERROR_CODES: ERROR_CODES
};
// ✅ Make copyToClipboard globally available
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text)
        .then(() => showCryptoAlert('Copied!', 'success', 2000))
        .catch(() => showCryptoAlert('Failed to copy', 'error'));
};

// ======================================================
// 🚀  INITIALIZATION
// ======================================================

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        console.log('🔧 Crypto Payments Debug Mode');
        console.log('Available functions:', Object.keys(window.CryptoPayments));
        console.log('Config:', CONFIG);
        showCryptoAlert('Debug mode enabled - check console', 'info', 3000);
    }
});

window.CryptoPaymentsReady = true;
document.dispatchEvent(new CustomEvent('cryptoPaymentsReady'));

console.log('✅ Crypto Payments module loaded - Desktop: WalletConnect QR, Mobile: Deep Links');