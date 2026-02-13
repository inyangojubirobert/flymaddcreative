// ======================================================
// 🔷 CRYPTO PAYMENTS - DESKTOP TRON + MOBILE
// ======================================================

if (typeof window === 'undefined') {
    throw new Error('Crypto Payments requires browser environment');
}

// ✅ Configuration
const CRYPTO_CONFIG = {
    TRON: {
        USDT_CONTRACT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        RECIPIENT: 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL',
        EXPLORER: 'https://tronscan.org/#/transaction/'
    },
    BSC: {
        USDT_CONTRACT: '0x55d398326f99059fF775485246999027B3197955',
        RECIPIENT: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
        EXPLORER: 'https://bscscan.com/tx/'
    },
    DEFAULT_AMOUNT: 2
};

// ✅ State
const CRYPTO_STATE = {
    isProcessing: false
};

// ✅ Load Dependencies - FIXED QR CODE LOADING
async function loadCryptoDependencies() {
    const deps = [];
    
    // Load QRCode with correct version (qrcodejs)
    if (typeof QRCode === 'undefined') {
        deps.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
            script.onload = resolve;
            script.onerror = () => {
                console.warn('QRCode.js failed, using fallback');
                resolve();
            };
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
            background: #1a1b1f;
            border-radius: 24px;
            width: 480px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid #3a3c44;
            color: white;
        }
        
        .crypto-modal-header {
            padding: 24px;
            border-bottom: 1px solid #3a3c44;
            position: relative;
        }
        
        .crypto-modal-title {
            font-size: 24px;
            font-weight: 700;
            margin: 0;
        }
        
        .crypto-modal-title.tron { color: #FF4B4B; }
        .crypto-modal-title.bsc { color: #F0B90B; }
        
        .crypto-modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: #2a2c33;
            border: none;
            color: white;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .crypto-modal-close:hover {
            background: #F0B90B;
            color: black;
        }
        
        .crypto-modal-body {
            padding: 24px;
        }
        
        .crypto-amount-card {
            background: #2a2c33;
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
        
        .crypto-amount.tron { color: #FF4B4B; }
        .crypto-amount.bsc { color: #F0B90B; }
        
        .crypto-address-card {
            background: #2a2c33;
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
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .crypto-qr-container img, .crypto-qr-container canvas {
            max-width: 100%;
            max-height: 100%;
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
            font-size: 16px;
        }
        
        .crypto-btn.tron {
            background: #FF4B4B;
            color: white;
        }
        
        .crypto-btn.bsc {
            background: #F0B90B;
            color: black;
        }
        
        .crypto-btn.success {
            background: #0ECB81;
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
            background: #0ECB81;
        }
        
        .crypto-alert.error {
            background: #F6465D;
        }
        
        .crypto-network-selector {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .crypto-network-btn {
            flex: 1;
            padding: 12px;
            background: #2a2c33;
            border: 1px solid #3a3c44;
            border-radius: 8px;
            color: white;
            cursor: pointer;
            font-weight: 600;
        }
        
        .crypto-network-btn.active {
            border-color: #F0B90B;
            background: rgba(240,185,11,0.1);
        }
        
        .crypto-network-btn.tron.active {
            border-color: #FF4B4B;
            background: rgba(255,75,75,0.1);
        }
        
        .crypto-input {
            width: 100%;
            padding: 12px;
            background: #2a2c33;
            border: 1px solid #3a3c44;
            border-radius: 8px;
            color: white;
            margin-bottom: 16px;
            font-family: monospace;
        }
        
        .crypto-input:focus {
            outline: none;
            border-color: #F0B90B;
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert
function showCryptoAlert(message, type = 'success', duration = 3000) {
    const existing = document.querySelector('.crypto-alert');
    if (existing) existing.remove();
    
    const alert = document.createElement('div');
    alert.className = `crypto-alert ${type}`;
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

// ✅ Generate QR - FIXED for qrcodejs (v1)
function generateCryptoQR(data, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    element.innerHTML = '';
    
    // Create a clean container
    const qrDiv = document.createElement('div');
    qrDiv.style.width = '180px';
    qrDiv.style.height = '180px';
    qrDiv.style.margin = '0 auto';
    element.appendChild(qrDiv);
    
    if (typeof QRCode !== 'undefined') {
        try {
            new QRCode(qrDiv, {
                text: data,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff"
            });
            
            // Add click to copy
            setTimeout(() => {
                const img = qrDiv.querySelector('img, canvas');
                if (img) {
                    img.style.cursor = 'pointer';
                    img.addEventListener('click', () => {
                        navigator.clipboard.writeText(data);
                        showCryptoAlert('Payment data copied!', 'success');
                    });
                }
            }, 100);
            
        } catch (e) {
            console.error('QR generation error:', e);
            useQRServer(qrDiv, data);
        }
    } else {
        useQRServer(qrDiv, data);
    }
}

// ✅ Fallback QR using external API
function useQRServer(element, data) {
    const encodedData = encodeURIComponent(data);
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodedData}`;
    img.style.width = '180px';
    img.style.height = '180px';
    img.alt = 'Payment QR';
    element.appendChild(img);
}

// ✅ Create payment QR content
function createPaymentQRContent(network, recipient, amount) {
    if (network === 'BSC') {
        // For BSC, use simple address format (most compatible)
        return recipient;
    } else if (network === 'TRON') {
        // For TRON, use custom format
        const amountSun = (amount * 1e6).toString();
        return `tron://pay?to=${recipient}&amount=${amountSun}&token=${CRYPTO_CONFIG.TRON.USDT_CONTRACT}`;
    }
    return recipient;
}

// ✅ TRON Desktop Modal
async function showTronDesktopModal(amount) {
    await loadCryptoDependencies();
    
    const recipient = CRYPTO_CONFIG.TRON.RECIPIENT;
    
    const content = `
        <div class="crypto-modal-header">
            <h2 class="crypto-modal-title tron">🔷 TRON USDT (TRC-20)</h2>
            <button class="crypto-modal-close">×</button>
        </div>
        <div class="crypto-modal-body">
            <div class="crypto-amount-card">
                <div class="crypto-amount tron">${amount} USDT</div>
                <div style="color: rgba(255,255,255,0.6);">Amount</div>
            </div>
            
            <div class="crypto-address-card">
                <div style="margin-bottom: 8px; color: rgba(255,255,255,0.7);">📬 Recipient</div>
                <div class="crypto-address">${recipient}</div>
            </div>
            
            <button id="copyAddress" class="crypto-btn tron">
                📋 Copy Address
            </button>
            
            <div style="background: rgba(255,75,75,0.1); border-radius: 12px; padding: 16px; margin: 16px 0;">
                <strong>⚠️ Instructions:</strong>
                <ol style="margin-top: 10px; font-size: 14px; color: rgba(255,255,255,0.8);">
                    <li>Open TronLink extension</li>
                    <li>Send ${amount} USDT (TRC-20)</li>
                    <li>Use address above</li>
                </ol>
            </div>
            
            <div style="margin-top: 16px;">
                <p style="color: rgba(255,255,255,0.6); margin-bottom: 8px;">Already paid?</p>
                <input type="text" id="txHashInput" class="crypto-input" placeholder="Transaction hash (optional)">
                <button id="confirmPayment" class="crypto-btn success">✅ I've Paid</button>
            </div>
        </div>
    `;
    
    const modal = createCryptoModal(content, () => {
        resolve({ success: false, cancelled: true });
    });
    
    return new Promise((resolve) => {
        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient);
            showCryptoAlert('Address copied!');
        };
        
        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (!txHash) {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            } else {
                resolve({
                    success: true,
                    manual: true,
                    txHash,
                    explorerUrl: `${CRYPTO_CONFIG.TRON.EXPLORER}${txHash}`
                });
            }
        };
    });
}

// ✅ Mobile Payment Modal
async function showMobilePaymentModal(amount) {
    await loadCryptoDependencies();
    
    let selectedNetwork = 'bsc';
    
    const content = `
        <div class="crypto-modal-header">
            <h2 class="crypto-modal-title">📱 Mobile Payment</h2>
            <button class="crypto-modal-close">×</button>
        </div>
        <div class="crypto-modal-body">
            <div class="crypto-amount-card">
                <div class="crypto-amount bsc">${amount} USDT</div>
                <div style="color: rgba(255,255,255,0.6);">Amount</div>
            </div>
            
            <div class="crypto-network-selector">
                <button class="crypto-network-btn bsc active" data-network="bsc">🟡 BSC</button>
                <button class="crypto-network-btn tron" data-network="tron">🔷 TRON</button>
            </div>
            
            <div class="crypto-address-card">
                <div style="margin-bottom: 8px;">📬 Recipient</div>
                <div class="crypto-address" id="mobileAddress"></div>
            </div>
            
            <div id="mobileQR" class="crypto-qr-container"></div>
            
            <div style="text-align: center; margin: 16px 0;">
                <button id="copyMobileAddress" class="crypto-btn bsc" style="width: auto; padding: 12px 24px; display: inline-block;">
                    📋 Copy Address
                </button>
            </div>
            
            <div style="margin-top: 16px;">
                <p style="color: rgba(255,255,255,0.6); margin-bottom: 8px;">Already paid?</p>
                <input type="text" id="txHashInput" class="crypto-input" placeholder="Transaction hash (optional)">
                <button id="confirmPayment" class="crypto-btn success">✅ I've Paid</button>
            </div>
        </div>
    `;
    
    const modal = createCryptoModal(content, () => {
        resolve({ success: false, cancelled: true });
    });
    
    const getAddresses = (network) => {
        if (network === 'bsc') {
            return {
                address: CRYPTO_CONFIG.BSC.RECIPIENT,
                uri: CRYPTO_CONFIG.BSC.RECIPIENT
            };
        } else {
            return {
                address: CRYPTO_CONFIG.TRON.RECIPIENT,
                uri: createPaymentQRContent('TRON', CRYPTO_CONFIG.TRON.RECIPIENT, amount)
            };
        }
    };
    
    const updateDisplay = (network) => {
        const addresses = getAddresses(network);
        
        const addressEl = modal.querySelector('#mobileAddress');
        if (addressEl) addressEl.textContent = addresses.address;
        
        const qrEl = modal.querySelector('#mobileQR');
        qrEl.innerHTML = '';
        const qrDiv = document.createElement('div');
        qrDiv.style.width = '180px';
        qrDiv.style.height = '180px';
        qrEl.appendChild(qrDiv);
        
        if (typeof QRCode !== 'undefined') {
            new QRCode(qrDiv, {
                text: addresses.uri,
                width: 180,
                height: 180
            });
        }
        
        const copyBtn = modal.querySelector('#copyMobileAddress');
        copyBtn.className = `crypto-btn ${network}`;
    };
    
    // Network switching
    modal.querySelectorAll('.crypto-network-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            modal.querySelectorAll('.crypto-network-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedNetwork = btn.dataset.network;
            updateDisplay(selectedNetwork);
        });
    });
    
    // Copy address
    modal.querySelector('#copyMobileAddress').onclick = () => {
        const addresses = getAddresses(selectedNetwork);
        navigator.clipboard.writeText(addresses.address);
        showCryptoAlert('Address copied!');
    };
    
    // Confirm payment
    return new Promise((resolve) => {
        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            modal.remove();
            
            if (!txHash) {
                resolve({
                    success: true,
                    network: selectedNetwork,
                    amount: amount,
                    method: 'mobile',
                    manual: true,
                    pendingConfirmation: true
                });
            } else {
                resolve({
                    success: true,
                    network: selectedNetwork,
                    amount: amount,
                    txHash: txHash,
                    explorerUrl: selectedNetwork === 'bsc' 
                        ? `${CRYPTO_CONFIG.BSC.EXPLORER}${txHash}`
                        : `${CRYPTO_CONFIG.TRON.EXPLORER}${txHash}`
                });
            }
        };
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
            result = await showMobilePaymentModal(amount);
        } else {
            result = await showTronDesktopModal(amount);
        }
        
        if (result.success) {
            showCryptoAlert(`✅ Payment initiated`, 'success');
            if (options.onSuccess) options.onSuccess(result);
        }
        
        return result;
        
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
window.CryptoPayments = {
    pay: initiateCryptoPayment,
    payMobile: (amount) => showMobilePaymentModal(amount),
    payTronDesktop: (amount) => showTronDesktopModal(amount),
    isMobile: isMobileDevice,
    generateQR: generateCryptoQR
};

console.log('✅ Crypto Payments Ready');