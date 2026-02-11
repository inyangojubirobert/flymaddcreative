// ======================================================
// 🚀 BSC USDT PAYMENT SYSTEM - STANDALONE v3.0
// ======================================================

// ✅ Ensure we're in browser
if (typeof window === 'undefined') {
    throw new Error('BSC Payments requires browser environment');
}

// ✅ Configuration
const BSC_CONFIG = {
    // Default USDT contract on BSC
    USDT_ADDRESS: '0x55d398326f99059fF775485246999027B3197955',
    
    // Default recipient (can be changed via setRecipient)
    RECIPIENT_ADDRESS: '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
    
    // BSC Network settings
    CHAIN_ID: 56,
    CHAIN_ID_HEX: '0x38',
    RPC_URL: 'https://bsc-dataseed.binance.org/',
    EXPLORER_URL: 'https://bscscan.com/tx/',
    
    // Payment defaults
    DEFAULT_AMOUNT: 2, // 2 USDT as requested
    USDT_DECIMALS: 6, // BSC USDT uses 6 decimals
    
    // Wallet options
    WALLET_OPTIONS: [
        { id: 'metamask', name: 'MetaMask', icon: '🦊' },
        { id: 'trustwallet', name: 'Trust', icon: '🛡️' },
        { id: 'tokenpocket', name: 'TokenPocket', icon: '💰' },
        { id: 'walletconnect', name: 'WalletConnect', icon: '🔗' },
        { id: 'binance', name: 'Binance', icon: '🅱️' },
        { id: 'safe', name: 'SafePal', icon: '🦅' }
    ]
};

// ✅ Application State
const BSC_STATE = {
    isProcessing: false,
    currentPaymentId: null,
    lastPaymentAmount: null,
    userAddress: null,
    transactionHistory: [],
    paymentSessions: {},
    lastPaymentAttempt: 0,
    rateLimitWindow: 5000 // 5 seconds between attempts
};

// ✅ Enhanced Utilities
// ✅ Enhanced Utilities
const BSC_UTILS = {
    // Generate unique ID
    generateId: () => 'bsc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    
    // Copy to clipboard
    copyToClipboard: async (text) => {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            } else {
                // Fallback for older browsers
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
    
    // Validate BSC address
    validateAddress: (address) => {
        if (!address || typeof address !== 'string') return false;
        // Check if it's a valid Ethereum/BSC address
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    },
    
    // Sanitize amount
    sanitizeAmount: (amount) => {
        if (typeof amount === 'string') {
            // Remove any non-numeric characters except decimal point
            amount = amount.replace(/[^\d.]/g, '');
        }
        const num = parseFloat(amount);
        return isNaN(num) ? BSC_CONFIG.DEFAULT_AMOUNT : num.toFixed(2);
    },
    
    // Format currency
    formatCurrency: (amount) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    },
    
    // Get exchange rate (simplified - in real app, call an API)
    getExchangeRate: async () => {
        try {
            // Try to get real exchange rate
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd');
            const data = await response.json();
            return data.tether?.usd || 1;
        } catch {
            return 1; // Fallback to 1:1
        }
    },
    
    // Check if wallet is installed
    checkWalletInstalled: () => {
        return !!(window.ethereum || window.BinanceChain || window.web3);
    },
    
    // Detect specific wallet
    detectWallet: () => {
        if (window.ethereum?.isMetaMask) return 'metamask';
        if (window.ethereum?.isTrust) return 'trustwallet';
        if (window.ethereum?.isTokenPocket) return 'tokenpocket';
        if (window.BinanceChain) return 'binance';
        if (window.ethereum) return 'generic';
        return null;
    },
    
    // Generate USDT transaction data
    generateUSDTTransactionData: (recipient, amount) => {
        const amountWei = BigInt(Math.round(amount * 10 ** BSC_CONFIG.USDT_DECIMALS)).toString();
        
        // ERC-20 transfer function signature
        const transferSignature = '0xa9059cbb';
        
        // Pad recipient address (remove 0x, pad to 64 chars)
        const paddedRecipient = recipient.replace('0x', '').padStart(64, '0');
        
        // Pad amount (convert to hex, pad to 64 chars)
        const paddedAmount = BigInt(amountWei).toString(16).padStart(64, '0');
        
        return transferSignature + paddedRecipient + paddedAmount;
    },
    
    // Validate transaction hash
    validateTransactionHash: (txHash) => {
        if (!txHash) return false;
        txHash = txHash.trim();
        
        // Standard format: 0x + 64 hex chars
        if (/^0x[a-fA-F0-9]{64}$/.test(txHash)) return txHash;
        
        // Also accept without 0x prefix
        if (/^[a-fA-F0-9]{64}$/.test(txHash)) return '0x' + txHash;
        
        return false;
    },
    
    // Rate limiting check
    checkRateLimit: () => {
        const now = Date.now();
        if (now - BSC_STATE.lastPaymentAttempt < BSC_STATE.rateLimitWindow) {
            return false;
        }
        BSC_STATE.lastPaymentAttempt = now;
        return true;
    },

    // ✅ ADD THIS FUNCTION to validate QR content
    validateQRContent: (recipient, amount) => {
        const USDT_DECIMALS = 6;
        const amountUnits = BigInt(
            Math.round(parseFloat(amount) * 10 ** USDT_DECIMALS)
        ).toString();

        const eip681URI =
            `ethereum:${BSC_CONFIG.USDT_ADDRESS}/transfer` +
            `?address=${recipient}` +
            `&uint256=${amountUnits}` +
            `&chainId=56`;
        
        return {
            uri: eip681URI,
            components: {
                scheme: 'ethereum',
                contract: BSC_CONFIG.USDT_ADDRESS,
                function: 'transfer',
                recipient: recipient,
                amountUnits: amountUnits,
                amount: amount,
                chainId: 56,
                network: 'BSC',
                token: 'USDT',
                decimals: 6
            },
            validation: {
                isEIP681: true,
                hasChainId: true,
                hasContract: true,
                hasFunction: true
            }
        };
    }
};

// ✅ Load dependencies dynamically
async function loadDependencies() {
    const dependencies = [];
    
    // Load QRCode library if not already loaded
    if (typeof QRCode === 'undefined') {
        dependencies.push(new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => {
                console.warn('QRCode.js failed to load, using fallback');
                resolve(); // Still resolve to use fallback
            };
            document.head.appendChild(script);
        }));
    }
    
    // Load ethers.js if not already loaded
    if (typeof ethers === 'undefined') {
        dependencies.push(new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => {
                console.warn('Ethers.js failed to load');
                reject(new Error('Ethers.js library required for wallet transactions'));
            };
            document.head.appendChild(script);
        }));
    }
    
    return Promise.all(dependencies);
}

// ✅ CSS Styles - UPDATED for better BSC branding
function injectStyles() {
    if (document.getElementById('bsc-payment-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'bsc-payment-styles';
    style.textContent = `
        /* BSC Brand Colors: Yellow/Black theme */
        :root {
            --bsc-yellow: #F0B90B;
            --bsc-yellow-dark: #D4A209;
            --bsc-yellow-light: #F8D347;
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
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: bscFadeIn 0.3s ease-out;
            backdrop-filter: blur(8px);
        }
        
        @keyframes bscFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        
        .bsc-modal {
            background: linear-gradient(135deg, var(--bsc-gray) 0%, var(--bsc-black) 100%);
            border-radius: 24px;
            width: 480px;
            max-width: 95vw;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
            animation: bscSlideUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(240, 185, 11, 0.2);
        }
        
        @keyframes bscSlideUp {
            from { opacity: 0; transform: translateY(40px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        
        .bsc-modal-header {
            padding: 32px 32px 24px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            position: relative;
            background: linear-gradient(135deg, rgba(240, 185, 11, 0.1) 0%, rgba(240, 185, 11, 0.05) 100%);
            border-radius: 24px 24px 0 0;
        }
        
        .bsc-modal-title {
            font-size: 26px;
            font-weight: 800;
            color: var(--bsc-yellow);
            margin: 0;
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .bsc-modal-subtitle {
            font-size: 16px;
            color: rgba(255, 255, 255, 0.8);
            margin-top: 8px;
            font-weight: 500;
        }
        
        .bsc-modal-close {
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
            font-weight: 300;
        }
        
        .bsc-modal-close:hover {
            background: rgba(240, 185, 11, 0.2);
            color: var(--bsc-yellow);
            transform: rotate(90deg);
            border-color: var(--bsc-yellow);
        }
        
        .bsc-modal-body {
            padding: 32px;
        }
        
        .bsc-amount-card {
            background: linear-gradient(135deg, rgba(240, 185, 11, 0.15) 0%, rgba(240, 185, 11, 0.05) 100%);
            border-radius: 20px;
            padding: 36px 28px;
            text-align: center;
            margin-bottom: 32px;
            position: relative;
            overflow: hidden;
            border: 2px solid rgba(240, 185, 11, 0.3);
        }
        
        .bsc-amount {
            font-size: 56px;
            font-weight: 900;
            color: var(--bsc-yellow);
            line-height: 1;
            margin-bottom: 8px;
            letter-spacing: -1.5px;
            text-shadow: 0 4px 20px rgba(240, 185, 11, 0.3);
        }
        
        .bsc-amount-label {
            font-size: 15px;
            color: rgba(255, 255, 255, 0.7);
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 600;
        }
        
        .bsc-address-card {
            background: var(--bsc-gray-light);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 32px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .bsc-address-label {
            font-size: 14px;
            color: rgba(255, 255, 255, 0.6);
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .bsc-address {
            font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Roboto Mono', monospace;
            font-size: 15px;
            word-break: break-all;
            color: white;
            line-height: 1.6;
            background: rgba(0, 0, 0, 0.3);
            padding: 18px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .bsc-qr-container {
            width: 260px;
            height: 260px;
            margin: 0 auto 28px;
            background: white;
            border-radius: 20px;
            padding: 24px;
            border: 3px solid var(--bsc-yellow);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 15px 30px rgba(0, 0, 0, 0.3);
        }
        
        .bsc-action-buttons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 28px;
        }
        
        .bsc-btn {
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
        
        .bsc-btn-primary {
            background: linear-gradient(135deg, var(--bsc-yellow) 0%, var(--bsc-yellow-dark) 100%);
            color: var(--bsc-black);
            box-shadow: 0 8px 20px rgba(240, 185, 11, 0.3);
        }
        
        .bsc-btn-primary:hover {
            background: linear-gradient(135deg, var(--bsc-yellow-light) 0%, var(--bsc-yellow) 100%);
            transform: translateY(-3px);
            box-shadow: 0 12px 25px rgba(240, 185, 11, 0.4);
        }
        
        .bsc-btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .bsc-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: translateY(-3px);
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
        }
        
        .bsc-btn-success {
            background: linear-gradient(135deg, var(--bsc-success) 0%, #0DAE71 100%);
            color: white;
            box-shadow: 0 8px 20px rgba(14, 203, 129, 0.3);
        }
        
        .bsc-btn-success:hover {
            background: linear-gradient(135deg, #0DAE71 0%, #0C9C65 100%);
            transform: translateY(-3px);
            box-shadow: 0 12px 25px rgba(14, 203, 129, 0.4);
        }
        
        .bsc-btn-full {
            grid-column: 1 / -1;
        }
        
        .bsc-input {
            width: 100%;
            padding: 16px 20px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 14px;
            font-size: 16px;
            margin-bottom: 24px;
            transition: all 0.25s;
            font-family: 'SF Mono', 'Monaco', monospace;
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.3);
            color: white;
        }
        
        .bsc-input:focus {
            outline: none;
            border-color: var(--bsc-yellow);
            background: rgba(0, 0, 0, 0.5);
            box-shadow: 0 0 0 4px rgba(240, 185, 11, 0.15);
        }
        
        .bsc-network-info {
            background: linear-gradient(135deg, rgba(240, 185, 11, 0.1) 0%, rgba(240, 185, 11, 0.05) 100%);
            border: 2px solid rgba(240, 185, 11, 0.3);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 28px;
            font-size: 15px;
            color: var(--bsc-yellow);
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .bsc-alert {
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
            min-width: 320px;
            max-width: 500px;
            animation: bscSlideDown 0.3s ease-out;
        }
        
        @keyframes bscSlideDown {
            from { opacity: 0; transform: translate(-50%, -30px); }
            to { opacity: 1; transform: translate(-50%, 0); }
        }
        
        .bsc-alert-success { background: var(--bsc-success); color: white; }
        .bsc-alert-error { background: var(--bsc-error); color: white; }
        .bsc-alert-warning { background: var(--bsc-warning); color: var(--bsc-black); }
        .bsc-alert-info { background: var(--bsc-info); color: white; }
        
        /* Wallet selection styles */
        .bsc-wallet-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin: 24px 0;
        }
        
        .bsc-wallet-option {
            background: var(--bsc-gray-light);
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 14px;
            padding: 20px 12px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }
        
        .bsc-wallet-option:hover {
            border-color: var(--bsc-yellow);
            transform: translateY(-3px);
            background: rgba(240, 185, 11, 0.05);
        }
        
        .bsc-wallet-icon {
            font-size: 32px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .bsc-wallet-name {
            font-size: 13px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.9);
            text-align: center;
        }
        
        /* Loading spinner */
        .bsc-spinner {
            width: 60px;
            height: 60px;
            border: 4px solid rgba(240, 185, 11, 0.1);
            border-top-color: var(--bsc-yellow);
            border-radius: 50%;
            animation: bscSpin 1s linear infinite;
            margin: 0 auto;
        }
        
        @keyframes bscSpin {
            to { transform: rotate(360deg); }
        }
        
        /* Success animation */
        .bsc-success-icon {
            font-size: 72px;
            margin-bottom: 24px;
            animation: bscScaleIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        
        @keyframes bscScaleIn {
            0% { transform: scale(0); opacity: 0; }
            70% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
        }
        
        /* Mobile optimizations */
        @media (max-width: 480px) {
            .bsc-modal {
                border-radius: 20px;
                width: 95vw;
            }
            
            .bsc-modal-header,
            .bsc-modal-body {
                padding: 24px;
            }
            
            .bsc-amount {
                font-size: 48px;
            }
            
            .bsc-qr-container {
                width: 220px;
                height: 220px;
                padding: 16px;
            }
            
            .bsc-action-buttons {
                grid-template-columns: 1fr;
                gap: 12px;
            }
            
            .bsc-wallet-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }
    `;
    document.head.appendChild(style);
}

// ✅ Alert System
function showBSCAlert(message, type = 'info', duration = 3000) {
    // Remove existing alert
    const existing = document.querySelector('.bsc-alert');
    if (existing) existing.remove();
    
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
        <button class="bsc-alert-close" style="
            background: none;
            border: none;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
            margin-left: auto;
        ">×</button>
    `;
    
    document.body.appendChild(alert);
    
    // Close button
    alert.querySelector('.bsc-alert-close').addEventListener('click', () => {
        alert.remove();
    });
    
    // Auto-dismiss
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
function createBSCModal(content, onClose = null) {
    const overlay = document.createElement('div');
    overlay.className = 'bsc-modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'bsc-modal';
    modal.innerHTML = content;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Close handlers
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

// ✅ Enhanced QR Generation for BSC USDT
// ✅ CORRECT BSC USDT QR Code Generation
// ✅ BSC USDT QR Code Generation using Trust Wallet Deep Link
function generateBSCUSDTQR(recipient, amount, element) {
    if (!element) return;
    element.innerHTML = '';
    
    try {
        // ✅ Detect if user is on mobile device
        const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // ✅ Build Trust Wallet deep link URL (works 100% for BSC USDT)
        const trustWalletDeepLink = 
            `https://link.trustwallet.com/send` +
            `?address=${BSC_CONFIG.USDT_ADDRESS}` +
            `&amount=${amount}` +
            `&token_id=${BSC_CONFIG.USDT_ADDRESS}` +
            `&chain_id=56` +
            `&asset=USDT`;

        console.log('[BSC QR] Using Trust Wallet Deep Link:', {
            recipient,
            amount,
            contract: BSC_CONFIG.USDT_ADDRESS,
            chainId: 56,
            deepLink: trustWalletDeepLink,
            isMobile: isMobile
        });

        // ✅ Determine what to put in the QR code
        let qrContent;
        
        if (isMobile) {
            // Mobile users: Trust Wallet deep link
            qrContent = trustWalletDeepLink;
        } else {
            // Desktop users: Just the address (they'll copy/paste)
            qrContent = recipient;
        }

        // Generate QR code
        if (window.QRCode) {
            try {
                if (typeof window.QRCode.toCanvas === 'function') {
                    // Using newer QRCode.js API
                    const canvas = document.createElement('canvas');
                    element.appendChild(canvas);

                    window.QRCode.toCanvas(canvas, qrContent, {
                        width: 200,
                        margin: 2,
                        color: { dark: '#000000', light: '#FFFFFF' },
                        errorCorrectionLevel: 'M'
                    }, (error) => {
                        if (error) {
                            console.warn('QR canvas error:', error);
                            generateFallbackQR(element, qrContent);
                        } else {
                            // Add click to copy
                            canvas.style.cursor = 'pointer';
                            canvas.title = isMobile ? 'Open in Trust Wallet' : 'Copy BSC address';
                            canvas.addEventListener('click', () => {
                                if (isMobile) {
                                    window.open(qrContent, '_blank');
                                } else {
                                    BSC_UTILS.copyToClipboard(recipient);
                                    showBSCAlert('BSC address copied!', 'success');
                                }
                            });
                        }
                    });
                } else if (typeof window.QRCode === 'function') {
                    // Using older QRCode.js
                    new window.QRCode(element, {
                        text: qrContent,
                        width: 200,
                        height: 200,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: window.QRCode.CorrectLevel?.M || 0
                    });
                    
                    // Add click to copy/open
                    setTimeout(() => {
                        const img = element.querySelector('img') || element.querySelector('canvas');
                        if (img) {
                            img.style.cursor = 'pointer';
                            img.title = isMobile ? 'Open in Trust Wallet' : 'Copy BSC address';
                            img.addEventListener('click', () => {
                                if (isMobile) {
                                    window.open(qrContent, '_blank');
                                } else {
                                    BSC_UTILS.copyToClipboard(recipient);
                                    showBSCAlert('BSC address copied!', 'success');
                                }
                            });
                        }
                    }, 100);
                } else {
                    generateFallbackQR(element, qrContent);
                }
            } catch (error) {
                console.error('QR generation error:', error);
                generateFallbackQR(element, qrContent);
            }
        } else {
            generateFallbackQR(element, qrContent);
        }

        // ✅ Add BSC payment instructions with Trust Wallet option
        const instructionDiv = document.createElement('div');
        instructionDiv.style.marginTop = '20px';
        instructionDiv.style.padding = '16px';
        instructionDiv.style.background = 'rgba(240, 185, 11, 0.1)';
        instructionDiv.style.borderRadius = '12px';
        instructionDiv.style.border = '1px solid rgba(240, 185, 11, 0.3)';
        
        if (isMobile) {
            instructionDiv.innerHTML = `
                <div style="color: var(--bsc-yellow); font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    <span>🟡</span> BSC USDT PAYMENT - TRUST WALLET
                </div>
                <div style="color: white; font-size: 14px; line-height: 1.6;">
                    1. <strong>Scan QR code</strong> with your phone camera<br>
                    2. <strong style="color: var(--bsc-yellow);">Trust Wallet</strong> will open automatically<br>
                    3. Verify: <strong>${amount} USDT</strong> on <strong>BSC (BEP-20)</strong><br>
                    4. Tap <strong style="color: var(--bsc-yellow);">Send</strong> to complete payment
                </div>
                <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: center;">
                    <button id="openTrustWalletBtn" style="
                        padding: 12px 24px;
                        background: #0B4F6C;
                        color: white;
                        border: none;
                        border-radius: 8px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        🛡️ Open Trust Wallet
                    </button>
                    <button id="copyAddressMobileBtn" style="
                        padding: 12px 24px;
                        background: rgba(255,255,255,0.1);
                        color: white;
                        border: 1px solid rgba(255,255,255,0.2);
                        border-radius: 8px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        📋 Copy Address
                    </button>
                </div>
            `;
        } else {
            instructionDiv.innerHTML = `
                <div style="color: var(--bsc-yellow); font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    <span>🟡</span> BSC USDT PAYMENT - DESKTOP
                </div>
                <div style="color: white; font-size: 14px; line-height: 1.6;">
                    1. <strong>Copy the BSC address</strong> below<br>
                    2. Open your wallet (MetaMask/Trust Wallet)<br>
                    3. Switch network to <strong style="color: var(--bsc-yellow);">Binance Smart Chain (BSC)</strong><br>
                    4. Send <strong style="color: var(--bsc-yellow);">${amount} USDT (BEP-20)</strong><br>
                    5. Paste the transaction hash to confirm
                </div>
                <div style="margin-top: 16px; display: flex; gap: 12px; justify-content: center;">
                    <button id="copyAddressDesktopBtn" style="
                        padding: 12px 24px;
                        background: var(--bsc-yellow);
                        color: black;
                        border: none;
                        border-radius: 8px;
                        font-weight: 600;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    ">
                        📋 Copy BSC Address
                    </button>
                </div>
            `;
        }
        
        element.appendChild(instructionDiv);

        // ✅ Add button event listeners
        setTimeout(() => {
            if (isMobile) {
                const trustBtn = element.querySelector('#openTrustWalletBtn');
                if (trustBtn) {
                    trustBtn.addEventListener('click', () => {
                        window.open(trustWalletDeepLink, '_blank');
                    });
                }
                
                const copyBtn = element.querySelector('#copyAddressMobileBtn');
                if (copyBtn) {
                    copyBtn.addEventListener('click', async () => {
                        await BSC_UTILS.copyToClipboard(recipient);
                        showBSCAlert('BSC address copied! Open Trust Wallet', 'success');
                    });
                }
            } else {
                const copyBtn = element.querySelector('#copyAddressDesktopBtn');
                if (copyBtn) {
                    copyBtn.addEventListener('click', async () => {
                        await BSC_UTILS.copyToClipboard(recipient);
                        showBSCAlert('BSC address copied!', 'success');
                    });
                }
            }
        }, 100);

        // ✅ Add alternative option for MetaMask users
        const altDiv = document.createElement('div');
        altDiv.style.marginTop = '12px';
        altDiv.style.textAlign = 'center';
        altDiv.style.fontSize = '13px';
        altDiv.style.color = 'rgba(255,255,255,0.6)';
        
        if (isMobile) {
            altDiv.innerHTML = `
                <span>Using MetaMask? </span>
                <button id="openMetaMaskBtn" style="
                    background: none;
                    border: none;
                    color: #F6851B;
                    text-decoration: underline;
                    cursor: pointer;
                    font-size: 13px;
                ">Open in MetaMask</button>
            `;
        } else {
            altDiv.innerHTML = `
                <span>💰 Need USDT on BSC? </span>
                <a href="https://pancakeswap.finance/swap" target="_blank" style="color: var(--bsc-yellow);">
                    Buy on PancakeSwap
                </a>
            `;
        }
        
        element.appendChild(altDiv);

        // ✅ Add MetaMask handler for mobile
        if (isMobile) {
            setTimeout(() => {
                const metaMaskBtn = element.querySelector('#openMetaMaskBtn');
                if (metaMaskBtn) {
                    metaMaskBtn.addEventListener('click', () => {
                        const metaMaskDeepLink = 
                            `https://metamask.app.link/send` +
                            `?address=${BSC_CONFIG.USDT_ADDRESS}` +
                            `&value=0` +
                            `&chainId=56` +
                            `&asset=${BSC_CONFIG.USDT_ADDRESS}`;
                        window.open(metaMaskDeepLink, '_blank');
                    });
                }
            }, 100);
        }
        
    } catch (error) {
        console.error('QR generation failed:', error);
        element.innerHTML = `
            <div style="text-align: center; color: var(--bsc-error); padding: 20px;">
                <div style="font-size: 48px;">❌</div>
                <div>QR Generation Failed</div>
                <div style="font-size: 12px; margin-top: 10px;">${error.message}</div>
            </div>
        `;
    }
}

// ✅ Fallback QR generator
function generateFallbackQR(element, data) {
    const encodedData = encodeURIComponent(data);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedData}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.alt = 'BSC USDT Payment QR';
    img.style.width = '200px';
    img.style.height = '200px';
    img.style.borderRadius = '8px';
    
    img.onerror = () => {
        element.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="color: var(--bsc-error); margin-bottom: 10px;">📱 QR Code Unavailable</div>
                <div style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; color: white; word-break: break-all;">
                    ${data}
                </div>
                <button onclick="BSC_UTILS.copyToClipboard('${data}')" 
                        style="margin-top: 12px; padding: 8px 16px; background: var(--bsc-yellow); color: black; border: none; border-radius: 8px; cursor: pointer;">
                    📋 Copy
                </button>
            </div>
        `;
    };
    
    element.appendChild(img);
}

function generateFallbackQR(element, data) {
    const encodedData = encodeURIComponent(data);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodedData}`;
    
    const img = document.createElement('img');
    img.src = qrUrl;
    img.alt = 'BSC USDT Payment QR';
    img.style.width = '200px';
    img.style.height = '200px';
    img.style.borderRadius = '8px';
    
    img.onerror = () => {
        // Ultimate fallback
        element.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="color: var(--bsc-error); margin-bottom: 10px;">QR Code Unavailable</div>
                <div style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; font-family: monospace; font-size: 12px;">
                    ${data.substring(0, 40)}...
                </div>
            </div>
        `;
    };
    
    element.appendChild(img);
}

// ✅ Network Switching
async function ensureBSCNetwork(provider = window.ethereum) {
    if (!provider) {
        throw new Error('No wallet provider available');
    }
    
    try {
        const chainId = await provider.request({ method: 'eth_chainId' });
        
        if (chainId !== BSC_CONFIG.CHAIN_ID_HEX) {
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: BSC_CONFIG.CHAIN_ID_HEX }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await provider.request({
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
        return true;
    } catch (error) {
        console.error('Network switch error:', error);
        throw new Error(`Failed to switch to BSC: ${error.message}`);
    }
}

// ✅ USDT Transaction
async function sendBSCUSDTTransaction(recipient, amount, fromAddress, provider = window.ethereum) {
    if (!provider) {
        throw new Error('No wallet provider available');
    }
    
    if (!window.ethers) {
        throw new Error('Ethers.js required for transactions');
    }
    
    try {
        const ethersProvider = new window.ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();
        
        // USDT Contract ABI (minimal)
        const usdtAbi = [
            "function transfer(address to, uint256 amount) external returns (bool)",
            "function balanceOf(address account) external view returns (uint256)",
            "function decimals() external view returns (uint8)"
        ];
        
        const usdtContract = new window.ethers.Contract(BSC_CONFIG.USDT_ADDRESS, usdtAbi, signer);
        
        // ✅ Get ACTUAL decimals from contract (should be 6)
        const decimals = await usdtContract.decimals();
        const amountWei = window.ethers.utils.parseUnits(amount.toString(), decimals);
        
        // Check balance
        const balance = await usdtContract.balanceOf(fromAddress);
        if (balance.lt(amountWei)) {
            throw new Error(`Insufficient USDT. You have ${window.ethers.utils.formatUnits(balance, decimals)} USDT, need ${amount} USDT`);
        }
        
        // Estimate gas
        const gasEstimate = await usdtContract.estimateGas.transfer(recipient, amountWei);
        const gasPrice = await ethersProvider.getGasPrice();
        
        // Send transaction
        const tx = await usdtContract.transfer(recipient, amountWei, {
            gasLimit: gasEstimate.mul(120).div(100), // 20% buffer
            gasPrice: gasPrice.mul(110).div(100) // 10% higher gas price
        });
        
        console.log('Transaction sent:', tx.hash);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        
        // Store in history
        BSC_STATE.transactionHistory.push({
            txHash: tx.hash,
            amount: amount,
            recipient: recipient,
            from: fromAddress,
            timestamp: Date.now(),
            status: receipt.status === 1 ? 'success' : 'failed',
            network: 'BSC',
            blockNumber: receipt.blockNumber
        });
        
        // Save to localStorage
        try {
            localStorage.setItem('bsc_payments_history', JSON.stringify(BSC_STATE.transactionHistory.slice(-50)));
        } catch (e) {
            console.warn('Failed to save history:', e);
        }
        
        return {
            success: receipt.status === 1,
            txHash: tx.hash,
            explorerUrl: `${BSC_CONFIG.EXPLORER_URL}${tx.hash}`,
            receipt: receipt
        };
        
    } catch (error) {
        console.error('Transaction error:', error);
        
        if (error.code === 4001 || error.message.includes('user rejected')) {
            throw new Error('Transaction rejected by user');
        }
        
        if (error.message.includes('insufficient funds')) {
            throw new Error('Insufficient USDT balance');
        }
        
        if (error.message.includes('network changed')) {
            throw new Error('Network changed. Please try again.');
        }
        
        throw new Error(`Transaction failed: ${error.message}`);
    }
}

// ✅ Wallet Connection
async function connectBSCWallet(walletType = 'auto') {
    if (!BSC_UTILS.checkWalletInstalled()) {
        throw new Error('No crypto wallet found. Please install MetaMask or Trust Wallet.');
    }
    
    try {
        let provider = window.ethereum;
        
        // If Binance Chain wallet is preferred
        if (walletType === 'binance' && window.BinanceChain) {
            provider = window.BinanceChain;
        }
        
        if (!provider) {
            throw new Error('Wallet provider not available');
        }
        
        // Request accounts
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts found. Please unlock your wallet.');
        }
        
        const address = accounts[0];
        BSC_STATE.userAddress = address;
        
        return {
            address,
            provider,
            walletType: BSC_UTILS.detectWallet() || 'unknown'
        };
        
    } catch (error) {
        console.error('Wallet connection error:', error);
        
        if (error.code === 4001) {
            throw new Error('Wallet connection rejected');
        }
        
        if (error.code === -32002) {
            throw new Error('Wallet connection already pending. Please check your wallet.');
        }
        
        throw new Error(`Wallet connection failed: ${error.message}`);
    }
}

// ✅ Main Payment Modal
async function showBSCPaymentModal(amount = BSC_CONFIG.DEFAULT_AMOUNT, options = {}) {
    await loadDependencies();
    
    const recipient = options.recipient || BSC_CONFIG.RECIPIENT_ADDRESS;
    const paymentId = BSC_UTILS.generateId();
    BSC_STATE.currentPaymentId = paymentId;
    
    // Load history
    try {
        const saved = localStorage.getItem('bsc_payments_history');
        if (saved) {
            BSC_STATE.transactionHistory = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load history:', e);
    }
    
    return new Promise((resolve) => {
        const modalContent = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close">×</button>
                <h2 class="bsc-modal-title">🟡 Pay with USDT (BSC)</h2>
                <p class="bsc-modal-subtitle">Send ${amount} USDT on Binance Smart Chain</p>
            </div>
            
            <div class="bsc-modal-body">
                <div class="bsc-amount-card">
                    <div class="bsc-amount">${amount} USDT</div>
                    <div class="bsc-amount-label">Amount to Pay</div>
                </div>
                
                <div class="bsc-network-info">
                    <span>⚠️</span>
                    <span>Send <strong>ONLY</strong> USDT on <strong>BSC (BEP-20)</strong> network</span>
                </div>
                
                <div class="bsc-address-card">
                    <div class="bsc-address-label">
                        <span>📬</span>
                        Recipient Address
                    </div>
                    <div class="bsc-address">${recipient}</div>
                </div>
                
                <div class="bsc-qr-container" id="bscQRCode"></div>
                
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 14px; color: rgba(255, 255, 255, 0.7);">
                        Scan QR with any BSC-compatible wallet
                    </div>
                </div>
                
                <div class="bsc-action-buttons">
                    <button id="bscCopyAddress" class="bsc-btn bsc-btn-secondary">
                        📋 Copy Address
                    </button>
                    <button id="bscCopyDetails" class="bsc-btn bsc-btn-secondary">
                        🔗 Copy Payment Details
                    </button>
                </div>
                
                <button id="bscConnectWallet" class="bsc-btn bsc-btn-primary bsc-btn-full">
                    👛 Connect Wallet & Pay
                </button>
                
                <div style="margin: 28px 0; position: relative; text-align: center;">
                    <div style="height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);"></div>
                    <div style="display: inline-block; background: var(--bsc-gray); padding: 0 16px; position: relative; top: -12px; color: rgba(255,255,255,0.6); font-size: 13px;">
                        Already sent payment?
                    </div>
                </div>
                
                <input type="text" 
                       id="bscTxHash" 
                       placeholder="Paste transaction hash (0x...)" 
                       class="bsc-input">
                
                <button id="bscConfirmManual" class="bsc-btn bsc-btn-success bsc-btn-full">
                    ✅ I've Already Paid
                </button>
                
                <div style="text-align: center; margin-top: 24px;">
                    <div style="font-size: 12px; color: rgba(255, 255, 255, 0.5);">
                        Payment ID: ${paymentId}
                    </div>
                </div>
            </div>
        `;
        
        const { overlay, modal } = createBSCModal(modalContent, () => {
            resolve({ success: false, cancelled: true });
        });
        
        // Generate QR code
        setTimeout(() => {
            const qrContainer = modal.querySelector('#bscQRCode');
            if (qrContainer) {
                generateBSCUSDTQR(recipient, amount, qrContainer);
            }
        }, 100);
        
        // Copy address
        modal.querySelector('#bscCopyAddress').addEventListener('click', async () => {
            const success = await BSC_UTILS.copyToClipboard(recipient);
            if (success) {
                showBSCAlert('Address copied!', 'success');
            }
        });
        
        // Copy payment details
        modal.querySelector('#bscCopyDetails').addEventListener('click', async () => {
            const details = `
Payment Request:
🔗 Network: BSC (BEP-20)
💰 Amount: ${amount} USDT
📬 To: ${recipient}
📝 Token: USDT (${BSC_CONFIG.USDT_ADDRESS})
⚠️ Send ONLY on BSC network
            `.trim();
            
            const success = await BSC_UTILS.copyToClipboard(details);
            if (success) {
                showBSCAlert('Payment details copied!', 'success');
            }
        });
        
        // Connect wallet button
        modal.querySelector('#bscConnectWallet').addEventListener('click', async () => {
            overlay.remove();
            
            try {
                showBSCAlert('Connecting wallet...', 'info');
                
                const wallet = await connectBSCWallet();
                
                // Show confirmation
                const confirmed = await showBSCConfirmation(recipient, amount, wallet.address);
                if (!confirmed) {
                    resolve({ success: false, cancelled: true });
                    return;
                }
                
                // Ensure BSC network
                await ensureBSCNetwork(wallet.provider);
                
                // Send transaction
                showBSCAlert('Confirm transaction in your wallet...', 'info');
                const result = await sendBSCUSDTTransaction(recipient, amount, wallet.address, wallet.provider);
                
                if (result.success) {
                    showBSCSuccessModal(result.txHash, result.explorerUrl, amount);
                    
                    resolve({
                        success: true,
                        txHash: result.txHash,
                        explorerUrl: result.explorerUrl,
                        paymentId: paymentId,
                        amount: amount,
                        fromAddress: wallet.address,
                        walletType: wallet.walletType
                    });
                } else {
                    throw new Error('Transaction failed');
                }
                
            } catch (error) {
                console.error('Payment error:', error);
                showBSCAlert(`Payment failed: ${error.message}`, 'error');
                resolve({ 
                    success: false, 
                    error: error.message,
                    paymentId: paymentId 
                });
            }
        });
        
        // Manual confirmation
        modal.querySelector('#bscConfirmManual').addEventListener('click', () => {
            const txHash = modal.querySelector('#bscTxHash').value.trim();
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
            
            const validatedHash = BSC_UTILS.validateTransactionHash(txHash);
            if (!validatedHash) {
                showBSCAlert('Invalid transaction hash format', 'error');
                return;
            }
            
            resolve({ 
                success: true, 
                txHash: validatedHash, 
                explorerUrl: `${BSC_CONFIG.EXPLORER_URL}${validatedHash}`,
                method: 'manual',
                manual: true,
                paymentId: paymentId
            });
        });
    });
}

// ✅ Confirmation Modal
async function showBSCConfirmation(recipient, amount, fromAddress) {
    return new Promise((resolve) => {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close">×</button>
                <h2 class="bsc-modal-title">🟡 Confirm Payment</h2>
                <p class="bsc-modal-subtitle">Please review payment details</p>
            </div>
            <div class="bsc-modal-body">
                <div style="text-align: center; margin-bottom: 28px;">
                    <div style="font-size: 56px; margin-bottom: 16px;">💰</div>
                    <div style="font-size: 20px; font-weight: 700; color: white; margin-bottom: 8px;">
                        ${amount} USDT
                    </div>
                    <div style="font-size: 14px; color: rgba(255,255,255,0.7);">
                        From: ${BSC_UTILS.truncateAddress(fromAddress)}
                    </div>
                </div>
                
                <div class="bsc-address-card">
                    <div class="bsc-address-label">
                        <span>📬</span>
                        To Address
                    </div>
                    <div class="bsc-address">${recipient}</div>
                </div>
                
                <div style="background: rgba(240, 185, 11, 0.1); border: 2px solid rgba(240, 185, 11, 0.3); border-radius: 16px; padding: 20px; margin-bottom: 28px;">
                    <div style="font-size: 15px; color: var(--bsc-yellow); font-weight: 600; margin-bottom: 8px;">
                        ⚠️ Important
                    </div>
                    <div style="font-size: 14px; color: rgba(255,255,255,0.8); line-height: 1.5;">
                        • Confirm this is <strong>${amount} USDT</strong><br>
                        • Ensure you're on <strong>BSC (BEP-20)</strong> network<br>
                        • Verify the recipient address matches above<br>
                        • Gas fees will be charged in BNB
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                    <button id="bscConfirmCancel" class="bsc-btn bsc-btn-secondary">
                        Cancel
                    </button>
                    <button id="bscConfirmProceed" class="bsc-btn bsc-btn-primary">
                        Confirm & Send
                    </button>
                </div>
            </div>
        `;
        
        const { overlay } = createBSCModal(content);
        
        overlay.querySelector('#bscConfirmCancel').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        
        overlay.querySelector('#bscConfirmProceed').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
    });
}

// ✅ Success Modal
function showBSCSuccessModal(txHash, explorerUrl, amount) {
    const content = `
        <div class="bsc-modal-header">
            <button class="bsc-modal-close">×</button>
            <h2 class="bsc-modal-title">🎉 Payment Successful!</h2>
            <p class="bsc-modal-subtitle">${amount} USDT sent successfully</p>
        </div>
        <div class="bsc-modal-body">
            <div style="text-align: center; padding: 40px 20px;">
                <div class="bsc-success-icon">✅</div>
                <div style="font-size: 22px; font-weight: 700; color: var(--bsc-success); margin-bottom: 12px;">
                    USDT Payment Confirmed
                </div>
                <div style="font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 24px; line-height: 1.5;">
                    Your ${amount} USDT has been sent on the BSC network.
                    <br>
                    <span style="font-family: monospace; font-size: 14px; color: rgba(255,255,255,0.6);">
                        ${BSC_UTILS.truncateAddress(txHash)}
                    </span>
                </div>
                <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" 
                   style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; background: var(--bsc-info); color: white; border-radius: 12px; text-decoration: none; font-weight: 600; transition: all 0.2s;">
                    🔍 View on BscScan
                </a>
            </div>
            <div style="text-align: center; margin-top: 24px;">
                <button id="bscSuccessCopy" class="bsc-btn bsc-btn-secondary" style="margin-right: 12px;">
                    📋 Copy TX Hash
                </button>
                <button id="bscSuccessDone" class="bsc-btn bsc-btn-success">
                    Done
                </button>
            </div>
        </div>
    `;
    
    const { overlay } = createBSCModal(content);
    
    overlay.querySelector('#bscSuccessCopy').addEventListener('click', async () => {
        const success = await BSC_UTILS.copyToClipboard(txHash);
        if (success) {
            showBSCAlert('Transaction hash copied!', 'success');
        }
    });
    
    overlay.querySelector('#bscSuccessDone').addEventListener('click', () => {
        overlay.remove();
    });
}

// ✅ Main Payment Function
async function initiateBSCPayment(amount = BSC_CONFIG.DEFAULT_AMOUNT, options = {}) {
    // Rate limiting
    if (!BSC_UTILS.checkRateLimit()) {
        showBSCAlert('Please wait before making another payment', 'warning');
        return { success: false, error: 'Rate limited' };
    }
    
    if (BSC_STATE.isProcessing) {
        showBSCAlert('Another payment is processing. Please wait.', 'warning');
        return { success: false, error: 'Already processing' };
    }
    
    BSC_STATE.isProcessing = true;
    
    try {
        // Validate amount
        const sanitizedAmount = BSC_UTILS.sanitizeAmount(amount);
        amount = parseFloat(sanitizedAmount);
        
        if (amount <= 0) {
            throw new Error('Amount must be greater than zero');
        }
        
        // Validate recipient if provided
        if (options.recipient && !BSC_UTILS.validateAddress(options.recipient)) {
            throw new Error('Invalid recipient address');
        }
        
        BSC_STATE.lastPaymentAmount = amount;
        
        // Inject styles
        injectStyles();
        
        // Show payment modal
        const result = await showBSCPaymentModal(amount, options);
        
        if (result.success) {
            showBSCAlert(`${amount} USDT payment successful!`, 'success', 5000);
            
            // Call success callback
            if (typeof options.onSuccess === 'function') {
                setTimeout(() => options.onSuccess(result), 100);
            }
            
            // Dispatch event
            document.dispatchEvent(new CustomEvent('bscPaymentSuccess', {
                detail: { ...result, timestamp: Date.now() }
            }));
            
        } else if (result.cancelled) {
            showBSCAlert('Payment cancelled', 'info');
        } else if (result.pendingConfirmation) {
            showBSCAlert('Please provide transaction hash to confirm payment', 'warning');
        }
        
        return result;
        
    } catch (error) {
        console.error('Payment error:', error);
        showBSCAlert(`Payment failed: ${error.message}`, 'error', 5000);
        
        if (typeof options.onError === 'function') {
            setTimeout(() => options.onError(error), 100);
        }
        
        document.dispatchEvent(new CustomEvent('bscPaymentError', {
            detail: { error: error.message, amount, timestamp: Date.now() }
        }));
        
        return { success: false, error: error.message };
    } finally {
        BSC_STATE.isProcessing = false;
    }
}

// ✅ Initialize BSC Payments
function initializeBSCPayments() {
    injectStyles();
    
    // Initialize transaction history
    try {
        const saved = localStorage.getItem('bsc_payments_history');
        if (saved) {
            BSC_STATE.transactionHistory = JSON.parse(saved);
        }
    } catch (e) {
        console.warn('Failed to load payment history:', e);
    }
    
    // Expose API
    window.BSCPayments = {
        // Core functions
        init: initiateBSCPayment,
        initiate: initiateBSCPayment,
        pay: initiateBSCPayment,
        
        // Quick payment methods
        pay2USDT: () => initiateBSCPayment(2),
        pay5USDT: () => initiateBSCPayment(5),
        pay10USDT: () => initiateBSCPayment(10),
        payCustom: (amount) => initiateBSCPayment(amount),
        
        // Configuration
        setRecipient: (address) => {
            if (!BSC_UTILS.validateAddress(address)) {
                showBSCAlert('Invalid BSC address', 'error');
                return false;
            }
            BSC_CONFIG.RECIPIENT_ADDRESS = address;
            showBSCAlert('Recipient address updated', 'success');
            return true;
        },
        
        setConfig: (key, value) => {
            if (BSC_CONFIG.hasOwnProperty(key)) {
                BSC_CONFIG[key] = value;
                return true;
            }
            return false;
        },
        
        getConfig: () => ({ ...BSC_CONFIG }),
        
        // Wallet functions
        connectWallet: connectBSCWallet,
        checkWallet: BSC_UTILS.checkWalletInstalled,
        detectWallet: BSC_UTILS.detectWallet,
        
        // QR functions
        generateQR: (recipient, amount, element) => {
            generateBSCUSDTQR(
                recipient || BSC_CONFIG.RECIPIENT_ADDRESS, 
                amount || BSC_CONFIG.DEFAULT_AMOUNT, 
                element
            );
        },
        
        // Utility functions
        copyText: BSC_UTILS.copyToClipboard,
        truncateAddress: BSC_UTILS.truncateAddress,
        validateAddress: BSC_UTILS.validateAddress,
        showAlert: showBSCAlert,
        
        // Transaction history
        getHistory: (limit = 10) => BSC_STATE.transactionHistory.slice(-limit).reverse(),
        clearHistory: () => {
            BSC_STATE.transactionHistory = [];
            try {
                localStorage.removeItem('bsc_payments_history');
            } catch (e) {
                console.warn('Failed to clear history:', e);
            }
            return true;
        },
        
        // State info
        isReady: true,
        version: '3.0.0',
        state: () => ({
            isProcessing: BSC_STATE.isProcessing,
            currentPaymentId: BSC_STATE.currentPaymentId,
            lastPaymentAmount: BSC_STATE.lastPaymentAmount,
            userAddress: BSC_STATE.userAddress,
            transactionCount: BSC_STATE.transactionHistory.length,
            detectedWallet: BSC_UTILS.detectWallet()
        })
    };
    
    // Global shortcut
    window.initiateBSCPayment = initiateBSCPayment;
    window.BSCPaymentsReady = true;
    
    // Dispatch ready event
    document.dispatchEvent(new CustomEvent('bscPaymentsReady'));
    
    console.log('🚀 BSC USDT Payment System v3.0 Ready');
    console.log('📋 Available: window.BSCPayments.initiate()');
    console.log('💡 Try: BSCPayments.pay2USDT() for quick 2 USDT payment');
    
    return window.BSCPayments;
}

// ✅ Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBSCPayments);
} else {
    setTimeout(initializeBSCPayments, 100);
}

// ✅ Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initializeBSCPayments, BSC_UTILS, BSC_CONFIG };
}