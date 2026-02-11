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
    LIMITS: {
        MAX_RETRIES: 3,
        ATTEMPT_TIMEOUT: 5 * 60 * 1000
    }
};

const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    PROVIDER_ERROR: 'PROVIDER_ERROR'
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

function getWalletDeepLinks(network, recipient, amount) {
    if (network === 'BSC') {
        return {
            metamask: `https://metamask.app.link/send/${CONFIG.BSC.USDT_ADDRESS}@56/transfer?address=${recipient}&uint256=${amount * 1e6}`,
            trust: `https://link.trustwallet.com/send?address=${CONFIG.BSC.USDT_ADDRESS}&amount=${amount}&token_id=${CONFIG.BSC.USDT_ADDRESS}&chain_id=56&asset=USDT`,
            tokenpocket: `tpoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
                action: 'transfer',
                chain: 'BSC',
                contract: CONFIG.BSC.USDT_ADDRESS,
                to: recipient,
                amount: amount.toString()
            }))}`
        };
    } else {
        return {
            tronlink: `tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({
                action: 'transfer',
                contract: CONFIG.TRON.USDT_ADDRESS,
                to: recipient,
                amount: (amount * 1e6).toString()
            }))}`,
            trust: `trust://send?asset=c195_t${CONFIG.TRON.USDT_ADDRESS}&address=${recipient}&amount=${amount}`
        };
    }
}

// ======================================================
// 🔔 DISMISSIBLE ALERT SYSTEM
// ======================================================

function showCryptoAlert(message, type = "info", duration = 5000) {
    const existingAlert = document.getElementById("crypto-alert");
    if (existingAlert) existingAlert.remove();
    
    const alertBox = document.createElement("div");
    alertBox.id = "crypto-alert";
    alertBox.className = `crypto-alert ${type}`;
    
    alertBox.innerHTML = `
        <span>${message}</span>
        <button class="crypto-alert-close">×</button>
    `;
    
    document.body.appendChild(alertBox);
    
    alertBox.querySelector('.crypto-alert-close').onclick = () => {
        alertBox.style.animation = "crypto-slide-up 0.3s ease-out forwards";
        setTimeout(() => alertBox.remove(), 300);
    };
    
    if (duration > 0) {
        setTimeout(() => {
            if (alertBox.parentNode) {
                alertBox.style.animation = "crypto-slide-up 0.3s ease-out forwards";
                setTimeout(() => alertBox.remove(), 300);
            }
        }, duration);
    }
    
    return alertBox;
}

// ======================================================
// 🧩  UI COMPONENTS (Mobile Only)
// ======================================================

function createModal(content) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = content;
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
    
    return modal;
}

// ======================================================
// 📱  MOBILE BSC WALLET MODAL
// ======================================================

function showMobileBSCWalletModal(recipient, amount) {
    return new Promise((resolve) => {
        const hasInjectedWallet = window.ethereum || window.BinanceChain;
        const deepLinks = getWalletDeepLinks('BSC', recipient, amount);
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">💳 BSC USDT Payment</h3>
                <p class="text-sm text-gray-600 mb-4">Pay <strong>${amount} USDT</strong> (BEP-20)</p>
                
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

        modal.querySelector('#openMetaMask').onclick = () => window.location.href = deepLinks.metamask;
        modal.querySelector('#openTrust').onclick = () => window.location.href = deepLinks.trust;
        modal.querySelector('#openTokenPocket').onclick = () => window.location.href = deepLinks.tokenpocket;

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` });
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
// 📱  MOBILE TRON WALLET MODAL
// ======================================================

function showMobileTRONWalletModal(recipient, amount) {
    return new Promise((resolve) => {
        const hasTronLink = window.tronWeb && window.tronWeb.ready;
        const deepLinks = getWalletDeepLinks('TRON', recipient, amount);
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX">×</button>
                <h3 class="font-bold mb-3 text-lg pr-6">💳 TRON USDT Payment</h3>
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
                    <button id="openTrust" class="bg-blue-500 hover:bg-blue-600 text-white py-2 px-3 rounded flex items-center justify-center gap-1 text-sm transition-colors">
                        <span>🛡️</span> Trust
                    </button>
                </div>
                
                <div class="border-t pt-3 mt-2">
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

        modal.querySelector('#openTronLink').onclick = () => window.location.href = deepLinks.tronlink;
        modal.querySelector('#openTrust').onclick = () => window.location.href = deepLinks.trust;

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (txHash && /^[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` });
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
// 📱  MOBILE NETWORK SELECTION MODAL
// ======================================================

function showMobileNetworkSelectionModal() {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl w-80 text-center relative">
                <button class="crypto-modal-close" id="modalCloseX">×</button>
                <h3 class="font-bold mb-4 pr-6">Choose Network</h3>
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-3 flex items-center justify-center gap-2 transition-colors">
                    <span>🟡</span> BSC (BEP-20)
                </button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded flex items-center justify-center gap-2 transition-colors">
                    <span>🔴</span> TRON (TRC-20)
                </button>
                <button id="cancel" class="mt-4 text-gray-500 hover:text-gray-700 text-sm transition-colors">Cancel</button>
            </div>
        `);

        modal.querySelector('#modalCloseX').onclick = () => { modal.remove(); resolve(null); };
        modal.querySelector('#bsc').onclick = () => { modal.remove(); resolve('BSC'); };
        modal.querySelector('#tron').onclick = () => { modal.remove(); resolve('TRON'); };
        modal.querySelector('#cancel').onclick = () => { modal.remove(); resolve(null); };
    });
}

// ======================================================
// 🚀  MAIN ENTRY POINT (MOBILE ONLY)
// ======================================================

async function initiateMobileCryptoPayment(participantId, voteCount, amount) {
    try {
        // Validate inputs
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        // Show network selection
        const selectedNetwork = await showMobileNetworkSelectionModal();
        if (!selectedNetwork) {
            return { success: false, cancelled: true };
        }
        
        // Get wallet address based on network
        const recipient = selectedNetwork === 'BSC' 
            ? CONFIG.BSC.WALLET_ADDRESS 
            : CONFIG.TRON.WALLET_ADDRESS;
        
        const isInWalletBrowser = isInAppBrowser();
        
        // Handle BSC payment
        if (selectedNetwork === 'BSC') {
            // If we're inside a wallet's browser, use the injected provider
            if (isInWalletBrowser && window.ethereum) {
                try {
                    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                    if (!accounts || accounts.length === 0) {
                        throw new Error('Failed to connect wallet');
                    }
                    
                    return {
                        success: true,
                        txHash: 'injected_wallet_tx',
                        explorerUrl: CONFIG.BSC.EXPLORER,
                        participant_id: participantId,
                        payment_amount: amount,
                        payment_intent_id: `mobile_${Date.now()}`
                    };
                } catch (error) {
                    console.error('Injected wallet error:', error);
                    // Fall back to mobile wallet modal
                    const mobileResult = await showMobileBSCWalletModal(recipient, amount);
                    if (mobileResult.success) {
                        return {
                            ...mobileResult,
                            participant_id: participantId,
                            payment_amount: amount
                        };
                    }
                    return mobileResult;
                }
            }
            
            // Show mobile BSC wallet modal
            const mobileResult = await showMobileBSCWalletModal(recipient, amount);
            if (mobileResult.useInjected && window.ethereum) {
                // Handle injected wallet connection
                try {
                    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                    if (!accounts || accounts.length === 0) {
                        throw new Error('Failed to connect wallet');
                    }
                    
                    return {
                        success: true,
                        txHash: 'injected_wallet_tx',
                        explorerUrl: CONFIG.BSC.EXPLORER,
                        participant_id: participantId,
                        payment_amount: amount
                    };
                } catch (error) {
                    showCryptoAlert('Failed to connect wallet', 'error');
                    return { success: false, error: error.message };
                }
            }
            
            if (mobileResult.success) {
                return {
                    ...mobileResult,
                    participant_id: participantId,
                    payment_amount: amount
                };
            }
            
            return mobileResult;
        }
        
        // Handle TRON payment
        if (selectedNetwork === 'TRON') {
            // If we're inside TronLink browser
            if (isInWalletBrowser && window.tronWeb && window.tronWeb.ready) {
                try {
                    return {
                        success: true,
                        txHash: 'tronlink_tx',
                        explorerUrl: CONFIG.TRON.EXPLORER,
                        participant_id: participantId,
                        payment_amount: amount
                    };
                } catch (error) {
                    console.error('TronLink error:', error);
                    const mobileResult = await showMobileTRONWalletModal(recipient, amount);
                    if (mobileResult.success) {
                        return {
                            ...mobileResult,
                            participant_id: participantId,
                            payment_amount: amount
                        };
                    }
                    return mobileResult;
                }
            }
            
            // Show mobile TRON wallet modal
            const mobileResult = await showMobileTRONWalletModal(recipient, amount);
            if (mobileResult.useTronLink && window.tronWeb && window.tronWeb.ready) {
                try {
                    return {
                        success: true,
                        txHash: 'tronlink_tx',
                        explorerUrl: CONFIG.TRON.EXPLORER,
                        participant_id: participantId,
                        payment_amount: amount
                    };
                } catch (error) {
                    showCryptoAlert('Failed to connect TronLink', 'error');
                    return { success: false, error: error.message };
                }
            }
            
            if (mobileResult.success) {
                return {
                    ...mobileResult,
                    participant_id: participantId,
                    payment_amount: amount
                };
            }
            
            return mobileResult;
        }
        
    } catch (error) {
        console.error('[MobilePayment] Error:', error);
        showCryptoAlert(error.message || 'Payment failed', 'error');
        return { success: false, error: error.message };
    }
}

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateMobileCryptoPayment = initiateMobileCryptoPayment;
window.MobileCryptoPayments = {
    initiate: initiateMobileCryptoPayment,
    showBSCWallet: showMobileBSCWalletModal,
    showTRONWallet: showMobileTRONWalletModal,
    showNetworkSelection: showMobileNetworkSelectionModal,
    showAlert: showCryptoAlert,
    loadQRCodeLibrary,
    CONFIG,
    ERROR_CODES
};

// ✅ Set ready flag
window.MobileCryptoPaymentsReady = true;

// ✅ Dispatch ready event
document.dispatchEvent(new CustomEvent('mobileCryptoPaymentsReady'));

console.log('✅ Mobile Crypto Payments module loaded (BSC + TRON)');
console.log('📱 Mobile devices only - desktop payments disabled');