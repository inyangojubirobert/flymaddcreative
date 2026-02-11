// ... (CONTINUATION FROM YOUR PROVIDED CODE)

// ✅ CSS Styles - COMPLETE
function injectStyles() {
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
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.25s ease-out;
            backdrop-filter: blur(4px);
        }
        
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .bsc-modal {
            background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
            border-radius: 20px;
            width: 460px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            animation: slideUp 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .bsc-modal-header {
            padding: 28px 28px 20px;
            border-bottom: 1px solid #e2e8f0;
            position: relative;
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-radius: 20px 20px 0 0;
        }
        
        .bsc-modal-title {
            font-size: 24px;
            font-weight: 800;
            color: #92400e;
            margin: 0;
            letter-spacing: -0.5px;
        }
        
        .bsc-modal-subtitle {
            font-size: 15px;
            color: #92400e;
            margin-top: 6px;
            opacity: 0.9;
            font-weight: 500;
        }
        
        .bsc-modal-close {
            position: absolute;
            top: 24px;
            right: 24px;
            background: rgba(255, 255, 255, 0.9);
            border: none;
            font-size: 20px;
            color: #64748b;
            cursor: pointer;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            font-weight: 300;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .bsc-modal-close:hover {
            background: white;
            color: #1e293b;
            transform: rotate(90deg);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .bsc-modal-body {
            padding: 28px;
        }
        
        .bsc-amount-card {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            border-radius: 16px;
            padding: 32px 24px;
            text-align: center;
            margin-bottom: 28px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        }
        
        .bsc-amount-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: linear-gradient(90deg, #f59e0b, #fbbf24);
        }
        
        .bsc-amount {
            font-size: 48px;
            font-weight: 900;
            color: #fbbf24;
            line-height: 1;
            margin-bottom: 8px;
            letter-spacing: -1px;
        }
        
        .bsc-amount-usd {
            font-size: 18px;
            color: #cbd5e1;
            font-weight: 500;
            margin-bottom: 12px;
            opacity: 0.9;
        }
        
        .bsc-amount-label {
            font-size: 14px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }
        
        .bsc-address-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 28px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
        }
        
        .bsc-address {
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Roboto Mono', monospace;
            font-size: 14px;
            word-break: break-all;
            color: #1e293b;
            line-height: 1.6;
            background: #f8fafc;
            padding: 16px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }
        
        .bsc-qr-container {
            width: 240px;
            height: 240px;
            margin: 0 auto 24px;
            background: white;
            border-radius: 16px;
            padding: 20px;
            border: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
        }
        
        .bsc-action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 28px;
        }
        
        .bsc-btn {
            padding: 14px 20px;
            border-radius: 12px;
            border: none;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.25s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .bsc-btn-primary {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
        }
        
        .bsc-btn-primary:hover {
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(245, 158, 11, 0.35);
        }
        
        .bsc-btn-secondary {
            background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
            color: #475569;
            border: 1px solid #cbd5e1;
        }
        
        .bsc-btn-secondary:hover {
            background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }
        
        .bsc-btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
        }
        
        .bsc-btn-success:hover {
            background: linear-gradient(135deg, #059669 0%, #047857 100%);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.35);
        }
        
        .bsc-btn-full {
            grid-column: 1 / -1;
        }
        
        .bsc-input {
            width: 100%;
            padding: 14px 18px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            font-size: 15px;
            margin-bottom: 20px;
            transition: all 0.25s;
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
            box-sizing: border-box;
            background: #f8fafc;
            color: #1e293b;
        }
        
        .bsc-input:focus {
            outline: none;
            border-color: #f59e0b;
            background: white;
            box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.1);
        }
        
        .bsc-loading {
            text-align: center;
            padding: 48px 24px;
        }
        
        .bsc-loading-spinner {
            width: 56px;
            height: 56px;
            border: 4px solid rgba(245, 158, 11, 0.1);
            border-top-color: #f59e0b;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .bsc-loading-text {
            font-size: 17px;
            color: #475569;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .bsc-success {
            text-align: center;
            padding: 48px 24px;
        }
        
        .bsc-success-icon {
            font-size: 64px;
            margin-bottom: 20px;
            animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        
        @keyframes scaleIn {
            from { transform: scale(0); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        
        .bsc-success-text {
            font-size: 22px;
            color: #10b981;
            font-weight: 700;
            margin-bottom: 12px;
        }
        
        .bsc-success-subtext {
            font-size: 16px;
            color: #64748b;
            margin-bottom: 24px;
            line-height: 1.6;
        }
        
        .bsc-tx-link {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 20px;
            color: #3b82f6;
            text-decoration: none;
            font-size: 15px;
            font-weight: 600;
            padding: 10px 20px;
            background: #eff6ff;
            border-radius: 10px;
            transition: all 0.2s;
        }
        
        .bsc-tx-link:hover {
            background: #dbeafe;
            color: #1d4ed8;
            transform: translateY(-1px);
        }
        
        .bsc-network-info {
            background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
            border: 2px solid #fde68a;
            border-radius: 12px;
            padding: 18px 20px;
            margin-bottom: 24px;
            font-size: 14px;
            color: #92400e;
        }
        
        .bsc-error {
            background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
            border: 2px solid #fecaca;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            color: #dc2626;
            font-size: 15px;
            text-align: center;
        }
        
        .bsc-wallet-options {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin: 20px 0;
        }
        
        .bsc-wallet-btn {
            padding: 12px;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            background: white;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
        }
        
        .bsc-wallet-btn:hover {
            border-color: #f59e0b;
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.08);
        }
        
        .bsc-wallet-btn.active {
            border-color: #f59e0b;
            background: #fffbeb;
        }
        
        .bsc-wallet-icon {
            font-size: 24px;
        }
        
        .bsc-wallet-name {
            font-size: 12px;
            font-weight: 600;
            color: #475569;
        }
        
        .bsc-alert {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10001;
            padding: 14px 28px;
            border-radius: 12px;
            font-size: 15px;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 300px;
            max-width: 500px;
            animation: slideDown 0.3s ease-out;
        }
        
        @keyframes slideDown {
            from { opacity: 0; transform: translate(-50%, -20px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        
        .bsc-alert-success { background: #10b981; color: white; }
        .bsc-alert-error { background: #ef4444; color: white; }
        .bsc-alert-warning { background: #f59e0b; color: white; }
        .bsc-alert-info { background: #3b82f6; color: white; }
        
        .bsc-step {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 16px;
            padding: 16px;
            background: #f8fafc;
            border-radius: 12px;
            border-left: 4px solid #f59e0b;
        }
        
        .bsc-step-number {
            background: #f59e0b;
            color: white;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 700;
            flex-shrink: 0;
        }
        
        .bsc-step-text {
            font-size: 14px;
            color: #475569;
            flex: 1;
            line-height: 1.5;
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert system - COMPLETE
function showAlert(message, type = 'info', duration = 3000) {
    const alert = document.createElement('div');
    alert.className = `bsc-alert bsc-alert-${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    alert.innerHTML = `
        <span>${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;
    
    document.body.appendChild(alert);
    
    if (duration > 0) {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transform = 'translate(-50%, -20px)';
            setTimeout(() => alert.remove(), 300);
        }, duration);
    }
    
    return alert;
}

// ✅ Create modal - COMPLETE
function createModal(content, onClose = null) {
    const overlay = document.createElement('div');
    overlay.className = 'bsc-modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'bsc-modal';
    modal.innerHTML = content;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Close on escape key
    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        }
    };
    document.addEventListener('keydown', handleEscape);
    
    // Close button
    const closeBtn = modal.querySelector('.bsc-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        });
    }
    
    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        }
    });
    
    return { overlay, modal };
}

// ✅ Generate QR code - UPDATED for qrcodejs/qrcode compatibility
function generateBSCQR(recipient, amount, element) {
    if (!element) return;

    element.innerHTML = '';

    try {
        const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
        const eip681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;

        // qrcode (npm/CDN) API
        if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
            const canvas = document.createElement('canvas');
            element.appendChild(canvas);

            window.QRCode.toCanvas(canvas, eip681URI, {
                width: 180,
                margin: 2,
                color: { dark: '#000000', light: '#FFFFFF' },
                errorCorrectionLevel: 'M'
            }, function(error) {
                if (error) {
                    console.warn('QR generation failed:', error);
                    generateImageQR(element, eip681URI);
                }
            });
        }
        // qrcodejs API
        else if (window.QRCode && typeof window.QRCode === 'function') {
            // Remove any existing QRCode instance
            element.innerHTML = '';
            new window.QRCode(element, {
                text: eip681URI,
                width: 180,
                height: 180,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
            });
        }
        // Fallback to Google Chart API
        else {
            generateImageQR(element, eip681URI);
        }
    } catch (error) {
        console.error('QR generation error:', error);
        element.innerHTML = '<div style="color: #ef4444; text-align: center;">QR Code Error</div>';
    }
}

function generateImageQR(element, data) {
    const encodedData = encodeURIComponent(data);
    const img = document.createElement('img');
    img.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodedData}&choe=UTF-8`;
    img.alt = 'BSC USDT Payment QR Code';
    img.style.width = '180px';
    img.style.height = '180px';
    element.appendChild(img);
}

// ✅ Copy BSC payment details - COMPLETE
async function copyBSCPaymentDetails(recipient, amount, eip681URI) {
    const textToCopy = `═══════════════════════════════════
   BSC USDT PAYMENT REQUEST
═══════════════════════════════════

💰 Amount: ${amount} USDT
🔗 Network: Binance Smart Chain (BSC)
📝 Token: USDT (BEP-20)
📬 Send To: ${recipient}

═══════════════════════════════════

📱 Scan QR Code or paste this URI in your wallet:
${eip681URI}

⚠️ IMPORTANT:
• Send ONLY on BSC network
• Verify the amount is ${amount} USDT

═══════════════════════════════════`;
    
    const success = await Utils.copyToClipboard(textToCopy);
    if (success) {
        showAlert('BSC USDT payment details copied!');
    } else {
        showAlert('Failed to copy. Please copy manually.');
    }
}

// ✅ Ensure BSC network - COMPLETE
async function ensureBSCNetwork(provider = window.ethereum) {
    if (!provider) {
        throw new Error('No wallet provider available');
    }
    
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        
        if (chainId !== '0x38') { // BSC mainnet chainId in hex
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x38',
                            chainName: 'Binance Smart Chain',
                            nativeCurrency: {
                                name: 'BNB',
                                symbol: 'BNB',
                                decimals: 18
                            },
                            rpcUrls: [CONFIG.BSC_RPC],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw switchError;
                }
            }
        }
        return true;
    } catch (error) {
        console.error('Network switch error:', error);
        throw new Error(`Failed to switch to BSC network: ${error.message}`);
    }
}

// ✅ Send USDT transaction - COMPLETE
async function sendUSDTTransaction(recipient, amount, fromAddress, provider = window.ethereum) {
    if (!provider) {
        throw new Error('No wallet provider available');
    }
    
    if (!window.ethers) {
        throw new Error('Ethers.js library not loaded');
    }
    
    try {
        const ethersProvider = new window.ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();
        
        // USDT Contract ABI
        const usdtAbi = [
            "function transfer(address to, uint256 amount) external returns (bool)",
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)"
        ];
        
        const usdtContract = new window.ethers.Contract(CONFIG.BSC_USDT_ADDRESS, usdtAbi, signer);
        const decimals = await usdtContract.decimals();
        const amountWei = window.ethers.utils.parseUnits(amount.toString(), decimals);
        
        // Check balance
        const balance = await usdtContract.balanceOf(fromAddress);
        if (balance.lt(amountWei)) {
            throw new Error(`Insufficient USDT balance. You have ${window.ethers.utils.formatUnits(balance, decimals)} USDT, need ${amount} USDT.`);
        }
        
        // Estimate gas
        const gasEstimate = await usdtContract.estimateGas.transfer(recipient, amountWei);
        const gasPrice = await ethersProvider.getGasPrice();
        
        // Send transaction
        const tx = await usdtContract.transfer(recipient, amountWei, {
            gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
            gasPrice: gasPrice
        });
        
        console.log('Transaction sent:', tx.hash);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        
        // Store in history
        STATE.transactionHistory.push({
            txHash: tx.hash,
            amount: amount,
            recipient: recipient,
            from: fromAddress,
            timestamp: Date.now(),
            status: receipt.status === 1 ? 'success' : 'failed',
            blockNumber: receipt.blockNumber
        });
        
        // Save to localStorage
        try {
            localStorage.setItem('bsc_payment_history', JSON.stringify(STATE.transactionHistory.slice(-50)));
        } catch (e) {
            console.warn('Failed to save transaction history:', e);
        }
        
        return {
            success: receipt.status === 1,
            txHash: tx.hash,
            explorerUrl: `${CONFIG.EXPLORER_URL}${tx.hash}`,
            receipt: receipt
        };
        
    } catch (error) {
        console.error('Transaction error:', error);
        
        if (error.code === 4001 || error.message.includes('user rejected')) {
            throw new Error('Transaction was rejected by user');
        }
        
        if (error.message.includes('insufficient funds')) {
            throw new Error('Insufficient USDT balance for this transaction');
        }
        
        throw new Error(`Transaction failed: ${error.message}`);
    }
}

// ✅ Get transaction history - COMPLETE
function getTransactionHistory(limit = 10) {
    return STATE.transactionHistory.slice(-limit).reverse();
}

// ✅ Clear transaction history - COMPLETE
function clearTransactionHistory() {
    STATE.transactionHistory = [];
    try {
        localStorage.removeItem('bsc_payment_history');
    } catch (e) {
        console.warn('Failed to clear transaction history:', e);
    }
    return true;
}

// ✅ Show payment modal - COMPLETE
async function showPaymentModal(amount, customRecipient = null, options = {}) {
    await loadDependencies();
    
    const exchangeRate = await Utils.getExchangeRate();
    const usdAmount = (amount * exchangeRate).toFixed(2);
    const recipient = customRecipient || CONFIG.RECIPIENT_ADDRESS;
    const paymentId = Utils.generateId();
    STATE.currentPaymentId = paymentId;
    
    return new Promise((resolve) => {
        const modalContent = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close">×</button>
                <h2 class="bsc-modal-title">Pay with USDT (BSC)</h2>
                <p class="bsc-modal-subtitle">Send ${amount} USDT on Binance Smart Chain</p>
            </div>
            
            <div class="bsc-modal-body">
                <div class="bsc-amount-card">
                    <div class="bsc-amount">${amount} USDT</div>
                    <div class="bsc-amount-usd">≈ ${Utils.formatCurrency(usdAmount)}</div>
                    <div class="bsc-amount-label">Amount to pay</div>
                </div>
                
                <div class="bsc-network-info">
                    <strong>⚠️ Important:</strong> Send only USDT on <strong>BSC (BEP-20)</strong> network
                </div>
                
                <div class="bsc-address-card">
                    <div style="font-size: 13px; color: #64748b; font-weight: 600; margin-bottom: 8px;">Recipient Address</div>
                    <div class="bsc-address">${recipient}</div>
                </div>
                
                <div class="bsc-qr-container" id="bscQRCode"></div>
                
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 14px; color: #64748b;">Scan QR with wallet app to send ${amount} USDT</div>
                </div>
                
                <div class="bsc-step">
                    <div class="bsc-step-number">1</div>
                    <div class="bsc-step-text">Scan QR code with your wallet app</div>
                </div>
                
                <div class="bsc-step">
                    <div class="bsc-step-number">2</div>
                    <div class="bsc-step-text">Verify amount is ${amount} USDT and recipient is correct</div>
                </div>
                
                <div class="bsc-step">
                    <div class="bsc-step-number">3</div>
                    <div class="bsc-step-text">Confirm the transaction in your wallet</div>
                </div>
                
                <div class="bsc-action-buttons">
                    <button id="copyAddressBtn" class="bsc-btn bsc-btn-secondary">
                        📋 Copy Address
                    </button>
                    <button id="copyPaymentDataBtn" class="bsc-btn bsc-btn-secondary">
                        🔗 Copy Payment Data
                    </button>
                </div>
                
                <button id="connectWalletBtn" class="bsc-btn bsc-btn-primary bsc-btn-full">
                    👛 Connect Wallet & Pay
                </button>
                
                <div style="margin: 28px 0; text-align: center; position: relative;">
                    <div style="height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent);"></div>
                    <div style="display: inline-block; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); padding: 0 16px; position: relative; top: -12px; color: #64748b; font-size: 13px; font-weight: 600;">
                        Already sent payment?
                    </div>
                </div>
                
                <input type="text" 
                       id="txHashInput" 
                       placeholder="Paste transaction hash (0x...)" 
                       class="bsc-input">
                
                <button id="confirmPaymentBtn" class="bsc-btn bsc-btn-success bsc-btn-full">
                    ✅ I've Already Paid
                </button>
                
                <div style="text-align: center; margin-top: 24px; font-size: 13px; color: #94a3b8;">
                    Payment ID: ${paymentId}
                </div>
            </div>
        `;
        
        const { overlay, modal } = createModal(modalContent, () => {
            resolve({ success: false, cancelled: true });
        });
        
        // Generate QR code
        setTimeout(() => {
            const qrContainer = modal.querySelector('#bscQRCode');
            if (qrContainer) {
                generateBSCQR(recipient, amount, qrContainer);
            }
        }, 100);
        
        // Copy address button
        modal.querySelector('#copyAddressBtn').addEventListener('click', async () => {
            const success = await Utils.copyToClipboard(recipient);
            if (success) {
                showAlert('Address copied to clipboard!', 'success');
            }
        });
        
        // Copy payment data button
        modal.querySelector('#copyPaymentDataBtn').addEventListener('click', async () => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            const eip681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            const success = await copyBSCPaymentDetails(recipient, amount, eip681URI);
            if (success) {
                showAlert('Payment details copied!', 'success');
            }
        });
        
        // Connect wallet button
        modal.querySelector('#connectWalletBtn').addEventListener('click', async () => {
            overlay.remove();
            
            try {
                // Check for wallet
                if (!window.ethereum) {
                    showAlert('Please install MetaMask or a Web3 wallet', 'error');
                    resolve({ success: false, error: 'No wallet found' });
                    return;
                }
                
                // Request account access
                const accounts = await window.ethereum.request({ 
                    method: 'eth_requestAccounts' 
                });
                
                if (!accounts || accounts.length === 0) {
                    throw new Error('No accounts found in wallet');
                }
                
                const fromAddress = accounts[0];
                STATE.userAddress = fromAddress;
                
                // Show confirmation modal
                const confirmed = await showRecipientConfirmation(recipient, amount, fromAddress);
                if (!confirmed) {
                    resolve({ success: false, cancelled: true });
                    return;
                }
                
                // Switch to BSC network
                await ensureBSCNetwork();
                
                // Send transaction
                const result = await sendUSDTTransaction(recipient, amount, fromAddress);
                
                if (result.success) {
                    // Show success modal
                    showSuccessModal(result.txHash, result.explorerUrl, amount);
                    
                    resolve({
                        success: true,
                        txHash: result.txHash,
                        explorerUrl: result.explorerUrl,
                        paymentId: paymentId,
                        amount: amount,
                        usdAmount: usdAmount
                    });
                } else {
                    throw new Error('Transaction failed');
                }
                
            } catch (error) {
                console.error('Payment error:', error);
                showAlert(`Payment failed: ${error.message}`, 'error');
                resolve({ 
                    success: false, 
                    error: error.message,
                    paymentId: paymentId 
                });
            }
        });
        
        // Manual confirmation button
        modal.querySelector('#confirmPaymentBtn').addEventListener('click', () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            overlay.remove();
            
            if (!txHash) {
                resolve({ 
                    success: false, 
                    manual: true, 
                    pendingConfirmation: true,
                    paymentId: paymentId
                });
                return;
            }
            
            if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                showAlert('Invalid transaction hash format', 'error');
                return;
            }
            
            resolve({ 
                success: true, 
                txHash: txHash, 
                explorerUrl: `${CONFIG.EXPLORER_URL}${txHash}`,
                method: 'manual',
                manual: true,
                paymentId: paymentId
            });
        });
    });
}

// ✅ Show recipient confirmation - COMPLETE
async function showRecipientConfirmation(recipient, amount, fromAddress) {
    return new Promise((resolve) => {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close">×</button>
                <h2 class="bsc-modal-title">Confirm USDT Payment</h2>
                <p class="bsc-modal-subtitle">Please verify USDT payment details</p>
            </div>
            <div class="bsc-modal-body">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">💰</div>
                    <div style="font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">
                        Send ${amount} USDT
                    </div>
                    <div style="font-size: 14px; color: #64748b; margin-bottom: 24px;">
                        From: ${Utils.truncateAddress(fromAddress)}
                    </div>
                </div>
                
                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 13px; color: #64748b; font-weight: 600; margin-bottom: 8px;">Recipient Address</div>
                    <div style="font-family: monospace; font-size: 14px; color: #1e293b; word-break: break-all; background: white; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        ${recipient}
                    </div>
                </div>
                
                <div style="background: #fef3c7; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 1px solid #fbbf24;">
                    <div style="font-size: 14px; color: #92400e; font-weight: 600; margin-bottom: 8px;">
                        ⚠️ Important Notice
                    </div>
                    <div style="font-size: 13px; color: #b45309; line-height: 1.5;">
                        You are sending <strong>${amount} USDT</strong> on <strong>BSC (BEP-20)</strong> network.
                        Make sure you have enough USDT balance and are connected to BSC network.
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <button id="confirmCancelBtn" class="bsc-btn bsc-btn-secondary">
                        Cancel
                    </button>
                    <button id="confirmProceedBtn" class="bsc-btn bsc-btn-primary">
                        Confirm & Send USDT
                    </button>
                </div>
            </div>
        `;
        
        const { overlay } = createModal(content);
        
        overlay.querySelector('#confirmCancelBtn').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        
        overlay.querySelector('#confirmProceedBtn').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
    });
}

// ✅ Show success modal - COMPLETE
function showSuccessModal(txHash, explorerUrl, amount) {
    const content = `
        <div class="bsc-modal-header">
            <button class="bsc-modal-close">×</button>
            <h2 class="bsc-modal-title">USDT Payment Successful! 🎉</h2>
            <p class="bsc-modal-subtitle">${amount} USDT sent successfully</p>
        </div>
        <div class="bsc-modal-body">
            <div class="bsc-success">
                <div class="bsc-success-icon">💰</div>
                <div class="bsc-success-text">USDT Payment Confirmed</div>
                <div class="bsc-success-subtext">
                    Your ${amount} USDT transaction has been processed on the BSC network.
                    <br>
                    Transaction ID: ${Utils.truncateAddress(txHash, 10, 8)}
                </div>
                <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="bsc-tx-link">
                    <span>🔍</span> View on BscScan
                </a>
            </div>
            <div style="text-align: center; margin-top: 24px;">
                <button id="successCopyBtn" class="bsc-btn bsc-btn-secondary" style="margin-right: 12px;">
                    📋 Copy TX Hash
                </button>
                <button id="successDoneBtn" class="bsc-btn bsc-btn-success">
                    Done
                </button>
            </div>
        </div>
    `;
    
    const { overlay } = createModal(content);
    
    overlay.querySelector('#successCopyBtn').addEventListener('click', async () => {
        const success = await Utils.copyToClipboard(txHash);
        if (success) {
            showAlert('Transaction hash copied!', 'success');
        }
    });
    
    overlay.querySelector('#successDoneBtn').addEventListener('click', () => {
        overlay.remove();
    });
}

// ✅ Main payment function - COMPLETE
async function initiateBSCPayment(amount, options = {}) {
    if (STATE.isProcessing) {
        showAlert('Another payment is currently processing. Please wait.', 'warning');
        return { success: false, error: 'Already processing' };
    }
    
    STATE.isProcessing = true;
    
    try {
        if (!amount || isNaN(amount) || amount <= 0) {
            throw new Error('Invalid payment amount');
        }
        
        const sanitizedAmount = Utils.sanitizeAmount(amount);
        amount = parseFloat(sanitizedAmount);
        
        if (amount <= 0) {
            throw new Error('Amount must be greater than zero');
        }
        
        if (options.recipient && !Utils.validateAddress(options.recipient)) {
            throw new Error('Invalid recipient address format');
        }
        
        STATE.lastPaymentAmount = amount;
        injectStyles();
        
        // Load transaction history
        try {
            const savedHistory = localStorage.getItem('bsc_payment_history');
            if (savedHistory) {
                STATE.transactionHistory = JSON.parse(savedHistory);
            }
        } catch (e) {
            console.warn('Failed to load transaction history:', e);
        }
        
        const result = await showPaymentModal(amount, options.recipient, options);
        
        if (result.success) {
            showAlert(`USDT payment successful! ${amount} USDT sent.`, 'success', 5000);
            
            if (typeof options.onSuccess === 'function') {
                setTimeout(() => options.onSuccess(result), 100);
            }
            
            // Dispatch event
            document.dispatchEvent(new CustomEvent('bscPaymentSuccess', {
                detail: { ...result, timestamp: Date.now() }
            }));
            
        } else if (result.cancelled) {
            showAlert('USDT payment cancelled', 'info', 3000);
        } else if (result.pendingConfirmation) {
            showAlert('Please confirm payment manually with transaction hash', 'warning', 5000);
        }
        
        return result;
        
    } catch (error) {
        console.error('Payment initiation error:', error);
        showAlert(`USDT payment failed: ${error.message}`, 'error', 5000);
        
        if (typeof options.onError === 'function') {
            setTimeout(() => options.onError(error), 100);
        }
        
        document.dispatchEvent(new CustomEvent('bscPaymentError', {
            detail: { error: error.message, amount: amount, timestamp: Date.now() }
        }));
        
        return { success: false, error: error.message };
    } finally {
        STATE.isProcessing = false;
    }
}

// ✅ Initialize - COMPLETE
function initialize() {
    injectStyles();
    
    window.BSCPayments = {
        // Core functions
        init: initiateBSCPayment,
        initiate: initiateBSCPayment,
        pay: initiateBSCPayment,
        
        // Configuration
        setRecipient: (address) => {
            if (!Utils.validateAddress(address)) {
                showAlert('Invalid BSC address format', 'error');
                return false;
            }
            CONFIG.RECIPIENT_ADDRESS = address;
            showAlert('Recipient address updated successfully', 'success');
            return true;
        },
        
        setConfig: (key, value) => {
            if (CONFIG.hasOwnProperty(key)) {
                CONFIG[key] = value;
                return true;
            }
            return false;
        },
        
        getConfig: () => ({ ...CONFIG }),
        
        // Utility functions
        showAlert: showAlert,
        copyText: Utils.copyToClipboard,
        truncateAddress: Utils.truncateAddress,
        validateAddress: Utils.validateAddress,
        
        // USDT Specific Functions
        generateUSDTQR: (recipient, amount, element) => {
            generateBSCQR(recipient || CONFIG.RECIPIENT_ADDRESS, amount, element);
        },
        
        generateUSDTTransaction: Utils.generateUSDTTransactionData,
        
        // Transaction management
        getHistory: getTransactionHistory,
        clearHistory: clearTransactionHistory,
        
        // Wallet utilities
        checkWallet: Utils.checkWalletInstalled,
        
        // State information
        isReady: true,
        version: '2.4.0',
        state: () => ({
            isProcessing: STATE.isProcessing,
            currentPaymentId: STATE.currentPaymentId,
            lastPaymentAmount: STATE.lastPaymentAmount,
            transactionCount: STATE.transactionHistory.length
        })
    };
    
    window.BSCPaymentsReady = true;
    window.initiateBSCPayment = initiateBSCPayment;
    
    console.log('🚀 BSC USDT Payment System v2.4 Ready');
    console.log('📋 Available methods:', Object.keys(window.BSCPayments).join(', '));
}

// ✅ Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    setTimeout(initialize, 100);
}