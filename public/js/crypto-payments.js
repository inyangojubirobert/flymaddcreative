// ======================================================
// 🔷 CRYPTO PAYMENTS - DESKTOP TRON & MOBILE
// ======================================================

// ✅ Configuration
const CRYPTO_CONFIG = {
    // Tron USDT (TRC-20) - Desktop
    TRON_USDT_CONTRACT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    TRON_DEFAULT_RECIPIENT: 'TXYZ...', // Replace with your TRC-20 address
    TRON_EXPLORER: 'https://tronscan.org/#/transaction/',
    
    // BSC Mobile
    BSC_USDT_CONTRACT: '0x55d398326f99059fF775485246999027B3197955',
    BSC_DEFAULT_RECIPIENT: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
    BSC_EXPLORER: 'https://bscscan.com/tx/',
    
    DEFAULT_AMOUNT: 2,
    USDT_DECIMALS: 6
};

// ✅ Application State
const CRYPTO_STATE = {
    isProcessing: false,
    currentPayment: null,
    transactionHistory: []
};

// ✅ Load Dependencies
async function loadCryptoDependencies() {
    const deps = [];
    
    // TronWeb for desktop TRON
    if (typeof TronWeb === 'undefined' && !isMobileDevice()) {
        deps.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tronweb@5.3.0/dist/TronWeb.js';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
        }));
    }
    
    // QR Code for mobile
    if (typeof QRCode === 'undefined') {
        deps.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
        }));
    }
    
    return Promise.allSettled(deps);
}

// ✅ Device Detection
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// ✅ Inject Styles
function injectCryptoStyles() {
    if (document.getElementById('crypto-payment-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'crypto-payment-styles';
    style.textContent = `
        :root {
            --crypto-bg: #1a1b1f;
            --crypto-card: #2a2c33;
            --crypto-border: #3a3c44;
            --crypto-primary: #4169E1;
            --crypto-tron: #FF4B4B;
            --crypto-bsc: #F0B90B;
            --crypto-success: #0ECB81;
            --crypto-error: #F6465D;
        }
        
        .crypto-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(8px);
        }
        
        .crypto-modal {
            background: var(--crypto-bg);
            border-radius: 24px;
            width: 480px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid var(--crypto-border);
        }
        
        .crypto-modal-header {
            padding: 24px;
            border-bottom: 1px solid var(--crypto-border);
            position: relative;
        }
        
        .crypto-modal-title {
            font-size: 22px;
            font-weight: 700;
            margin: 0;
        }
        
        .crypto-tron-title { color: var(--crypto-tron); }
        .crypto-bsc-title { color: var(--crypto-bsc); }
        
        .crypto-modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: var(--crypto-card);
            border: none;
            color: white;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
        }
        
        .crypto-modal-body {
            padding: 24px;
        }
        
        .crypto-amount-card {
            background: var(--crypto-card);
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            margin-bottom: 20px;
        }
        
        .crypto-amount {
            font-size: 48px;
            font-weight: 900;
            margin-bottom: 8px;
        }
        
        .crypto-tron-amount { color: var(--crypto-tron); }
        .crypto-bsc-amount { color: var(--crypto-bsc); }
        
        .crypto-address-card {
            background: var(--crypto-card);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 20px;
        }
        
        .crypto-address {
            font-family: monospace;
            word-break: break-all;
            background: rgba(0,0,0,0.3);
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
        }
        
        .crypto-qr-container {
            width: 200px;
            height: 200px;
            margin: 20px auto;
            background: white;
            padding: 10px;
            border-radius: 12px;
        }
        
        .crypto-btn {
            width: 100%;
            padding: 16px;
            border: none;
            border-radius: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin: 8px 0;
        }
        
        .crypto-btn-tron {
            background: var(--crypto-tron);
            color: white;
        }
        
        .crypto-btn-bsc {
            background: var(--crypto-bsc);
            color: black;
        }
        
        .crypto-btn-success {
            background: var(--crypto-success);
            color: white;
        }
        
        .crypto-alert {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            z-index: 10001;
        }
        
        .crypto-success { background: var(--crypto-success); }
        .crypto-error { background: var(--crypto-error); }
        
        .crypto-mobile-badge {
            background: linear-gradient(135deg, var(--crypto-bsc), var(--crypto-tron));
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 13px;
            margin-bottom: 16px;
            text-align: center;
        }
        
        .crypto-network-selector {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }
        
        .crypto-network-btn {
            flex: 1;
            padding: 12px;
            border: 2px solid var(--crypto-border);
            background: var(--crypto-card);
            color: white;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .crypto-network-btn.active {
            border-color: var(--crypto-primary);
            background: rgba(65,105,225,0.2);
        }
        
        .crypto-network-btn.tron.active { border-color: var(--crypto-tron); }
        .crypto-network-btn.bsc.active { border-color: var(--crypto-bsc); }
    `;
    document.head.appendChild(style);
}

// ✅ Alert
function showCryptoAlert(message, type = 'success', duration = 3000) {
    const alert = document.createElement('div');
    alert.className = `crypto-alert crypto-${type}`;
    alert.textContent = message;
    document.body.appendChild(alert);
    
    setTimeout(() => alert.remove(), duration);
}

// ✅ Create Modal
function createCryptoModal(content, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'crypto-modal-overlay';
    overlay.innerHTML = `<div class="crypto-modal">${content}</div>`;
    document.body.appendChild(overlay);
    
    const closeBtn = overlay.querySelector('.crypto-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            overlay.remove();
            if (onClose) onClose();
        });
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            if (onClose) onClose();
        }
    });
    
    return overlay;
}

// ✅ Generate QR
function generateCryptoQR(data, element) {
    if (!element || !window.QRCode) return;
    element.innerHTML = '';
    
    try {
        new window.QRCode(element, {
            text: data,
            width: 180,
            height: 180
        });
    } catch (e) {
        console.warn('QR error:', e);
    }
}

// ✅ TRON Desktop Payment Modal
async function showTronDesktopModal(amount = CRYPTO_CONFIG.DEFAULT_AMOUNT) {
    const recipient = CRYPTO_CONFIG.TRON_DEFAULT_RECIPIENT;
    
    const content = `
        <div class="crypto-modal-header">
            <h2 class="crypto-modal-title crypto-tron-title">🔷 TRON USDT (TRC-20)</h2>
            <p style="color: rgba(255,255,255,0.7); margin-top: 5px;">Desktop Payment</p>
            <button class="crypto-modal-close">×</button>
        </div>
        <div class="crypto-modal-body">
            <div class="crypto-amount-card">
                <div class="crypto-amount crypto-tron-amount">${amount} USDT</div>
                <div style="color: rgba(255,255,255,0.6);">Amount</div>
            </div>
            
            <div class="crypto-address-card">
                <div style="margin-bottom: 8px; color: rgba(255,255,255,0.7);">📬 Recipient</div>
                <div class="crypto-address">${recipient}</div>
            </div>
            
            <button id="cryptoCopyAddress" class="crypto-btn crypto-btn-tron" style="margin-bottom: 12px;">
                📋 Copy Address
            </button>
            
            <button id="cryptoOpenTronLink" class="crypto-btn crypto-btn-tron">
                🔗 Open in TronLink
            </button>
            
            <div style="margin-top: 20px; padding: 16px; background: rgba(255,75,75,0.1); border-radius: 12px;">
                <strong>⚠️ Instructions:</strong>
                <ol style="margin-top: 10px; font-size: 14px; color: rgba(255,255,255,0.8);">
                    <li>Open TronLink extension</li>
                    <li>Send ${amount} USDT (TRC-20)</li>
                    <li>Use address above</li>
                </ol>
            </div>
            
            <button id="cryptoConfirmManual" class="crypto-btn crypto-btn-success" style="margin-top: 20px;">
                ✅ I've Sent Payment
            </button>
        </div>
    `;
    
    const modal = createCryptoModal(content);
    
    // Copy address
    modal.querySelector('#cryptoCopyAddress').addEventListener('click', () => {
        navigator.clipboard.writeText(recipient);
        showCryptoAlert('Address copied!');
    });
    
    // Open TronLink
    modal.querySelector('#cryptoOpenTronLink').addEventListener('click', () => {
        if (window.tronLink) {
            window.tronLink.request({ method: 'tron_requestAccounts' });
        } else {
            window.open('https://chrome.google.com/webstore/detail/tronlink/ibnejdfjmmkpcnlpebklmnkoeoihofec', '_blank');
        }
    });
    
    // Confirm
    return new Promise((resolve) => {
        modal.querySelector('#cryptoConfirmManual').addEventListener('click', () => {
            modal.remove();
            resolve({
                success: true,
                network: 'tron',
                amount: amount,
                recipient: recipient,
                timestamp: Date.now()
            });
        });
    });
}

// ✅ Mobile Payment Modal (BSC + TRON)
async function showMobilePaymentModal(amount = CRYPTO_CONFIG.DEFAULT_AMOUNT) {
    let selectedNetwork = 'bsc';
    
    const content = `
        <div class="crypto-modal-header">
            <h2 class="crypto-modal-title">📱 Mobile Payment</h2>
            <p style="color: rgba(255,255,255,0.7);">Scan with your wallet</p>
            <button class="crypto-modal-close">×</button>
        </div>
        <div class="crypto-modal-body">
            <div class="crypto-mobile-badge">
                ⚡ Optimized for mobile devices
            </div>
            
            <div class="crypto-amount-card">
                <div class="crypto-amount" style="color: var(--crypto-bsc);">${amount} USDT</div>
                <div style="color: rgba(255,255,255,0.6);">Amount</div>
            </div>
            
            <div class="crypto-network-selector">
                <button class="crypto-network-btn bsc active" data-network="bsc">
                    <span style="font-size: 20px;">🟡</span> BSC
                </button>
                <button class="crypto-network-btn tron" data-network="tron">
                    <span style="font-size: 20px;">🔷</span> TRON
                </button>
            </div>
            
            <div class="crypto-address-card">
                <div style="margin-bottom: 8px; color: rgba(255,255,255,0.7);">📬 Recipient</div>
                <div class="crypto-address" id="cryptoMobileAddress"></div>
            </div>
            
            <div class="crypto-qr-container" id="cryptoMobileQR"></div>
            
            <div style="text-align: center; margin: 16px 0; color: rgba(255,255,255,0.6); font-size: 13px;">
                Scan with any mobile wallet
            </div>
            
            <button id="cryptoCopyMobileAddress" class="crypto-btn crypto-btn-bsc" style="margin-bottom: 12px;">
                📋 Copy Address
            </button>
            
            <button id="cryptoMobileConfirm" class="crypto-btn crypto-btn-success">
                ✅ I've Paid
            </button>
        </div>
    `;
    
    const modal = createCryptoModal(content);
    
    // Get addresses
    const getAddresses = (network) => {
        if (network === 'bsc') {
            return {
                address: CRYPTO_CONFIG.BSC_DEFAULT_RECIPIENT,
                uri: `ethereum:${CRYPTO_CONFIG.BSC_USDT_CONTRACT}/transfer?address=${CRYPTO_CONFIG.BSC_DEFAULT_RECIPIENT}&uint256=${amount * 10**6}&chainId=56`
            };
        } else {
            return {
                address: CRYPTO_CONFIG.TRON_DEFAULT_RECIPIENT,
                uri: `tron:${CRYPTO_CONFIG.TRON_USDT_CONTRACT}/transfer?address=${CRYPTO_CONFIG.TRON_DEFAULT_RECIPIENT}&amount=${amount * 10**6}`
            };
        }
    };
    
    const updateDisplay = (network) => {
        const addresses = getAddresses(network);
        
        const addressEl = modal.querySelector('#cryptoMobileAddress');
        if (addressEl) addressEl.textContent = addresses.address;
        
        const qrEl = modal.querySelector('#cryptoMobileQR');
        if (qrEl) generateCryptoQR(addresses.uri, qrEl);
        
        const copyBtn = modal.querySelector('#cryptoCopyMobileAddress');
        if (copyBtn) {
            copyBtn.className = `crypto-btn crypto-btn-${network === 'bsc' ? 'bsc' : 'tron'}`;
        }
    };
    
    // Network switching
    const networkBtns = modal.querySelectorAll('.crypto-network-btn');
    networkBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            networkBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedNetwork = btn.dataset.network;
            updateDisplay(selectedNetwork);
        });
    });
    
    // Initial display
    updateDisplay('bsc');
    
    // Copy address
    modal.querySelector('#cryptoCopyMobileAddress').addEventListener('click', () => {
        const addresses = getAddresses(selectedNetwork);
        navigator.clipboard.writeText(addresses.address);
        showCryptoAlert('Address copied!');
    });
    
    // Confirm
    return new Promise((resolve) => {
        modal.querySelector('#cryptoMobileConfirm').addEventListener('click', () => {
            modal.remove();
            resolve({
                success: true,
                network: selectedNetwork,
                amount: amount,
                method: 'mobile',
                timestamp: Date.now()
            });
        });
    });
}

// ✅ Main Init Function
async function initiateCryptoPayment(amount = CRYPTO_CONFIG.DEFAULT_AMOUNT, options = {}) {
    await loadCryptoDependencies();
    injectCryptoStyles();
    
    if (CRYPTO_STATE.isProcessing) {
        showCryptoAlert('Payment in progress', 'error');
        return { success: false, error: 'Processing' };
    }
    
    CRYPTO_STATE.isProcessing = true;
    
    try {
        amount = parseFloat(amount);
        if (isNaN(amount) || amount <= 0) throw new Error('Invalid amount');
        
        let result;
        
        if (isMobileDevice()) {
            // Mobile - show combined modal
            result = await showMobilePaymentModal(amount);
        } else {
            // Desktop - TRON only
            result = await showTronDesktopModal(amount);
        }
        
        if (result.success) {
            showCryptoAlert(`✅ Payment initiated on ${result.network}`, 'success');
            
            CRYPTO_STATE.transactionHistory.push(result);
            
            if (options.onSuccess) options.onSuccess(result);
            
            return result;
        }
        
    } catch (error) {
        console.error('Payment error:', error);
        showCryptoAlert(error.message, 'error');
        
        if (options.onError) options.onError(error);
        
        return { success: false, error: error.message };
        
    } finally {
        CRYPTO_STATE.isProcessing = false;
    }
}

// ✅ Initialize
function initializeCryptoPayments() {
    injectCryptoStyles();
    
    window.CryptoPayments = {
        // Main function - auto detects device
        pay: initiateCryptoPayment,
        
        // Manual overrides
        payTronDesktop: (amount) => {
            if (isMobileDevice()) {
                showCryptoAlert('Use mobile modal for best experience', 'error');
                return;
            }
            return showTronDesktopModal(amount);
        },
        
        payMobile: (amount) => showMobilePaymentModal(amount),
        
        // Utilities
        isMobile: isMobileDevice,
        
        getHistory: () => [...CRYPTO_STATE.transactionHistory].reverse(),
        
        setRecipient: (network, address) => {
            if (network === 'tron') {
                CRYPTO_CONFIG.TRON_DEFAULT_RECIPIENT = address;
            } else if (network === 'bsc') {
                CRYPTO_CONFIG.BSC_DEFAULT_RECIPIENT = address;
            }
            showCryptoAlert(`${network.toUpperCase()} recipient updated`);
            return true;
        },
        
        version: '1.0.0'
    };
    
    console.log('🔷 Crypto Payments Ready - Desktop TRON + Mobile');
    return window.CryptoPayments;
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCryptoPayments);
} else {
    setTimeout(initializeCryptoPayments, 100);
}