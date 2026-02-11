// ======================================================
// 🚀 TRON USDT PAYMENT SYSTEM - STANDALONE v1.0
// ======================================================

// ✅ Ensure we're in browser
if (typeof window === 'undefined') {
    throw new Error('TRON Payments requires browser environment');
}

// ✅ Configuration
const TRON_CONFIG = {
    // TRON USDT contract address (TRC-20)
    USDT_ADDRESS: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    
    // Default recipient (can be changed via setRecipient)
    RECIPIENT_ADDRESS: 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL',
    
    // TRON Network settings
    EXPLORER_URL: 'https://tronscan.org/#/transaction/',
    TRONGRID_API: 'https://api.trongrid.io',
    
    // Payment defaults
    DEFAULT_AMOUNT: 2, // 2 USDT as requested
    USDT_DECIMALS: 6, // TRC-20 USDT uses 6 decimals
    
    // Wallet options
    WALLET_OPTIONS: [
        { id: 'tronlink', name: 'TronLink', icon: '🔴' },
        { id: 'trustwallet', name: 'Trust', icon: '🛡️' },
        { id: 'tokenpocket', name: 'TokenPocket', icon: '💰' }
    ]
};

// ✅ Application State
const TRON_STATE = {
    isProcessing: false,
    currentPaymentId: null,
    lastPaymentAmount: null,
    userAddress: null,
    transactionHistory: [],
    paymentSessions: {},
    lastPaymentAttempt: 0,
    rateLimitWindow: 5000
};

// ✅ Enhanced Utilities
const TRON_UTILS = {
    // Generate unique ID
    generateId: () => 'tron_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    
    // Copy to clipboard
    copyToClipboard: async (text) => {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textArea);
                return success;
            }
        } catch (e) {
            console.error('Copy failed:', e);
            return false;
        }
    },
    
    // Truncate address for display
    truncateAddress: (address, start = 6, end = 4) => {
        if (!address || address.length < 10) return address;
        return `${address.substring(0, start)}...${address.substring(address.length - end)}`;
    },
    
    // Validate TRON address
    validateAddress: (address) => {
        if (!address || typeof address !== 'string') return false;
        // TRON addresses start with T and are 34 characters
        return /^T[a-zA-Z0-9]{33}$/.test(address);
    },
    
    // Sanitize amount
    sanitizeAmount: (amount) => {
        if (typeof amount === 'string') {
            amount = amount.replace(/[^\d.]/g, '');
        }
        const num = parseFloat(amount);
        return isNaN(num) ? TRON_CONFIG.DEFAULT_AMOUNT : num.toFixed(2);
    },
    
    // Validate transaction hash
    validateTransactionHash: (txHash) => {
        if (!txHash) return false;
        txHash = txHash.trim();
        // TRON transaction hashes are 64 hex characters (no 0x prefix)
        return /^[a-fA-F0-9]{64}$/.test(txHash) ? txHash : false;
    },
    
    // Rate limiting check
    checkRateLimit: () => {
        const now = Date.now();
        if (now - TRON_STATE.lastPaymentAttempt < TRON_STATE.rateLimitWindow) {
            return false;
        }
        TRON_STATE.lastPaymentAttempt = now;
        return true;
    },
    
    // Check if TronLink is installed
    checkTronLinkInstalled: () => {
        return !!(window.tronWeb && window.tronWeb.ready);
    }
};

// ✅ Load dependencies dynamically
async function loadTronDependencies() {
    const dependencies = [];
    
    // Load QRCode library if not already loaded
    if (typeof QRCode === 'undefined') {
        dependencies.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => {
                console.warn('QRCode.js failed to load, using fallback');
                resolve();
            };
            document.head.appendChild(script);
        }));
    }
    
    // Load TronWeb if not already loaded
    if (typeof tronWeb === 'undefined') {
        dependencies.push(new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tronweb@5.3.0/dist/tronweb.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => {
                console.warn('TronWeb failed to load');
                reject(new Error('TronWeb library required for TRON transactions'));
            };
            document.head.appendChild(script);
        }));
    }
    
    return Promise.all(dependencies);
}

// ✅ CSS Styles - TRON Branding (Red theme)
function injectTronStyles() {
    if (document.getElementById('tron-payment-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'tron-payment-styles';
    style.textContent = `
        :root {
            --tron-red: #FF4B4B;
            --tron-red-dark: #E03A3A;
            --tron-red-light: #FF6B6B;
            --tron-black: #1A1A1A;
            --tron-gray: #2A2A2A;
            --tron-gray-light: #3A3A3A;
        }
        
        .tron-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: tronFadeIn 0.3s ease-out;
            backdrop-filter: blur(8px);
        }
        
        @keyframes tronFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .tron-modal {
            background: linear-gradient(135deg, var(--tron-gray) 0%, var(--tron-black) 100%);
            border-radius: 24px;
            width: 480px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            animation: tronSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 75, 75, 0.2);
        }
        
        @keyframes tronSlideUp {
            from { opacity: 0; transform: translateY(40px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .tron-modal-header {
            padding: 32px 32px 24px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
            background: linear-gradient(135deg, rgba(255, 75, 75, 0.1) 0%, rgba(255, 75, 75, 0.05) 100%);
            border-radius: 24px 24px 0 0;
        }
        
        .tron-modal-title {
            font-size: 26px;
            font-weight: 800;
            color: var(--tron-red);
            margin: 0;
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .tron-modal-close {
            position: absolute;
            top: 28px;
            right: 28px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            font-size: 22px;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        
        .tron-modal-close:hover {
            background: rgba(255, 75, 75, 0.2);
            color: var(--tron-red);
            transform: rotate(90deg);
        }
        
        .tron-modal-body {
            padding: 32px;
        }
        
        .tron-amount-card {
            background: linear-gradient(135deg, rgba(255, 75, 75, 0.15) 0%, rgba(255, 75, 75, 0.05) 100%);
            border-radius: 20px;
            padding: 36px 28px;
            text-align: center;
            margin-bottom: 32px;
            border: 2px solid rgba(255, 75, 75, 0.3);
        }
        
        .tron-amount {
            font-size: 56px;
            font-weight: 900;
            color: var(--tron-red);
            line-height: 1;
            margin-bottom: 8px;
            letter-spacing: -1.5px;
            text-shadow: 0 4px 20px rgba(255, 75, 75, 0.3);
        }
        
        .tron-address-card {
            background: var(--tron-gray-light);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 32px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .tron-address {
            font-family: 'SF Mono', monospace;
            font-size: 15px;
            word-break: break-all;
            color: white;
            line-height: 1.6;
            background: rgba(0, 0, 0, 0.3);
            padding: 18px;
            border-radius: 12px;
        }
        
        .tron-qr-container {
            width: 260px;
            height: 260px;
            margin: 0 auto 28px;
            background: white;
            border-radius: 20px;
            padding: 24px;
            border: 3px solid var(--tron-red);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .tron-btn {
            padding: 16px 24px;
            border-radius: 14px;
            border: none;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        
        .tron-btn-primary {
            background: linear-gradient(135deg, var(--tron-red) 0%, var(--tron-red-dark) 100%);
            color: white;
            box-shadow: 0 8px 20px rgba(255, 75, 75, 0.3);
        }
        
        .tron-btn-primary:hover {
            background: linear-gradient(135deg, var(--tron-red-light) 0%, var(--tron-red) 100%);
            transform: translateY(-3px);
            box-shadow: 0 12px 25px rgba(255, 75, 75, 0.4);
        }
        
        .tron-btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .tron-btn-success {
            background: linear-gradient(135deg, #0ECB81 0%, #0DAE71 100%);
            color: white;
        }
        
        .tron-alert {
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10001;
            padding: 16px 32px;
            border-radius: 14px;
            font-size: 16px;
            font-weight: 600;
            box-shadow: 0 15px 35px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            gap: 14px;
            animation: tronSlideDown 0.3s ease-out;
        }
        
        @keyframes tronSlideDown {
            from { opacity: 0; transform: translate(-50%, -30px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        
        .tron-alert-success { background: #0ECB81; color: white; }
        .tron-alert-error { background: var(--tron-red); color: white; }
        .tron-alert-info { background: #3b82f6; color: white; }
        
        @media (max-width: 480px) {
            .tron-modal {
                width: 95vw;
            }
            .tron-modal-header,
            .tron-modal-body {
                padding: 24px;
            }
            .tron-amount {
                font-size: 48px;
            }
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert System
function showTRONAlert(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.tron-alert');
    if (existing) existing.remove();
    
    const alert = document.createElement('div');
    alert.className = `tron-alert tron-alert-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    alert.innerHTML = `
        <span>${icons[type] || icons.info}</span>
        <span>${message}</span>
        <button class="tron-alert-close" style="
            background: none;
            border: none;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
            margin-left: auto;
        ">×</button>
    `;
    
    document.body.appendChild(alert);
    
    alert.querySelector('.tron-alert-close').addEventListener('click', () => {
        alert.remove();
    });
    
    if (duration > 0) {
        setTimeout(() => {
            if (alert.parentNode) {
                alert.style.opacity = '0';
                alert.style.transform = 'translate(-50%, -30px)';
                setTimeout(() => alert.remove(), 300);
            }
        }, duration);
    }
    
    return alert;
}

// ✅ Create Modal
function createTRONModal(content, onClose = null) {
    const overlay = document.createElement('div');
    overlay.className = 'tron-modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'tron-modal';
    modal.innerHTML = content;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    const closeBtn = modal.querySelector('.tron-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        });
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        }
    });
    
    return { overlay, modal };
}

// ✅ TRON USDT QR Code Generation
function generateTRONUSDTQR(recipient, amount, element) {
    if (!element) return;
    element.innerHTML = '';
    
    try {
        // ✅ TRON USDT uses 6 decimals
        const amountSun = BigInt(Math.round(parseFloat(amount) * 10 ** 6)).toString();
        
        // ✅ Native TRON USDT payment URI format
        // This is the STANDARD format that TronLink and all TRON wallets recognize
        const tronURI = `tron://${TRON_CONFIG.USDT_ADDRESS}/transfer?address=${recipient}&amount=${amountSun}`;
        
        // ✅ Alternative format that also works
        const simpleURI = `${recipient}?amount=${amount}&token=USDT`;
        
        // Determine QR content based on device
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const qrContent = isMobile ? recipient : tronURI;
        
        console.log('[TRON USDT QR] Using:', {
            mode: isMobile ? 'Mobile - Address' : 'Desktop - TRON URI',
            recipient,
            amount,
            amountSun,
            qrContent: qrContent.substring(0, 50) + '...'
        });

        // Generate QR code
        if (window.QRCode) {
            if (typeof window.QRCode.toCanvas === 'function') {
                const canvas = document.createElement('canvas');
                element.appendChild(canvas);
                
                window.QRCode.toCanvas(canvas, qrContent, {
                    width: 200,
                    margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' }
                }, (error) => {
                    if (error) {
                        console.warn('QR error:', error);
                        generateTRONFallbackQR(element, qrContent);
                    }
                });
            } else {
                new window.QRCode(element, {
                    text: qrContent,
                    width: 200,
                    height: 200
                });
            }
        } else {
            generateTRONFallbackQR(element, qrContent);
        }
        
        // ✅ Add TRON USDT badge
        const badgeDiv = document.createElement('div');
        badgeDiv.style.marginTop = '12px';
        badgeDiv.style.marginBottom = '8px';
        badgeDiv.style.textAlign = 'center';
        badgeDiv.innerHTML = `
            <span style="
                background: var(--tron-red);
                color: white;
                padding: 6px 16px;
                border-radius: 30px;
                font-size: 14px;
                font-weight: 600;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            ">
                🔴 TRON USDT · ${amount} USDT
            </span>
            <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-top: 6px;">
                TRC-20 USDT on TRON Network
            </div>
        `;
        element.appendChild(badgeDiv);
        
    } catch (error) {
        console.error('TRON QR generation failed:', error);
        element.innerHTML = `<div style="color: var(--tron-red);">❌ QR Generation Failed</div>`;
    }
}

// ✅ Fallback QR
function generateTRONFallbackQR(element, data) {
    const encodedData = encodeURIComponent(data);
    const qrUrl = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodedData}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.style.width = '200px';
    img.style.height = '200px';
    element.appendChild(img);
}

// ✅ Send TRON USDT Transaction
async function sendTRONUSDTTransaction(recipient, amount, fromAddress) {
    if (!window.tronWeb || !window.tronWeb.ready) {
        throw new Error('TronLink not installed or unlocked');
    }
    
    try {
        console.log('[TRON USDT] Starting transfer:', { recipient, amount, from: fromAddress });
        
        // Initialize contract
        const contract = await window.tronWeb.contract().at(TRON_CONFIG.USDT_ADDRESS);
        
        // TRC-20 USDT uses 6 decimals
        const amountWithDecimals = Math.floor(parseFloat(amount) * 10 ** 6);
        
        console.log('[TRON USDT] Amount in smallest unit:', amountWithDecimals);
        
        // Check balance first
        const balance = await contract.balanceOf(fromAddress).call();
        console.log('[TRON USDT] Current balance:', balance.toString());
        
        if (parseInt(balance.toString()) < amountWithDecimals) {
            throw new Error(`Insufficient USDT balance. Need ${amount} USDT`);
        }
        
        // Send transaction
        const tx = await contract.transfer(recipient, amountWithDecimals).send({
            feeLimit: 100 * 1e6, // 100 TRX max fee
            callValue: 0,
            shouldPollResponse: true
        });
        
        console.log('[TRON USDT] Transaction sent:', tx);
        
        // Get transaction ID
        const txID = typeof tx === 'string' ? tx : tx.transaction?.txID || tx.txid;
        
        if (!txID) {
            throw new Error('Failed to get transaction ID');
        }
        
        // Store in history
        TRON_STATE.transactionHistory.push({
            txHash: txID,
            amount: amount,
            recipient: recipient,
            from: fromAddress,
            timestamp: Date.now(),
            status: 'pending',
            network: 'TRON'
        });
        
        return {
            success: true,
            txHash: txID,
            explorerUrl: `${TRON_CONFIG.EXPLORER_URL}${txID}`
        };
        
    } catch (error) {
        console.error('[TRON USDT] Transaction error:', error);
        
        if (error.message.includes('User rejected')) {
            throw new Error('Transaction rejected by user');
        }
        
        if (error.message.includes('balance')) {
            throw new Error('Insufficient USDT balance');
        }
        
        if (error.message.includes('fee')) {
            throw new Error('Transaction fee too high. Please try again.');
        }
        
        throw new Error(`Transaction failed: ${error.message}`);
    }
}

// ✅ Connect TronLink Wallet
async function connectTronLink() {
    if (!window.tronWeb || !window.tronWeb.ready) {
        throw new Error('TronLink not installed. Please install TronLink wallet.');
    }
    
    try {
        // Request account access
        if (window.tronWeb.defaultAddress) {
            const address = window.tronWeb.defaultAddress.base58;
            TRON_STATE.userAddress = address;
            
            return {
                address,
                walletType: 'tronlink'
            };
        } else {
            throw new Error('No TronLink account found');
        }
        
    } catch (error) {
        console.error('TronLink connection error:', error);
        throw new Error(`TronLink connection failed: ${error.message}`);
    }
}

// ✅ Main TRON USDT Payment Modal
async function showTRONPaymentModal(amount = TRON_CONFIG.DEFAULT_AMOUNT, options = {}) {
    await loadTronDependencies();
    injectTronStyles();
    
    const recipient = options.recipient || TRON_CONFIG.RECIPIENT_ADDRESS;
    const paymentId = TRON_UTILS.generateId();
    TRON_STATE.currentPaymentId = paymentId;
    
    return new Promise((resolve) => {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        
        const modalContent = `
            <div class="tron-modal-header">
                <button class="tron-modal-close">×</button>
                <h2 class="tron-modal-title">🔴 Pay with USDT (TRON)</h2>
                <p class="tron-modal-subtitle" style="color: rgba(255,255,255,0.8); margin-top: 8px;">
                    Send ${amount} USDT on TRON Network
                </p>
            </div>
            
            <div class="tron-modal-body">
                <div class="tron-amount-card">
                    <div class="tron-amount">${amount} USDT</div>
                    <div style="color: rgba(255,255,255,0.7); margin-top: 8px;">TRC-20</div>
                </div>
                
                <div class="tron-address-card">
                    <div style="color: rgba(255,255,255,0.6); font-size: 14px; margin-bottom: 12px;">
                        📬 Recipient Address
                    </div>
                    <div class="tron-address">${recipient}</div>
                </div>
                
                <div class="tron-qr-container" id="tronQRCode"></div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px;">
                    <button id="tronCopyAddress" class="tron-btn tron-btn-secondary">
                        📋 Copy Address
                    </button>
                    <button id="tronViewOnExplorer" class="tron-btn tron-btn-secondary">
                        🔍 View on Tronscan
                    </button>
                </div>
                
                ${!isMobile ? `
                <div style="margin-bottom: 20px; padding: 16px; background: rgba(255,75,75,0.1); border-radius: 12px;">
                    <p style="color: var(--tron-red); font-size: 14px; margin-bottom: 12px;">
                        📱 Scan QR with your phone to open TronLink:
                    </p>
                    <button id="tronTrustWalletLink" style="
                        width: 100%;
                        padding: 14px;
                        background: #0B4F6C;
                        color: white;
                        border: none;
                        border-radius: 12px;
                        font-size: 16px;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 12px;
                        cursor: pointer;
                    ">
                        🛡️ Open in Trust Wallet (TRON USDT)
                    </button>
                </div>
                ` : ''}
                
                <div style="margin: 28px 0; position: relative; text-align: center;">
                    <div style="height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);"></div>
                    <div style="display: inline-block; background: var(--tron-gray); padding: 0 16px; position: relative; top: -12px; color: rgba(255,255,255,0.6); font-size: 13px;">
                        Already sent payment?
                    </div>
                </div>
                
                <input type="text" 
                       id="tronTxHash" 
                       placeholder="Paste transaction hash (64 characters)" 
                       style="
                           width: 100%;
                           padding: 16px 20px;
                           background: rgba(0,0,0,0.3);
                           border: 2px solid rgba(255,255,255,0.1);
                           border-radius: 14px;
                           color: white;
                           font-family: monospace;
                           margin-bottom: 20px;
                       ">
                
                <button id="tronConfirmManual" class="tron-btn tron-btn-success" style="width: 100%;">
                    ✅ I've Already Paid
                </button>
                
                <div style="text-align: center; margin-top: 24px;">
                    <div style="font-size: 12px; color: rgba(255, 255, 255, 0.5);">
                        Payment ID: ${paymentId}
                    </div>
                </div>
            </div>
        `;
        
        const { overlay, modal } = createTRONModal(modalContent, () => {
            resolve({ success: false, cancelled: true });
        });
        
        // Generate QR code
        setTimeout(() => {
            const qrContainer = modal.querySelector('#tronQRCode');
            if (qrContainer) {
                generateTRONUSDTQR(recipient, amount, qrContainer);
            }
        }, 100);
        
        // Copy address
        modal.querySelector('#tronCopyAddress').addEventListener('click', async () => {
            const success = await TRON_UTILS.copyToClipboard(recipient);
            if (success) {
                showTRONAlert('Address copied!', 'success');
            }
        });
        
        // View on Tronscan
        modal.querySelector('#tronViewOnExplorer').addEventListener('click', () => {
            window.open(`https://tronscan.org/#/address/${recipient}`, '_blank');
        });
        
        // Trust Wallet deep link (desktop)
        if (!isMobile) {
            const trustBtn = modal.querySelector('#tronTrustWalletLink');
            if (trustBtn) {
                trustBtn.addEventListener('click', () => {
                    const deepLink = 
                        `https://link.trustwallet.com/send` +
                        `?address=${TRON_CONFIG.USDT_ADDRESS}` +
                        `&amount=${amount}` +
                        `&token_id=${TRON_CONFIG.USDT_ADDRESS}` +
                        `&chain_id=tron` +
                        `&asset=USDT`;
                    window.open(deepLink, '_blank');
                    showTRONAlert('Opening Trust Wallet on mobile...', 'info');
                });
            }
        }
        
        // Manual confirmation
        modal.querySelector('#tronConfirmManual').addEventListener('click', () => {
            const txHash = modal.querySelector('#tronTxHash').value.trim();
            overlay.remove();
            
            if (!txHash) {
                resolve({ 
                    success: false, 
                    manual: true, 
                    pendingConfirmation: true,
                    paymentId
                });
                return;
            }
            
            const validatedHash = TRON_UTILS.validateTransactionHash(txHash);
            if (!validatedHash) {
                showTRONAlert('Invalid transaction hash (64 hex characters)', 'error');
                return;
            }
            
            resolve({ 
                success: true, 
                txHash: validatedHash, 
                explorerUrl: `${TRON_CONFIG.EXPLORER_URL}${validatedHash}`,
                method: 'manual',
                manual: true,
                paymentId
            });
        });
    });
}

// ✅ Main TRON USDT Payment Function
async function initiateTRONPayment(amount = TRON_CONFIG.DEFAULT_AMOUNT, options = {}) {
    // Rate limiting
    if (!TRON_UTILS.checkRateLimit()) {
        showTRONAlert('Please wait before making another payment', 'warning');
        return { success: false, error: 'Rate limited' };
    }
    
    if (TRON_STATE.isProcessing) {
        showTRONAlert('Another payment is processing', 'warning');
        return { success: false, error: 'Already processing' };
    }
    
    TRON_STATE.isProcessing = true;
    
    try {
        // Validate amount
        const sanitizedAmount = TRON_UTILS.sanitizeAmount(amount);
        amount = parseFloat(sanitizedAmount);
        
        if (amount <= 0) {
            throw new Error('Amount must be greater than zero');
        }
        
        // Validate recipient if provided
        if (options.recipient && !TRON_UTILS.validateAddress(options.recipient)) {
            throw new Error('Invalid TRON address format');
        }
        
        TRON_STATE.lastPaymentAmount = amount;
        
        // Show payment modal
        const result = await showTRONPaymentModal(amount, options);
        
        if (result.success) {
            showTRONAlert(`${amount} USDT payment confirmed!`, 'success', 5000);
            
            if (typeof options.onSuccess === 'function') {
                setTimeout(() => options.onSuccess(result), 100);
            }
            
            document.dispatchEvent(new CustomEvent('tronPaymentSuccess', {
                detail: { ...result, timestamp: Date.now() }
            }));
        }
        
        return result;
        
    } catch (error) {
        console.error('TRON Payment error:', error);
        showTRONAlert(`Payment failed: ${error.message}`, 'error', 5000);
        
        if (typeof options.onError === 'function') {
            setTimeout(() => options.onError(error), 100);
        }
        
        return { success: false, error: error.message };
    } finally {
        TRON_STATE.isProcessing = false;
    }
}

// ✅ Initialize TRON Payments
function initializeTRONPayments() {
    injectTronStyles();
    
    window.TRONPayments = {
        // Core functions
        init: initiateTRONPayment,
        initiate: initiateTRONPayment,
        pay: initiateTRONPayment,
        
        // Quick payment methods
        pay2USDT: () => initiateTRONPayment(2),
        pay5USDT: () => initiateTRONPayment(5),
        pay10USDT: () => initiateTRONPayment(10),
        
        // Configuration
        setRecipient: (address) => {
            if (!TRON_UTILS.validateAddress(address)) {
                showTRONAlert('Invalid TRON address', 'error');
                return false;
            }
            TRON_CONFIG.RECIPIENT_ADDRESS = address;
            showTRONAlert('Recipient address updated', 'success');
            return true;
        },
        
        setConfig: (key, value) => {
            if (TRON_CONFIG.hasOwnProperty(key)) {
                TRON_CONFIG[key] = value;
                return true;
            }
            return false;
        },
        
        getConfig: () => ({ ...TRON_CONFIG }),
        
        // Wallet functions
        connectTronLink: connectTronLink,
        checkTronLink: TRON_UTILS.checkTronLinkInstalled,
        
        // QR functions
        generateQR: (recipient, amount, element) => {
            generateTRONUSDTQR(
                recipient || TRON_CONFIG.RECIPIENT_ADDRESS,
                amount || TRON_CONFIG.DEFAULT_AMOUNT,
                element
            );
        },
        
        // Utility functions
        copyText: TRON_UTILS.copyToClipboard,
        truncateAddress: TRON_UTILS.truncateAddress,
        validateAddress: TRON_UTILS.validateAddress,
        showAlert: showTRONAlert,
        
        // State info
        isReady: true,
        version: '1.0.0',
        state: () => ({
            isProcessing: TRON_STATE.isProcessing,
            currentPaymentId: TRON_STATE.currentPaymentId,
            lastPaymentAmount: TRON_STATE.lastPaymentAmount,
            userAddress: TRON_STATE.userAddress
        })
    };
    
    window.TRONPaymentsReady = true;
    document.dispatchEvent(new CustomEvent('tronPaymentsReady'));
    
    console.log('🔴 TRON USDT Payment System v1.0 Ready');
    console.log('📋 Try: TRONPayments.pay2USDT() for 2 USDT on TRON');
    
    return window.TRONPayments;
}

// ✅ Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTRONPayments);
} else {
    setTimeout(initializeTRONPayments, 100);
}

// ✅ Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initializeTRONPayments, TRON_UTILS, TRON_CONFIG };
}