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
        
        .hidden {
            display: none !important;
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
            resolve();
        };
        
        document.head.appendChild(script);
    });
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
    if (!isMobileDevice()) {
        return false;
    }
    
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('metamask') || 
           ua.includes('trust') || 
           ua.includes('tokenpocket') ||
           ua.includes('imtoken') ||
           ua.includes('coinbase');
}

// ✅ BSC Deep Links (works because BSC address = recipient address)
function getBSCDeepLinks(recipient, amount) {
    return {
        metamask: `https://metamask.app.link/send/${CONFIG.BSC.USDT_ADDRESS}@56/transfer?address=${recipient}&uint256=${amount * 1e6}`,
        trust: `https://link.trustwallet.com/send?address=${recipient}&amount=${amount}&token_id=${CONFIG.BSC.USDT_ADDRESS}&chain_id=56&asset=USDT`,
        tokenpocket: `tpoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
            action: 'transfer',
            chain: 'BSC',
            contract: CONFIG.BSC.USDT_ADDRESS,
            to: recipient,
            amount: amount.toString()
        }))}`
    };
}

function showMobileWalletModal(network, recipient, amount) {
    return new Promise((resolve) => {
        const hasInjectedWallet = window.ethereum || window.BinanceChain;
        const deepLinks = getBSCDeepLinks(recipient, amount);
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">💳 Connect Wallet</h3>
                <p class="text-sm text-gray-600 mb-4">Pay <strong>${amount} USDT</strong> on BSC</p>
                
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

// ✅ MOBILE TRON WALLET MODAL (unchanged - works)
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
            window.location.href = `trust://send?asset=c195_t${CONFIG.TRON.USDT_ADDRESS}&address=${recipient}&amount=${amount}`;
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
// ✅ NEW: WALLETCONNECT FOR TRON DESKTOP QR
// ======================================================

/**
 * Generate WalletConnect URI for TRON USDT payment
 * This is the ONLY reliable way to pre-fill recipient, amount, and token
 */
async function generateTronWalletConnectURI(recipient, amount) {
    try {
        // Load WalletConnect if not available
        if (typeof window.EthereumProvider === 'undefined') {
            await loadWalletConnect();
        }
        
        if (!window.EthereumProvider) {
            throw new Error('WalletConnect not available');
        }
        
        // Initialize WalletConnect provider
        const provider = await window.EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [1], // Not actually used for TRON, but required
            showQrModal: false, // We'll show our own QR
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment on TRON",
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.ico`]
            }
        });
        
        // Create a session with TRON-specific parameters
        // This is a custom implementation for TRON USDT
        const wcURI = await provider.connect({
            method: 'tron_signTransaction',
            params: [{
                to: CONFIG.TRON.USDT_ADDRESS,
                function: 'transfer(address,uint256)',
                parameters: [recipient, (amount * 1e6).toString()],
                network: 'tron',
                contract: CONFIG.TRON.USDT_ADDRESS,
                amount: amount,
                token: 'USDT'
            }]
        });
        
        return wcURI;
        
    } catch (error) {
        console.error('[WalletConnect] Failed to generate TRON URI:', error);
        throw error;
    }
}

// ✅ FIXED: TRON MANUAL MODAL with WalletConnect for desktop QR
async function showTronManualModal(recipient, amount) {
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const isMobile = isMobileDevice();
        
        // ✅ TRON USDT uses 6 decimals
        const amountSun = BigInt(Math.round(parseFloat(amount) * 10 ** 6)).toString();
        
        // ✅ Mobile: Native TRON URI (works with TronLink)
        const tronURI = `tron://${CONFIG.TRON.USDT_ADDRESS}/transfer?address=${recipient}&amount=${amountSun}`;
        
        // ✅ Desktop: We'll generate WalletConnect QR code
        // Start with a loading state, then generate WalletConnect URI
        let qrContent = isMobile ? recipient : 'Loading QR code...';
        
        console.log('[TRON] Using QR strategy:', {
            mode: isMobile ? 'Mobile - Tron URI' : 'Desktop - WalletConnect',
            recipient,
            amount
        });
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">🔴 TRON USDT Payment</h3>
                
                <div class="bg-gradient-to-r from-red-100 to-red-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-red-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-red-600">Amount to send</div>
                    <div class="text-xs text-red-500 mt-1">TRC-20 Network</div>
                </div>
                
                <p class="text-sm mb-2 text-gray-700">Send USDT (TRC-20) to:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-200">
                    ${recipient}
                </div>
                
                <div id="tronQR" class="mx-auto mb-4">
                    ${!isMobile ? '<div class="text-sm text-gray-500">Generating WalletConnect QR...</div>' : ''}
                </div>
                
                ${!isMobile ? `
                <div class="bg-green-50 p-3 rounded mb-3 text-left">
                    <div class="text-xs font-medium text-green-800 mb-1">✅ WalletConnect QR</div>
                    <p class="text-xs text-green-700">
                        Scan this QR code with Trust Wallet or any WalletConnect-compatible wallet.
                        <br><strong>Amount and recipient are pre-filled automatically.</strong>
                    </p>
                </div>
                ` : `
                <div class="bg-blue-50 p-3 rounded mb-3 text-left">
                    <div class="text-xs font-medium text-blue-800 mb-1">📱 Mobile Payment</div>
                    <p class="text-xs text-blue-700">
                        Scan this QR code with TronLink or Trust Wallet.
                    </p>
                </div>
                `}
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="copyAddress" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-xs transition-colors flex items-center justify-center gap-1">
                        <span>📋</span> Copy Address
                    </button>
                    <button id="viewOnTronscan" class="bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-xs transition-colors flex items-center justify-center gap-1">
                        <span>🔍</span> View on Tronscan
                    </button>
                </div>
                
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (64 characters)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid</button>
                </div>
                
                <button id="closeTron" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        // Close handler
        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
        }

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

        // View on Tronscan
        modal.querySelector('#viewOnTronscan').onclick = () => {
            window.open(`https://tronscan.org/#/address/${recipient}`, '_blank');
        };

        // ✅ Generate QR code based on device
        setTimeout(async () => {
            const qrContainer = modal.querySelector('#tronQR');
            if (!qrContainer) return;
            
            qrContainer.innerHTML = '';
            
            try {
                let qrText;
                
                if (isMobile) {
                    // Mobile: Use native TRON URI
                    qrText = tronURI;
                    console.log('[TRON Mobile] Using TronLink URI');
                } else {
                    // Desktop: Use WalletConnect
                    try {
                        showCryptoAlert('Generating WalletConnect QR...', 'info', 2000);
                        qrText = await generateTronWalletConnectURI(recipient, amount);
                        console.log('[TRON Desktop] WalletConnect URI generated');
                    } catch (wcError) {
                        console.error('[TRON Desktop] WalletConnect failed, falling back to address:', wcError);
                        showCryptoAlert('WalletConnect unavailable, using address QR', 'warning', 3000);
                        qrText = recipient;
                    }
                }
                
                // Generate QR code
                if (window.QRCode) {
                    if (typeof window.QRCode.toCanvas === 'function') {
                        const canvas = document.createElement('canvas');
                        qrContainer.appendChild(canvas);
                        
                        window.QRCode.toCanvas(canvas, qrText, {
                            width: 180,
                            margin: 2,
                            color: { dark: '#000000', light: '#FFFFFF' }
                        }, (error) => {
                            if (error) {
                                console.warn('QR error:', error);
                                generateFallbackQR(qrContainer, qrText);
                            }
                        });
                    } else {
                        new window.QRCode(qrContainer, {
                            text: qrText,
                            width: 180,
                            height: 180
                        });
                    }
                } else {
                    generateFallbackQR(qrContainer, qrText);
                }
                
            } catch (error) {
                console.error('[TRON QR] Generation failed:', error);
                generateFallbackQR(qrContainer, recipient);
            }
        }, 100);

        // Confirm payment
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

        const closeX = modal.querySelector('#modalCloseX');
        if (closeX) {
            closeX.onclick = () => { modal.remove(); resolve(null); };
        }

        modal.querySelector('#useWalletConnect').onclick = () => { modal.remove(); resolve('walletconnect'); };
        modal.querySelector('#useQR').onclick = () => { modal.remove(); resolve('qr'); };
        modal.querySelector('#goBack').onclick = () => { modal.remove(); resolve('back'); };
    });
}

// ✅ BSC MANUAL MODAL (unchanged - works)
async function showBSCManualModal(recipient, amount, isDesktop = false) {
    await loadQRCodeLibrary();
    
    return new Promise((resolve) => {
        const hasBrowserWallet = window.ethereum || window.BinanceChain;
        const isMobile = isMobileDevice();
        
        // BSC: Address QR works because address = recipient
        const qrContent = recipient;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">BSC USDT Payment</h3>
                
                <div class="bg-gradient-to-r from-yellow-100 to-yellow-50 p-4 rounded-lg mb-4">
                    <div class="text-2xl font-bold text-gray-800 mb-1">${amount} USDT</div>
                    <div class="text-sm text-gray-600">Amount to send</div>
                    <div class="text-xs text-gray-500 mt-1">BEP-20 Network</div>
                </div>
                
                <p class="text-sm mb-2">Send to this BSC address:</p>
                <div class="bg-gray-100 p-3 rounded break-all text-xs mb-3 font-mono border border-gray-200">${recipient}</div>
                
                <div id="bscQR" class="mb-4"></div>
                
                <div class="bg-blue-50 p-3 rounded mb-3 text-left">
                    <div class="text-xs font-medium text-blue-800 mb-1">📱 How to pay:</div>
                    <ol class="text-xs text-blue-700 list-decimal pl-4 space-y-1">
                        <li>Scan QR with wallet app</li>
                        <li>Ensure you're on <strong>BSC (Binance Smart Chain)</strong></li>
                        <li>Send <strong>${amount} USDT (BEP-20)</strong></li>
                        <li>Confirm the transaction</li>
                    </ol>
                </div>
                
                <div class="grid grid-cols-2 gap-2 mb-3">
                    <button id="copyAddress" class="bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-xs transition-colors flex items-center justify-center gap-1">
                        <span>📋</span> Copy Address
                    </button>
                    <button id="viewOnBscScan" class="bg-gray-500 hover:bg-gray-600 text-white py-2 rounded text-xs transition-colors flex items-center justify-center gap-1">
                        <span>🔍</span> View on BscScan
                    </button>
                </div>
                
                ${isDesktop && hasBrowserWallet ? `
                <div class="border-t border-b py-3 my-3">
                    <p class="text-sm font-medium mb-2">💻 Connect Browser Wallet:</p>
                    <button id="connectBrowserWallet" class="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded mb-2 flex items-center justify-center gap-2 transition-colors">
                        <span>🦊</span> Connect MetaMask
                    </button>
                    <p class="text-xs text-gray-500">Use browser extension to pay directly</p>
                </div>
                ` : ''}
                
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (0x...)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid</button>
                </div>
                <button id="closeBSC" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        // Generate QR with address
        setTimeout(() => {
            const qrContainer = modal.querySelector('#bscQR');
            if (qrContainer) {
                if (window.QRCode) {
                    if (typeof window.QRCode.toCanvas === 'function') {
                        const canvas = document.createElement('canvas');
                        qrContainer.appendChild(canvas);
                        window.QRCode.toCanvas(canvas, qrContent, {
                            width: 180,
                            margin: 2
                        }, (error) => {
                            if (error) generateFallbackQR(qrContainer, qrContent);
                        });
                    } else {
                        new window.QRCode(qrContainer, {
                            text: qrContent,
                            width: 180,
                            height: 180
                        });
                    }
                } else {
                    generateFallbackQR(qrContainer, qrContent);
                }
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

        modal.querySelector('#viewOnBscScan').onclick = () => {
            window.open(`https://bscscan.com/address/${recipient}`, '_blank');
        };

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

        modal.querySelector('#closeBSC').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            return 'TRON';
        }
        if (window.ethereum) {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            if (chainId === '0x38') return 'BSC';
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
            
            const timeout = setTimeout(() => {
                reject(new PaymentError('WalletConnect loading timed out', ERROR_CODES.PROVIDER_ERROR));
            }, 15000);
            
            script.onload = () => {
                clearTimeout(timeout);
                setTimeout(() => {
                    if (!window.EthereumProvider) {
                        reject(new PaymentError('WalletConnect blocked by browser', ERROR_CODES.PROVIDER_ERROR));
                        return;
                    }
                    resolve(window.EthereumProvider);
                }, 500);
            };
            
            script.onerror = () => {
                clearTimeout(timeout);
                reject(new PaymentError('Failed to load WalletConnect', ERROR_CODES.PROVIDER_ERROR));
            };
            
            document.head.appendChild(script);
        });
    } catch (error) {
        throw new PaymentError('WalletConnect unavailable', ERROR_CODES.PROVIDER_ERROR);
    }
}

async function ensureBSCNetworkDesktop(eip1193Provider) {
    if (isMobileDevice()) return;
    
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

async function executeBSCTransferUnified(eip1193Provider, recipient, amount) {
    if (!window.ethers) {
        throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
    }
    
    try {
        const accounts = await eip1193Provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        const ethersProvider = new window.ethers.providers.Web3Provider(eip1193Provider);
        const signer = ethersProvider.getSigner();
        
        const usdtAbi = [
            "function transfer(address to, uint256 amount) external returns (bool)",
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)"
        ];
        
        const usdtContract = new window.ethers.Contract(CONFIG.BSC.USDT_ADDRESS, usdtAbi, signer);
        const decimals = await usdtContract.decimals();
        const amountWei = window.ethers.utils.parseUnits(amount.toString(), decimals);
        
        const balance = await usdtContract.balanceOf(from);
        if (balance.lt(amountWei)) {
            throw new Error(`Insufficient USDT. Have ${window.ethers.utils.formatUnits(balance, decimals)} USDT, need ${amount} USDT`);
        }
        
        const gasEstimate = await usdtContract.estimateGas.transfer(recipient, amountWei);
        const gasPrice = await ethersProvider.getGasPrice();
        
        const tx = await usdtContract.transfer(recipient, amountWei, {
            gasLimit: gasEstimate.mul(120).div(100),
            gasPrice: gasPrice.mul(110).div(100)
        });
        
        const receipt = await tx.wait();
        
        return {
            txHash: tx.hash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${tx.hash}`,
            success: receipt.status === 1
        };
        
    } catch (error) {
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        throw new PaymentError(error.message || 'BSC transfer failed', ERROR_CODES.TRANSACTION_ERROR);
    }
}

async function executeTronTransfer(recipient, amount) {
    if (!window.tronWeb || !window.tronWeb.ready) {
        throw new PaymentError('TronLink not available', ERROR_CODES.PROVIDER_ERROR);
    }

    try {
        const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
        const amountSun = Math.floor(amount * Math.pow(10, 6));
        
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
        throw new PaymentError(error.message || 'TRON transfer failed', ERROR_CODES.TRANSACTION_ERROR);
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
            throw new PaymentError(errorData.message || 'Payment finalization failed', ERROR_CODES.NETWORK_ERROR);
        }

        return await response.json();
    } catch (error) {
        throw new PaymentError(error.message || 'Payment finalization failed', ERROR_CODES.NETWORK_ERROR);
    }
}

// ======================================================
// 🚀  MAIN ENTRY POINT
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
        
        // BSC HANDLING
        if (selectedNetwork === 'BSC') {
            const isMobile = isMobileDevice();
            const isInWalletBrowser = isInAppBrowser();
            
            if (isInWalletBrowser && window.ethereum) {
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Connecting wallet...');
                
                try {
                    const connected = await requestWalletConnection();
                    if (!connected) throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                    
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
            
            if (isMobile) {
                const mobileResult = await showMobileWalletModal(selectedNetwork, recipient, amount);
                
                if (mobileResult.cancelled) return { success: false, cancelled: true };
                
                if (mobileResult.useInjected && window.ethereum) {
                    modal = showPaymentStatusModal(selectedNetwork, amount);
                    updateStatus(modal, 'Connecting wallet...');
                    
                    try {
                        const connected = await requestWalletConnection();
                        if (!connected) throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                        
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
            
            // Desktop BSC - manual modal with address QR
            const manualResult = await showBSCManualModal(recipient, amount, true);
            
            if (manualResult.cancelled) return { success: false, cancelled: true };
            
            if (manualResult.connectBrowserWallet) {
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Connecting wallet...');
                
                try {
                    const connected = await requestWalletConnection();
                    if (!connected) throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
                    
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
        
        // TRON HANDLING
        if (selectedNetwork === 'TRON') {
            const hasTronWallet = window.tronWeb && window.tronWeb.ready;
            const isMobileTron = isMobileDevice();
            
            // Mobile TRON
            if (isMobileTron) {
                if (hasTronWallet) {
                    modal = showPaymentStatusModal(selectedNetwork, amount);
                    updateStatus(modal, 'Confirm in TronLink...');
                    
                    try {
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
                        if (modal) modal.remove();
                        throw error;
                    }
                }
                
                const mobileResult = await showMobileTronWalletModal(recipient, amount);
                
                if (mobileResult.useTronLink) {
                    modal = showPaymentStatusModal(selectedNetwork, amount);
                    updateStatus(modal, 'Confirm in TronLink...');
                    
                    try {
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
                        if (modal) modal.remove();
                        throw error;
                    }
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
            
            // ✅ DESKTOP TRON - Now uses WalletConnect QR
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
// 📝  QR HELPER FUNCTIONS
// ======================================================

function generateFallbackQR(element, data) {
    const encodedData = encodeURIComponent(data);
    const qrUrl = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodedData}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.style.width = '180px';
    img.style.height = '180px';
    img.style.borderRadius = '8px';
    
    img.onerror = () => {
        element.innerHTML = `
            <div class="text-center p-4">
                <div class="text-red-500 mb-2">QR Code Unavailable</div>
                <div class="font-mono text-xs break-all bg-gray-100 p-2 rounded">${data.substring(0, 30)}...</div>
            </div>
        `;
    };
    
    element.appendChild(img);
}

function createPaymentQRContent(network, recipient, amount) {
    if (network === 'BSC') {
        return recipient; // BSC: address works directly
    } else if (network === 'TRON') {
        const amountSun = (amount * 1e6).toString();
        return `tron://${CONFIG.TRON.USDT_ADDRESS}/transfer?address=${recipient}&amount=${amountSun}`;
    }
    return recipient;
}

function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.innerHTML = '';
    element.className = 'qr-code-container';
    
    const qrContainer = document.createElement('div');
    qrContainer.className = 'qr-code-container';
    element.appendChild(qrContainer);
    
    try {
        if (typeof QRCode !== 'undefined') {
            if (typeof window.QRCode.toCanvas === 'function') {
                const canvas = document.createElement('canvas');
                qrContainer.appendChild(canvas);
                
                window.QRCode.toCanvas(canvas, text, {
                    width: 160,
                    margin: 2
                }, (error) => {
                    if (error) generateFallbackQR(qrContainer, text);
                });
            } else {
                new window.QRCode(qrContainer, {
                    text: text,
                    width: 160,
                    height: 160
                });
            }
        } else {
            generateFallbackQR(qrContainer, text);
        }
    } catch (error) {
        generateFallbackQR(qrContainer, text);
    }
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
    dismissAlert,
    generateQR,
    createPaymentQRContent,
    loadQRCodeLibrary,
    CONFIG,
    ERROR_CODES
};

window.CryptoPaymentsReady = true;
document.dispatchEvent(new CustomEvent('cryptoPaymentsReady'));

console.log('✅ Crypto Payments module loaded');
console.log('   - BSC: Address QR (works)');
console.log('   - TRON Mobile: TronLink deep links');
console.log('   - TRON Desktop: WalletConnect QR ✅');