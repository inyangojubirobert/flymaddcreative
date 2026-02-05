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
    `;
    document.head.appendChild(style);
})();

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

// Track payment attempts
// const paymentAttempts = new Map(); // REMOVED

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
    // Check if we're inside a wallet's in-app browser
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('metamask') || 
           ua.includes('trust') || 
           ua.includes('tokenpocket') ||
           ua.includes('imtoken') ||
           ua.includes('coinbase') ||
           (window.ethereum && window.ethereum.isMetaMask) ||
           (window.ethereum && window.ethereum.isTrust) ||
           (window.ethereum && window.ethereum.isCoinbaseWallet);
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

function generateQRCanvas(text, size = 200) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QR Loading...', size/2, size/2 - 10);
    ctx.fillText('Copy address below', size/2, size/2 + 10);
    return canvas.toDataURL();
}

function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const img = document.createElement('img');
    img.className = 'mx-auto rounded-lg';
    img.alt = 'QR Code';
    img.style.width = '200px';
    img.style.height = '200px';
    
    const primaryUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}`;
    const secondaryUrl = `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=200`;
    const canvasUrl = generateQRCanvas(text);
    
    let attempts = 0;
    const urls = [primaryUrl, secondaryUrl, canvasUrl];
    
    img.onerror = () => {
        attempts++;
        if (attempts < urls.length) {
            console.warn(`[QR] Fallback ${attempts}: trying next source`);
            img.src = urls[attempts];
        }
    };
    
    img.src = urls[0];
    element.innerHTML = '';
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
                if (el) el.classList.add('ring-2', 'ring-blue-500');
            }, 100);
        }
    });
}

// ======================================================
// 🖥️  DESKTOP WALLET MODAL (UPDATED - removed browser wallet option)
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
                <!-- Browser Wallet option REMOVED from here - now only in QR modal -->
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
// 🔄  UPDATED BSC MANUAL MODAL (Added browser wallet option)
// ======================================================

function showBSCManualModal(recipient, amount, isDesktop = false) {
    return new Promise((resolve) => {
        const hasBrowserWallet = window.ethereum || window.BinanceChain;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">BSC USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (BEP-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="bscQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-red-500 mb-2">⚠️ Send only USDT on BSC network</p>
                <button id="copyAddress" class="text-blue-500 hover:text-blue-700 text-xs mb-3 transition-colors">📋 Copy Address</button>
                
                ${isDesktop && hasBrowserWallet ? `
                <div class="border-t border-b py-3 my-3">
                    <p class="text-sm font-medium mb-2">Connect Browser Wallet:</p>
                    <button id="connectBrowserWallet" class="w-full bg-orange-500 hover:bg-orange-600 text-white py-2 rounded mb-2 flex items-center justify-center gap-2 transition-colors">
                        <span>🦊</span> Connect MetaMask
                    </button>
                    <p class="text-xs text-gray-500">Use browser extension to pay directly</p>
                </div>
                ` : ''}
                
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid</button>
                </div>
                <button id="closeBSC" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        generateQR(recipient, 'bscQR');

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
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
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
                if (!confirm('No transaction hash entered. Are you sure you have already sent the payment?')) {
                    return;
                }
            }
            
            modal.remove();
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeBSC').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

function showTronManualModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw] relative">
                <button class="crypto-modal-close" id="modalCloseX" aria-label="Close">×</button>
                <h3 class="font-bold mb-3 pr-6">TRON USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (TRC-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="tronQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-red-500 mb-2">⚠️ Send only USDT on TRON network</p>
                <button id="copyAddress" class="text-blue-500 hover:text-blue-700 text-xs mb-3 transition-colors">📋 Copy Address</button>
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2 transition-colors">✅ I've Paid</button>
                </div>
                <button id="closeTron" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm transition-colors">Cancel</button>
            </div>
        `);

        generateQR(recipient, 'tronQR');

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
                    setTimeout(() => { btn.textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => showCryptoAlert('Failed to copy address', 'error'));
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm('No transaction hash entered. Are you sure you have already sent the payment?')) {
                    return;
                }
            }
            
            modal.remove();
            if (txHash && /^[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeTron').onclick = () => { modal.remove(); resolve({ success: false, cancelled: true }); };
    });
}

// ======================================================
// 🚀  MAIN ENTRY POINT (Updated for desktop flow)
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
        // For TRON: Use TronLink if available, otherwise show manual QR
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
            
            // DESKTOP: Show payment method selection (WalletConnect or QR)
            const choice = await showDesktopWalletModal();
            
            if (choice === 'back') {
                return initiateCryptoPayment(participantId, voteCount, amount);
            }
            
            if (choice === 'qr') {
                // Show manual payment modal with QR code AND browser wallet option
                const manualResult = await showBSCManualModal(recipient, amount, true);
                
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
            
            if (choice === 'walletconnect') {
                // Use WalletConnect with fallback to QR code
                try {
                    modal = showPaymentStatusModal(selectedNetwork, amount);
                    updateStatus(modal, 'Loading WalletConnect...');
                    
                    const provider = await connectWalletMobile();
                    updateStatus(modal, 'Sending transaction...');
                    
                    const result = await executeBSCTransferUnified(provider, recipient, amount);
                    
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
                } catch (wcError) {
                    console.warn('[WalletConnect] Failed, falling back to QR:', wcError.message);
                    
                    // Close the status modal if open
                    if (modal) modal.remove();
                    modal = null;
                    
                    // Show user-friendly message and offer QR fallback
                    showCryptoAlert('WalletConnect unavailable. Showing QR code instead.', 'warning', 4000);
                    
                    // Fall back to QR code payment (with browser wallet option on desktop)
                    const manualResult = await showBSCManualModal(recipient, amount, true);
                    
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
            }
            
            return { success: false, cancelled: true };
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
    CONFIG,
    ERROR_CODES
};

// ✅ Set ready flag for external scripts to check
window.CryptoPaymentsReady = true;

// ✅ Dispatch custom event to notify listeners that module is loaded
document.dispatchEvent(new CustomEvent('cryptoPaymentsReady'));

console.log('✅ Crypto Payments module loaded');