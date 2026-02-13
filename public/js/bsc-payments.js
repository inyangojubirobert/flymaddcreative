// ======================================================
// 🚀 BSC USDT PAYMENT SYSTEM - STANDALONE WITH WALLETCONNECT
// ======================================================

if (typeof window === 'undefined') {
    throw new Error('BSC Payments requires browser environment');
}

// ✅ Configuration
const BSC_CONFIG = {
    USDT_ADDRESS: '0x55d398326f99059fF775485246999027B3197955',
    RECIPIENT_ADDRESS: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
    CHAIN_ID: 56,
    CHAIN_ID_HEX: '0x38',
    RPC_URL: 'https://bsc-dataseed.binance.org/',
    EXPLORER_URL: 'https://bscscan.com/tx/',
    DEFAULT_AMOUNT: 2,
    USDT_DECIMALS: 18,
    WALLETCONNECT_PROJECT_ID: '61d9b98f81731dffa9988c0422676fc5'
};

// ✅ Application State
const BSC_STATE = {
    isProcessing: false,
    currentPaymentId: null,
    userAddress: null,
    walletConnectProvider: null
};

// ✅ Load Dependencies - FIXED QR CODE LOADING
async function loadBSCDependencies() {
    const deps = [];
    
    // Load QRCode library with CORRECT version (qrcodejs)
    if (typeof QRCode === 'undefined') {
        deps.push(new Promise((resolve) => {
            // Use qrcodejs which has the older API (new QRCode())
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
    
    // Load ethers
    if (typeof ethers === 'undefined') {
        deps.push(new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        }));
    }
    
    return Promise.allSettled(deps);
}

// ✅ Load WalletConnect
async function loadWalletConnect() {
    return new Promise((resolve, reject) => {
        if (window.EthereumProvider) {
            resolve(window.EthereumProvider);
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js';
        script.onload = () => {
            setTimeout(() => {
                if (window.EthereumProvider) {
                    resolve(window.EthereumProvider);
                } else {
                    reject(new Error('WalletConnect failed to initialize'));
                }
            }, 500);
        };
        script.onerror = () => reject(new Error('Failed to load WalletConnect'));
        document.head.appendChild(script);
    });
}

// ✅ Inject Styles
function injectBSCStyles() {
    if (document.getElementById('bsc-payment-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'bsc-payment-styles';
    style.textContent = `
        .bsc-modal-overlay {
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
        
        .bsc-modal {
            background: #1a1b1f;
            border-radius: 24px;
            width: 480px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid #F0B90B;
            color: white;
        }
        
        .bsc-modal-header {
            padding: 24px;
            border-bottom: 1px solid #F0B90B;
            position: relative;
        }
        
        .bsc-modal-title {
            font-size: 24px;
            font-weight: 700;
            color: #F0B90B;
            margin: 0;
        }
        
        .bsc-modal-close {
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
        
        .bsc-modal-close:hover {
            background: #F0B90B;
            color: black;
        }
        
        .bsc-modal-body {
            padding: 24px;
        }
        
        .bsc-amount-card {
            background: #2a2c33;
            border-radius: 16px;
            padding: 30px;
            text-align: center;
            margin-bottom: 20px;
            border: 1px solid #F0B90B;
        }
        
        .bsc-amount {
            font-size: 48px;
            font-weight: 900;
            color: #F0B90B;
            margin-bottom: 8px;
        }
        
        .bsc-address-card {
            background: #2a2c33;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 20px;
        }
        
        .bsc-address {
            font-family: monospace;
            word-break: break-all;
            background: rgba(0,0,0,0.3);
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
        }
        
        .bsc-qr-container {
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
        
        .bsc-qr-container img, .bsc-qr-container canvas {
            max-width: 100%;
            max-height: 100%;
        }
        
        .bsc-btn {
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
        
        .bsc-btn-primary {
            background: #F0B90B;
            color: black;
        }
        
        .bsc-btn-primary:hover {
            background: #d4a209;
        }
        
        .bsc-btn-secondary {
            background: #2a2c33;
            color: white;
            border: 1px solid #F0B90B;
        }
        
        .bsc-btn-secondary:hover {
            background: #3a3c44;
        }
        
        .bsc-btn-success {
            background: #0ECB81;
            color: white;
        }
        
        .bsc-alert {
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
        
        .bsc-alert.error {
            background: #F6465D;
        }
        
        .bsc-tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        .bsc-tab {
            flex: 1;
            padding: 12px;
            background: #2a2c33;
            border: 1px solid #3a3c44;
            border-radius: 8px;
            cursor: pointer;
            color: white;
            font-weight: 600;
        }
        
        .bsc-tab.active {
            background: #F0B90B;
            color: black;
            border-color: #F0B90B;
        }
        
        .bsc-input {
            width: 100%;
            padding: 12px;
            background: #2a2c33;
            border: 1px solid #3a3c44;
            border-radius: 8px;
            color: white;
            margin-bottom: 16px;
            font-family: monospace;
        }
        
        .bsc-input:focus {
            outline: none;
            border-color: #F0B90B;
        }
        
        .bsc-loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(240,185,11,0.3);
            border-top-color: #F0B90B;
            border-radius: 50%;
            animation: bsc-spin 1s linear infinite;
        }
        
        @keyframes bsc-spin {
            to { transform: rotate(360deg); }
        }
        
        .bsc-walletconnect-qr {
            text-align: center;
            padding: 20px;
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert
function showBSCAlert(message, type = 'success', duration = 3000) {
    const existing = document.querySelector('.bsc-alert');
    if (existing) existing.remove();
    
    const alert = document.createElement('div');
    alert.className = `bsc-alert ${type}`;
    alert.textContent = message;
    document.body.appendChild(alert);
    
    setTimeout(() => alert.remove(), duration);
}

// ✅ Create Modal
function createBSCModal(content, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'bsc-modal-overlay';
    overlay.innerHTML = `<div class="bsc-modal">${content}</div>`;
    document.body.appendChild(overlay);
    
    const closeBtn = overlay.querySelector('.bsc-modal-close');
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
function generateBSCQR(data, elementId) {
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
            // Use the CORRECT API for qrcodejs (v1)
            new QRCode(qrDiv, {
                text: data,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : undefined
            });
            
            // Add click to copy
            setTimeout(() => {
                const img = qrDiv.querySelector('img, canvas');
                if (img) {
                    img.style.cursor = 'pointer';
                    img.addEventListener('click', () => {
                        navigator.clipboard.writeText(data);
                        showBSCAlert('Payment data copied!', 'success');
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

// ✅ WalletConnect Connection
async function connectWalletConnect() {
    try {
        showBSCAlert('Loading WalletConnect...', 'info');
        
        const EthereumProvider = await loadWalletConnect();
        
        const provider = await EthereumProvider.init({
            projectId: BSC_CONFIG.WALLETCONNECT_PROJECT_ID,
            chains: [56],
            showQrModal: true,
            metadata: {
                name: "BSC Payment",
                description: "USDT Payment on BSC",
                url: window.location.origin,
                icons: []
            }
        });
        
        await provider.connect();
        const accounts = await provider.request({ method: 'eth_accounts' });
        
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts connected');
        }
        
        BSC_STATE.walletConnectProvider = provider;
        showBSCAlert(`Connected: ${accounts[0].substring(0,6)}...${accounts[0].substring(38)}`);
        
        return { provider, address: accounts[0] };
        
    } catch (error) {
        console.error('WalletConnect error:', error);
        showBSCAlert(error.message, 'error');
        throw error;
    }
}

// ✅ Browser Wallet Connection
async function connectBrowserWallet() {
    if (!window.ethereum) {
        throw new Error('No browser wallet found. Please install MetaMask.');
    }
    
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];
        
        // Check network
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== BSC_CONFIG.CHAIN_ID_HEX) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: BSC_CONFIG.CHAIN_ID_HEX }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: BSC_CONFIG.CHAIN_ID_HEX,
                            chainName: 'Binance Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: [BSC_CONFIG.RPC_URL],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw switchError;
                }
            }
        }
        
        showBSCAlert(`Connected: ${address.substring(0,6)}...${address.substring(38)}`);
        return { provider: window.ethereum, address };
        
    } catch (error) {
        console.error('Browser wallet error:', error);
        showBSCAlert(error.message, 'error');
        throw error;
    }
}

// ✅ Send USDT Transaction
async function sendUSDT(provider, fromAddress, toAddress, amount) {
    if (!window.ethers) {
        throw new Error('Ethers.js not loaded');
    }
    
    try {
        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();
        
        const usdtAbi = [
            "function transfer(address to, uint256 amount) returns (bool)",
            "function decimals() view returns (uint8)"
        ];
        
        const contract = new ethers.Contract(BSC_CONFIG.USDT_ADDRESS, usdtAbi, signer);
        
        const decimals = await contract.decimals();
        const amountWei = ethers.utils.parseUnits(amount.toString(), decimals);
        
        const tx = await contract.transfer(toAddress, amountWei);
        
        showBSCAlert('Transaction sent! Waiting for confirmation...', 'info');
        
        const receipt = await tx.wait();
        
        return {
            success: receipt.status === 1,
            txHash: tx.hash,
            explorerUrl: `${BSC_CONFIG.EXPLORER_URL}${tx.hash}`
        };
        
    } catch (error) {
        console.error('Transfer error:', error);
        if (error.code === 4001) {
            throw new Error('Transaction rejected');
        }
        throw new Error(error.message || 'Transaction failed');
    }
}

// ✅ Main Payment Modal
async function showBSCPaymentModal(amount = BSC_CONFIG.DEFAULT_AMOUNT, initialRecipient = BSC_CONFIG.RECIPIENT_ADDRESS) {
    await loadBSCDependencies();
    injectBSCStyles();
    
    let recipient = initialRecipient;
    let activeTab = 'qr';
    
    return new Promise((resolve) => {
        const modalContent = `
            <div class="bsc-modal-header">
                <h2 class="bsc-modal-title">🟡 BSC USDT Payment</h2>
                <button class="bsc-modal-close">×</button>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-amount-card">
                    <div class="bsc-amount">${amount} USDT</div>
                    <div style="color: rgba(255,255,255,0.6);">Amount to pay</div>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="color: rgba(255,255,255,0.8); font-size: 14px; display: block; margin-bottom: 8px;">
                        Recipient Address:
                    </label>
                    <input type="text" id="bscRecipient" class="bsc-input" value="${recipient}" placeholder="0x...">
                </div>
                
                <div class="bsc-tabs">
                    <button class="bsc-tab ${activeTab === 'qr' ? 'active' : ''}" data-tab="qr">📱 QR Code</button>
                    <button class="bsc-tab ${activeTab === 'wallet' ? 'active' : ''}" data-tab="wallet">👛 Wallet</button>
                </div>
                
                <div id="bscTabContent"></div>
                
                <div style="margin-top: 20px;">
                    <p style="color: rgba(255,255,255,0.6); margin-bottom: 8px;">Already paid?</p>
                    <input type="text" id="bscTxHash" class="bsc-input" placeholder="Paste transaction hash (0x...)">
                    <button id="bscConfirmManual" class="bsc-btn bsc-btn-success" style="margin-top: 8px;">✅ I've Already Paid</button>
                </div>
            </div>
        `;
        
        const modal = createBSCModal(modalContent, () => {
            resolve({ success: false, cancelled: true });
        });
        
        const updateTab = (tab) => {
            activeTab = tab;
            const tabs = modal.querySelectorAll('.bsc-tab');
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
            
            const content = modal.querySelector('#bscTabContent');
            recipient = modal.querySelector('#bscRecipient').value;
            
            if (tab === 'qr') {
                content.innerHTML = `
                    <div style="text-align: center;">
                        <p style="color: #F0B90B; margin-bottom: 10px;">Scan with any BSC wallet</p>
                        <div id="bscQR" class="bsc-qr-container"></div>
                        <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin-top: 10px;">
                            Send ONLY USDT on BSC network
                        </p>
                    </div>
                `;
                
                setTimeout(() => {
                    generateBSCQR(recipient, 'bscQR');
                }, 100);
                
            } else {
                content.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button id="bscBrowserWallet" class="bsc-btn bsc-btn-primary">
                            🦊 Connect Browser Wallet
                        </button>
                        <button id="bscWalletConnect" class="bsc-btn bsc-btn-secondary">
                            🔗 Connect with WalletConnect
                        </button>
                        <div id="bscWalletStatus" style="text-align: center; font-size: 14px; color: #F0B90B; min-height: 20px;"></div>
                    </div>
                `;
                
                // Browser wallet
                modal.querySelector('#bscBrowserWallet')?.addEventListener('click', async () => {
                    const status = modal.querySelector('#bscWalletStatus');
                    try {
                        status.innerHTML = '<span class="bsc-loading"></span> Connecting...';
                        const wallet = await connectBrowserWallet();
                        status.innerHTML = `✅ Connected: ${wallet.address.substring(0,6)}...${wallet.address.substring(38)}`;
                        
                        // Send transaction
                        if (confirm(`Send ${amount} USDT to ${recipient.substring(0,6)}...${recipient.substring(38)}?`)) {
                            status.innerHTML = '<span class="bsc-loading"></span> Sending transaction...';
                            const result = await sendUSDT(wallet.provider, wallet.address, recipient, amount);
                            
                            modal.remove();
                            resolve({
                                success: true,
                                txHash: result.txHash,
                                explorerUrl: result.explorerUrl,
                                method: 'browser-wallet'
                            });
                        }
                    } catch (error) {
                        status.innerHTML = `❌ ${error.message}`;
                    }
                });
                
                // WalletConnect
                modal.querySelector('#bscWalletConnect')?.addEventListener('click', async () => {
                    const status = modal.querySelector('#bscWalletStatus');
                    try {
                        status.innerHTML = '<span class="bsc-loading"></span> Opening WalletConnect...';
                        const wallet = await connectWalletConnect();
                        status.innerHTML = `✅ Connected: ${wallet.address.substring(0,6)}...${wallet.address.substring(38)}`;
                        
                        // Send transaction
                        if (confirm(`Send ${amount} USDT to ${recipient.substring(0,6)}...${recipient.substring(38)}?`)) {
                            status.innerHTML = '<span class="bsc-loading"></span> Sending transaction...';
                            const result = await sendUSDT(wallet.provider, wallet.address, recipient, amount);
                            
                            modal.remove();
                            resolve({
                                success: true,
                                txHash: result.txHash,
                                explorerUrl: result.explorerUrl,
                                method: 'walletconnect'
                            });
                        }
                    } catch (error) {
                        status.innerHTML = `❌ ${error.message}`;
                    }
                });
            }
        };
        
        // Tab switching
        modal.querySelectorAll('.bsc-tab').forEach(tab => {
            tab.addEventListener('click', () => updateTab(tab.dataset.tab));
        });
        
        // Recipient update
        modal.querySelector('#bscRecipient').addEventListener('input', (e) => {
            recipient = e.target.value;
            if (activeTab === 'qr') {
                setTimeout(() => generateBSCQR(recipient, 'bscQR'), 100);
            }
        });
        
        // Manual confirmation
        modal.querySelector('#bscConfirmManual').addEventListener('click', () => {
            const txHash = modal.querySelector('#bscTxHash').value.trim();
            
            if (!txHash) {
                if (!confirm('No transaction hash. Are you sure you already paid?')) {
                    return;
                }
                modal.remove();
                resolve({ success: false, manual: true, pendingConfirmation: true });
                return;
            }
            
            if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                showBSCAlert('Invalid transaction hash format', 'error');
                return;
            }
            
            modal.remove();
            resolve({
                success: true,
                manual: true,
                txHash,
                explorerUrl: `${BSC_CONFIG.EXPLORER_URL}${txHash}`
            });
        });
        
        // Initial render
        updateTab('qr');
    });
}

// ✅ Main Function
async function initiateBSCPayment(amount = BSC_CONFIG.DEFAULT_AMOUNT, options = {}) {
    if (BSC_STATE.isProcessing) {
        showBSCAlert('Payment already in progress', 'error');
        return { success: false, error: 'Processing' };
    }
    
    BSC_STATE.isProcessing = true;
    
    try {
        amount = parseFloat(amount);
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Invalid amount');
        }
        
        const result = await showBSCPaymentModal(amount, options.recipient);
        
        if (result.success) {
            showBSCAlert(`✅ Payment successful!`, 'success');
            if (options.onSuccess) options.onSuccess(result);
        }
        
        return result;
        
    } catch (error) {
        console.error('Payment error:', error);
        showBSCAlert(error.message, 'error');
        if (options.onError) options.onError(error);
        return { success: false, error: error.message };
        
    } finally {
        BSC_STATE.isProcessing = false;
    }
}

// ✅ Initialize
window.BSCPayments = {
    pay: initiateBSCPayment,
    pay2USDT: () => initiateBSCPayment(2),
    payCustom: (amount) => initiateBSCPayment(amount),
    setRecipient: (address) => {
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
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
            element.id
        );
    }
};
// At the VERY END of bsc-payments.js, add:

// Ensure BSCPayments is available
if (!window.BSCPayments) {
    window.BSCPayments = {
        pay: initiateBSCPayment,
        pay2USDT: () => initiateBSCPayment(2),
        payCustom: (amount) => initiateBSCPayment(amount)
    };
}

// Dispatch event
document.dispatchEvent(new CustomEvent('bscPaymentsReady'));
console.log('✅ BSC Payments Ready');
// Add at the VERY BOTTOM after console.log('✅ BSC Payments Ready')

// Also expose as initiateCryptoPayment for compatibility
if (!window.initiateCryptoPayment) {
    window.initiateCryptoPayment = async function(participantId, voteCount, amount) {
        console.log('[BSC] Using BSCPayments via initiateCryptoPayment fallback');
        const result = await initiateBSCPayment(amount, {
            participantId,
            voteCount
        });
        
        // Format to match expected structure
        return {
            success: result.success || false,
            cancelled: result.cancelled || false,
            txHash: result.txHash,
            payment_intent_id: result.txHash || `bsc_${Date.now()}`,
            payment_amount: amount,
            participant_id: participantId,
            ...result
        };
    };
}

// Also expose as processCryptoPayment for vote-payments.js compatibility
if (!window.processCryptoPayment) {
    window.processCryptoPayment = window.initiateCryptoPayment;
}

console.log('✅ BSC Payments compatibility layer added');
