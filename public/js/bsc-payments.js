// ======================================================
// 🚀 BSC USDT PAYMENT SYSTEM - STANDALONE WITH WALLETCONNECT
// ======================================================

// ✅ Ensure we're in browser
if (typeof window === 'undefined') {
    throw new Error('BSC Payments requires browser environment');
}

// ✅ Configuration
const BSC_CONFIG = {
    // Default USDT contract on BSC
    USDT_ADDRESS: '0x55d398326f99059fF775485246999027B3197955',
    
    // Default recipient (can be changed)
    RECIPIENT_ADDRESS: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
    
    // BSC Network settings
    CHAIN_ID: 56,
    CHAIN_ID_HEX: '0x38',
    RPC_URL: 'https://bsc-dataseed.binance.org/',
    EXPLORER_URL: 'https://bscscan.com/tx/',
    
    // Payment defaults
    DEFAULT_AMOUNT: 2,
    USDT_DECIMALS: 6,
    
    // WalletConnect Project ID (from WalletConnect Cloud)
    WALLETCONNECT_PROJECT_ID: 'YOUR_PROJECT_ID', // Get from https://cloud.walletconnect.com
    WALLETCONNECT_RELAY_URL: 'wss://relay.walletconnect.com'
};

// ✅ Application State
const BSC_STATE = {
    isProcessing: false,
    currentPaymentId: null,
    lastPaymentAmount: null,
    userAddress: null,
    transactionHistory: [],
    walletConnectModal: null,
    walletConnectProvider: null,
    lastPaymentAttempt: 0,
    rateLimitWindow: 5000
};

// ✅ Load Dependencies
async function loadBSCDependencies() {
    const dependencies = [];
    
    // Load QRCode
    if (typeof QRCode === 'undefined') {
        dependencies.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
        }));
    }
    
    // Load ethers
    if (typeof ethers === 'undefined') {
        dependencies.push(new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        }));
    }
    
    // Load WalletConnect
    if (typeof window.WalletConnectProvider === 'undefined') {
        dependencies.push(new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@walletconnect/web3-provider@1.8.0/dist/umd/index.min.js';
            script.onload = resolve;
            script.onerror = () => console.warn('WalletConnect fallback to CDN');
            document.head.appendChild(script);
        }));
    }
    
    return Promise.allSettled(dependencies);
}

// ✅ Inject Styles
function injectBSCStyles() {
    if (document.getElementById('bsc-payment-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'bsc-payment-styles';
    style.textContent = `
        :root {
            --bsc-yellow: #F0B90B;
            --bsc-yellow-dark: #D4A209;
            --bsc-black: #14151A;
            --bsc-gray: #1E2026;
            --bsc-gray-light: #2B2F36;
            --bsc-success: #0ECB81;
            --bsc-error: #F6465D;
            --bsc-warning: #F0B90B;
            --bsc-info: #0E7BF6;
        }
        
        .bsc-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(8px);
            animation: bscFadeIn 0.3s;
        }
        
        @keyframes bscFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .bsc-modal {
            background: linear-gradient(135deg, var(--bsc-gray), var(--bsc-black));
            border-radius: 24px;
            width: 500px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid rgba(240, 185, 11, 0.3);
            box-shadow: 0 30px 60px rgba(0,0,0,0.5);
            animation: bscSlideUp 0.4s;
        }
        
        @keyframes bscSlideUp {
            from { transform: translateY(50px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        
        .bsc-modal-header {
            padding: 24px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            background: linear-gradient(135deg, rgba(240,185,11,0.1), transparent);
            position: relative;
        }
        
        .bsc-modal-title {
            font-size: 24px;
            font-weight: 800;
            color: var(--bsc-yellow);
            margin: 0;
        }
        
        .bsc-modal-subtitle {
            color: rgba(255,255,255,0.7);
            margin-top: 8px;
            font-size: 14px;
        }
        
        .bsc-modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(255,255,255,0.1);
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
            transition: all 0.2s;
        }
        
        .bsc-modal-close:hover {
            background: var(--bsc-yellow);
            color: var(--bsc-black);
            transform: rotate(90deg);
        }
        
        .bsc-modal-body {
            padding: 24px;
        }
        
        .bsc-amount-card {
            background: linear-gradient(135deg, rgba(240,185,11,0.15), rgba(240,185,11,0.05));
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            margin-bottom: 24px;
            border: 2px solid rgba(240,185,11,0.3);
        }
        
        .bsc-amount {
            font-size: 48px;
            font-weight: 900;
            color: var(--bsc-yellow);
            line-height: 1;
            margin-bottom: 8px;
        }
        
        .bsc-amount-label {
            color: rgba(255,255,255,0.6);
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .bsc-address-card {
            background: var(--bsc-gray-light);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
        }
        
        .bsc-address-label {
            color: rgba(255,255,255,0.6);
            font-size: 12px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .bsc-address {
            font-family: monospace;
            word-break: break-all;
            background: rgba(0,0,0,0.3);
            padding: 12px;
            border-radius: 8px;
            font-size: 14px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        
        .bsc-qr-section {
            text-align: center;
            margin: 24px 0;
        }
        
        .bsc-qr-title {
            color: var(--bsc-yellow);
            font-weight: 600;
            margin-bottom: 16px;
            font-size: 16px;
        }
        
        .bsc-qr-container {
            width: 240px;
            height: 240px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            padding: 16px;
            border: 3px solid var(--bsc-yellow);
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .bsc-qr-container:hover {
            transform: scale(1.02);
        }
        
        .bsc-qr-container img,
        .bsc-qr-container canvas {
            width: 100% !important;
            height: 100% !important;
        }
        
        .bsc-wallet-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin: 24px 0;
        }
        
        .bsc-wallet-btn {
            background: var(--bsc-gray-light);
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            color: white;
            font-weight: 600;
        }
        
        .bsc-wallet-btn:hover {
            border-color: var(--bsc-yellow);
            background: rgba(240,185,11,0.1);
            transform: translateY(-2px);
        }
        
        .bsc-wallet-icon {
            font-size: 24px;
        }
        
        .bsc-walletconnect-qr {
            background: var(--bsc-gray-light);
            border-radius: 12px;
            padding: 24px;
            margin: 20px 0;
            text-align: center;
        }
        
        .bsc-recipient-input {
            width: 100%;
            padding: 14px;
            background: rgba(0,0,0,0.3);
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            color: white;
            font-family: monospace;
            margin-bottom: 16px;
            transition: all 0.2s;
        }
        
        .bsc-recipient-input:focus {
            outline: none;
            border-color: var(--bsc-yellow);
        }
        
        .bsc-btn {
            width: 100%;
            padding: 16px;
            border: none;
            border-radius: 12px;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .bsc-btn-primary {
            background: linear-gradient(135deg, var(--bsc-yellow), var(--bsc-yellow-dark));
            color: var(--bsc-black);
        }
        
        .bsc-btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(240,185,11,0.3);
        }
        
        .bsc-btn-success {
            background: var(--bsc-success);
            color: white;
        }
        
        .bsc-btn-success:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(14,203,129,0.3);
        }
        
        .bsc-btn-secondary {
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
        }
        
        .bsc-btn-secondary:hover {
            background: rgba(255,255,255,0.2);
        }
        
        .bsc-alert {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 16px 24px;
            border-radius: 12px;
            color: white;
            font-weight: 600;
            z-index: 10001;
            animation: bscAlert 0.3s;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        
        @keyframes bscAlert {
            from { transform: translate(-50%, -20px); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
        }
        
        .bsc-alert-success { background: var(--bsc-success); }
        .bsc-alert-error { background: var(--bsc-error); }
        .bsc-alert-warning { background: var(--bsc-warning); color: var(--bsc-black); }
        .bsc-alert-info { background: var(--bsc-info); }
        
        .bsc-tab-container {
            display: flex;
            gap: 8px;
            margin-bottom: 24px;
            background: var(--bsc-gray-light);
            padding: 4px;
            border-radius: 12px;
        }
        
        .bsc-tab {
            flex: 1;
            padding: 12px;
            text-align: center;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 600;
            border: none;
            background: transparent;
            color: rgba(255,255,255,0.7);
        }
        
        .bsc-tab.active {
            background: var(--bsc-yellow);
            color: var(--bsc-black);
        }
        
        .bsc-network-badge {
            background: rgba(240,185,11,0.2);
            border: 1px solid var(--bsc-yellow);
            border-radius: 20px;
            padding: 8px 16px;
            display: inline-block;
            color: var(--bsc-yellow);
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .bsc-divider {
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            margin: 24px 0;
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert System
function showBSCAlert(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.bsc-alert');
    if (existing) existing.remove();
    
    const alert = document.createElement('div');
    alert.className = `bsc-alert bsc-alert-${type}`;
    alert.innerHTML = message;
    document.body.appendChild(alert);
    
    if (duration > 0) {
        setTimeout(() => {
            alert.style.opacity = '0';
            setTimeout(() => alert.remove(), 300);
        }, duration);
    }
    
    return alert;
}

// ✅ Modal Creator
function createBSCModal(content, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'bsc-modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'bsc-modal';
    modal.innerHTML = content;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    };
    
    const closeModal = () => {
        overlay.remove();
        document.removeEventListener('keydown', handleEscape);
        if (onClose) onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    
    const closeBtn = modal.querySelector('.bsc-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeModal();
        }
    });
    
    return { overlay, modal, closeModal };
}

// ✅ QR Generation
function generateBSCQR(recipient, amount, element) {
    if (!element) return;
    element.innerHTML = '';
    
    try {
        const amountUnits = BigInt(Math.round(parseFloat(amount) * 10 ** 6)).toString();
        
        const paymentURI = `ethereum:${BSC_CONFIG.USDT_ADDRESS}/transfer?address=${recipient}&uint256=${amountUnits}&chainId=56`;
        
        if (window.QRCode) {
            if (typeof window.QRCode.toCanvas === 'function') {
                const canvas = document.createElement('canvas');
                element.appendChild(canvas);
                
                window.QRCode.toCanvas(canvas, paymentURI, {
                    width: 200,
                    margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' }
                }, (error) => {
                    if (error) {
                        console.warn('QR error:', error);
                        useQRServer(element, paymentURI);
                    }
                });
            } else {
                new window.QRCode(element, {
                    text: paymentURI,
                    width: 200,
                    height: 200
                });
            }
        } else {
            useQRServer(element, paymentURI);
        }
        
        // Add click to copy
        setTimeout(() => {
            const qrElement = element.querySelector('canvas, img');
            if (qrElement) {
                qrElement.style.cursor = 'pointer';
                qrElement.title = 'Click to copy payment URI';
                qrElement.addEventListener('click', () => {
                    navigator.clipboard.writeText(paymentURI);
                    showBSCAlert('Payment URI copied!', 'success');
                });
            }
        }, 100);
        
    } catch (error) {
        console.error('QR error:', error);
        element.innerHTML = '<div style="color: var(--bsc-error);">QR Error</div>';
    }
}

function useQRServer(element, data) {
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
    img.style.width = '200px';
    img.style.height = '200px';
    img.alt = 'Payment QR';
    element.appendChild(img);
}

// ✅ WalletConnect Provider
async function initWalletConnect() {
    if (!window.WalletConnectProvider) {
        throw new Error('WalletConnect not loaded');
    }
    
    try {
        const provider = new window.WalletConnectProvider.default({
            rpc: {
                56: 'https://bsc-dataseed.binance.org/'
            },
            chainId: 56,
            qrcodeModal: {
                open: (uri, callback) => {
                    // Show QR modal
                    showWalletConnectQR(uri);
                    callback();
                },
                close: () => {
                    const qrModal = document.querySelector('.bsc-wc-qr-modal');
                    if (qrModal) qrModal.remove();
                }
            }
        });
        
        await provider.enable();
        return provider;
        
    } catch (error) {
        console.error('WalletConnect error:', error);
        throw error;
    }
}

// ✅ Show WalletConnect QR
function showWalletConnectQR(uri) {
    const modal = document.createElement('div');
    modal.className = 'bsc-modal-overlay bsc-wc-qr-modal';
    modal.innerHTML = `
        <div class="bsc-modal" style="width: 400px;">
            <div class="bsc-modal-header">
                <h3 class="bsc-modal-title">🔗 WalletConnect</h3>
                <button class="bsc-modal-close">×</button>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-walletconnect-qr">
                    <div style="margin-bottom: 20px;">Scan with WalletConnect</div>
                    <div id="wc-qr-container" style="width: 250px; height: 250px; margin: 0 auto;"></div>
                    <div style="margin-top: 20px; font-size: 12px; color: rgba(255,255,255,0.5);">
                        Open your WalletConnect-compatible wallet and scan
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Generate QR for URI
    setTimeout(() => {
        const qrContainer = modal.querySelector('#wc-qr-container');
        if (qrContainer && window.QRCode) {
            new window.QRCode(qrContainer, {
                text: uri,
                width: 250,
                height: 250
            });
        }
    }, 100);
    
    // Close button
    modal.querySelector('.bsc-modal-close').addEventListener('click', () => {
        modal.remove();
    });
}

// ✅ Main Payment Modal
async function showBSCPaymentModal(amount = BSC_CONFIG.DEFAULT_AMOUNT, initialRecipient = BSC_CONFIG.RECIPIENT_ADDRESS) {
    await loadBSCDependencies();
    injectBSCStyles();
    
    let recipient = initialRecipient;
    let activeTab = 'qr'; // 'qr' or 'wallet'
    
    return new Promise((resolve) => {
        const renderModal = () => {
            const modalContent = `
                <div class="bsc-modal-header">
                    <h2 class="bsc-modal-title">🟡 BSC USDT Payment</h2>
                    <p class="bsc-modal-subtitle">Send on Binance Smart Chain (BEP-20)</p>
                    <button class="bsc-modal-close">×</button>
                </div>
                
                <div class="bsc-modal-body">
                    <div class="bsc-amount-card">
                        <div class="bsc-amount">${amount} USDT</div>
                        <div class="bsc-amount-label">Payment Amount</div>
                    </div>
                    
                    <div class="bsc-network-badge">
                        ⚡ BSC Network (BEP-20)
                    </div>
                    
                    <label style="color: rgba(255,255,255,0.8); font-size: 14px; margin-bottom: 8px; display: block;">
                        Recipient Address:
                    </label>
                    <input type="text" 
                           id="bscRecipientInput" 
                           class="bsc-recipient-input" 
                           value="${recipient}"
                           placeholder="0x...">
                    
                    <div class="bsc-tab-container">
                        <button class="bsc-tab ${activeTab === 'qr' ? 'active' : ''}" data-tab="qr">📱 QR Code</button>
                        <button class="bsc-tab ${activeTab === 'wallet' ? 'active' : ''}" data-tab="wallet">👛 Wallet</button>
                    </div>
                    
                    <div id="bscTabContent"></div>
                    
                    <div class="bsc-divider"></div>
                    
                    <button id="bscConfirmPayment" class="bsc-btn bsc-btn-success">
                        ✅ Confirm Payment
                    </button>
                </div>
            `;
            
            const { overlay, modal, closeModal } = createBSCModal(modalContent, () => {
                resolve({ success: false, cancelled: true });
            });
            
            // Tab switching
            const tabs = modal.querySelectorAll('.bsc-tab');
            const tabContent = modal.querySelector('#bscTabContent');
            
            const switchTab = (tab) => {
                activeTab = tab;
                tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                
                recipient = modal.querySelector('#bscRecipientInput').value;
                
                if (tab === 'qr') {
                    tabContent.innerHTML = `
                        <div class="bsc-qr-section">
                            <div class="bsc-qr-title">🔍 Scan with any BSC wallet</div>
                            <div class="bsc-qr-container" id="bscQRCode"></div>
                            <div style="margin-top: 16px; font-size: 13px; color: rgba(255,255,255,0.5);">
                                Click QR to copy payment URI
                            </div>
                        </div>
                    `;
                    
                    setTimeout(() => {
                        const qrEl = modal.querySelector('#bscQRCode');
                        if (qrEl) {
                            generateBSCQR(recipient, amount, qrEl);
                        }
                    }, 100);
                    
                } else {
                    tabContent.innerHTML = `
                        <div class="bsc-wallet-options">
                            <button class="bsc-wallet-btn" id="bscBrowserWallet">
                                <span class="bsc-wallet-icon">🦊</span>
                                <span>Browser Wallet</span>
                            </button>
                            <button class="bsc-wallet-btn" id="bscWalletConnect">
                                <span class="bsc-wallet-icon">🔗</span>
                                <span>WalletConnect</span>
                            </button>
                        </div>
                        <div id="bscWalletStatus" style="text-align: center; font-size: 14px; color: rgba(255,255,255,0.6); min-height: 40px;"></div>
                    `;
                    
                    // Browser wallet
                    modal.querySelector('#bscBrowserWallet')?.addEventListener('click', async () => {
                        try {
                            const statusEl = modal.querySelector('#bscWalletStatus');
                            statusEl.innerHTML = '🔄 Connecting...';
                            
                            if (!window.ethereum) {
                                throw new Error('No wallet found. Please install MetaMask.');
                            }
                            
                            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                            const address = accounts[0];
                            
                            statusEl.innerHTML = `✅ Connected: ${address.slice(0,6)}...${address.slice(-4)}`;
                            
                            // Check network
                            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                            if (chainId !== '0x38') {
                                statusEl.innerHTML += '<br>⚠️ Switch to BSC network';
                            }
                            
                        } catch (error) {
                            modal.querySelector('#bscWalletStatus').innerHTML = `❌ ${error.message}`;
                        }
                    });
                    
                    // WalletConnect
                    modal.querySelector('#bscWalletConnect')?.addEventListener('click', async () => {
                        try {
                            const statusEl = modal.querySelector('#bscWalletStatus');
                            statusEl.innerHTML = '🔄 Initializing WalletConnect...';
                            
                            const provider = await initWalletConnect();
                            const accounts = await provider.request({ method: 'eth_accounts' });
                            
                            if (accounts && accounts.length > 0) {
                                statusEl.innerHTML = `✅ Connected: ${accounts[0].slice(0,6)}...${accounts[0].slice(-4)}`;
                                BSC_STATE.walletConnectProvider = provider;
                            }
                            
                        } catch (error) {
                            modal.querySelector('#bscWalletStatus').innerHTML = `❌ ${error.message}`;
                        }
                    });
                }
            };
            
            tabs.forEach(tab => {
                tab.addEventListener('click', () => switchTab(tab.dataset.tab));
            });
            
            // Initial render
            switchTab(activeTab);
            
            // Recipient input update
            modal.querySelector('#bscRecipientInput').addEventListener('input', (e) => {
                recipient = e.target.value;
                if (activeTab === 'qr') {
                    const qrEl = modal.querySelector('#bscQRCode');
                    if (qrEl) {
                        generateBSCQR(recipient, amount, qrEl);
                    }
                }
            });
            
            // Confirm payment
            modal.querySelector('#bscConfirmPayment').addEventListener('click', () => {
                recipient = modal.querySelector('#bscRecipientInput').value;
                
                if (!recipient || !recipient.match(/^0x[a-fA-F0-9]{40}$/)) {
                    showBSCAlert('Invalid recipient address', 'error');
                    return;
                }
                
                closeModal();
                resolve({
                    success: true,
                    amount: amount,
                    recipient: recipient,
                    method: activeTab === 'qr' ? 'qr' : 'wallet',
                    timestamp: Date.now()
                });
            });
        };
        
        renderModal();
    });
}

// ✅ Main Function
async function initiateBSCPayment(amount = BSC_CONFIG.DEFAULT_AMOUNT, options = {}) {
    if (BSC_STATE.isProcessing) {
        showBSCAlert('Payment already in progress', 'warning');
        return { success: false, error: 'Already processing' };
    }
    
    BSC_STATE.isProcessing = true;
    
    try {
        // Sanitize amount
        amount = parseFloat(amount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Invalid amount');
        }
        
        // Show modal
        const result = await showBSCPaymentModal(amount, options.recipient);
        
        if (result.success) {
            showBSCAlert(`✅ Payment initiated: ${amount} USDT`, 'success');
            
            // Store in history
            BSC_STATE.transactionHistory.push(result);
            
            // Callback
            if (options.onSuccess) options.onSuccess(result);
            
            return result;
        }
        
        return result;
        
    } catch (error) {
        console.error('Payment error:', error);
        showBSCAlert(`❌ ${error.message}`, 'error');
        
        if (options.onError) options.onError(error);
        
        return { success: false, error: error.message };
        
    } finally {
        BSC_STATE.isProcessing = false;
    }
}

// ✅ Initialize
function initializeBSCPayments() {
    injectBSCStyles();
    
    window.BSCPayments = {
        init: initiateBSCPayment,
        pay: initiateBSCPayment,
        pay2USDT: () => initiateBSCPayment(2),
        payCustom: (amount) => initiateBSCPayment(amount),
        
        setRecipient: (address) => {
            if (!address.match(/^0x[a-fA-F0-9]{40}$/)) {
                showBSCAlert('Invalid address', 'error');
                return false;
            }
            BSC_CONFIG.RECIPIENT_ADDRESS = address;
            showBSCAlert('Recipient updated', 'success');
            return true;
        },
        
        generateQR: (element, amount, recipient) => {
            generateBSCQR(
                recipient || BSC_CONFIG.RECIPIENT_ADDRESS,
                amount || BSC_CONFIG.DEFAULT_AMOUNT,
                element
            );
        },
        
        getHistory: () => [...BSC_STATE.transactionHistory].reverse(),
        
        version: '1.0.0',
        isReady: true
    };
    
    console.log('🚀 BSC Payments Ready with WalletConnect');
    return window.BSCPayments;
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBSCPayments);
} else {
    setTimeout(initializeBSCPayments, 100);
}