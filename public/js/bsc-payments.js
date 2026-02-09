// ======================================================
// 🚀 ENTERPRISE-GRADE BSC USDT PAYMENT SYSTEM
// Version 3.0 - Fixed BSC USDT QR Codes
// ======================================================

(function() {
    'use strict';
    
    // ✅ Configuration with enhanced validation
    const CONFIG = {
        BSC_USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        BSC_CHAIN_ID: 56,
        BSC_RPC: "https://bsc-dataseed.binance.org/",
        EXPLORER_URL: "https://bscscan.com/tx/",
        RECIPIENT_ADDRESS: "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d", // Replace with your address
        DECIMALS: 18,
        // Enhanced config
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        GAS_BUFFER: 20, // 20% buffer
        CONFIRMATION_TIMEOUT: 60000, // 60 seconds
        TEST_MODE: false,
        DEFAULT_CURRENCY: 'USD',
        // WalletConnect Project ID
        WALLETCONNECT_PROJECT_ID: "61d9b98f81731dffa9988c0422676fc5",
        WALLETCONNECT_METADATA: {
            name: "BSC USDT Payment System",
            description: "Enterprise BSC USDT Payment Solution",
            url: window.location.origin,
            icons: ["https://bscscan.com/favicon.ico"]
        }
    };

    // ✅ State management
    const STATE = {
        currentPaymentId: null,
        modalListeners: new Map(),
        transactionHistory: [],
        lastPaymentAmount: null,
        isProcessing: false,
        exchangeRates: {},
        walletConnect: null,
        walletConnectProvider: null
    };

    // ✅ Cache for performance
    const CACHE = {
        ethers: null,
        provider: null,
        contract: null,
        qrCode: null,
        exchangeRate: null,
        lastRateUpdate: 0,
        walletConnectQR: null
    };

    // ✅ Utility functions
    const Utils = {
        // Generate unique ID
        generateId: () => 'bsc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        
        // Format currency
        formatCurrency: (amount, currency = 'USD') => {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        },
        
        // Truncate address
        truncateAddress: (address, start = 6, end = 4) => {
            if (!address) return '';
            return `${address.substring(0, start)}...${address.substring(address.length - end)}`;
        },
        
        // Validate Ethereum address with checksum
        validateAddress: (address) => {
            if (!address || typeof address !== 'string') return false;
            if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return false;
            
            // Try checksum validation if ethers is available
            if (typeof ethers !== 'undefined') {
                try {
                    return ethers.utils.isAddress(address);
                } catch (e) {
                    return true; // Basic validation passed
                }
            }
            return true;
        },
        
        // Sanitize amount to prevent exponential notation attacks
        sanitizeAmount: (amount) => {
            if (typeof amount === 'number') {
                // Convert to string without scientific notation
                return amount.toLocaleString('fullwide', { useGrouping: false });
            }
            // Remove any non-numeric characters except decimal point
            return amount.toString().replace(/[^\d.]/g, '');
        },
        
        // Copy to clipboard with fallback
        copyToClipboard: async (text) => {
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                    return true;
                } else {
                    // Fallback for non-secure contexts
                    const textArea = document.createElement('textarea');
                    textArea.value = text;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    return successful;
                }
            } catch (err) {
                console.error('Copy failed:', err);
                return false;
            }
        },
        
        // Load WalletConnect library dynamically
        loadWalletConnect: () => {
            return new Promise((resolve, reject) => {
                if (typeof WalletConnect !== 'undefined') {
                    resolve(window.WalletConnect);
                    return;
                }
                
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@walletconnect/client@1.8.0/dist/umd/index.min.js';
                script.integrity = 'sha256-pd2aT7GQ3jFFwZq5kpO2QNl+mtQ6+EkVV3T0xwfyNvQ=';
                script.crossOrigin = 'anonymous';
                
                script.onload = () => {
                    console.log('✅ WalletConnect loaded');
                    resolve(window.WalletConnect);
                };
                
                script.onerror = () => {
                    reject(new Error('Failed to load WalletConnect library'));
                };
                
                document.head.appendChild(script);
            });
        },
        
        // Generate BSC-specific QR code data for USDT
        generateBSCUSDTQRData: (recipient, amount) => {
            // Calculate amount in wei (USDT has 18 decimals on BSC)
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            
            console.log('Generating BSC USDT QR Data:', {
                amount: amount,
                amountWei: amountWei,
                recipient: recipient,
                contract: CONFIG.BSC_USDT_ADDRESS,
                chainId: CONFIG.BSC_CHAIN_ID
            });
            
            // Method 1: ERC-681 format for BSC (Most compatible with wallets)
            // Format: ethereum:<TOKEN_CONTRACT>@<CHAIN_ID>/transfer?address=<RECIPIENT>&uint256=<AMOUNT>
            const erc681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            
            // Method 2: EIP-831 format
            const eip831URI = `ethereum:${recipient}@${CONFIG.BSC_CHAIN_ID}?value=${amountWei}&contract=${CONFIG.BSC_USDT_ADDRESS}`;
            
            // Method 3: Simple text for display
            const simpleText = `Send ${amount} USDT (BSC) to ${recipient}`;
            
            return {
                erc681: erc681URI,
                eip831: eip831URI,
                simple: simpleText,
                // Raw transaction data for advanced users
                rawTransaction: {
                    to: CONFIG.BSC_USDT_ADDRESS,
                    data: `0xa9059cbb${recipient.replace('0x', '').padStart(64, '0')}${BigInt(amountWei).toString(16).padStart(64, '0')}`,
                    value: '0',
                    chainId: CONFIG.BSC_CHAIN_ID
                }
            };
        },
        
        // Generate USDT transaction data for manual sending
        generateUSDTTransactionData: (recipient, amount) => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            
            // USDT transfer function selector: transfer(address,uint256)
            // Function signature: transfer(address,uint256)
            // Keccak256: transfer(address,uint256) = 0xa9059cbb
            
            // Encode the parameters
            const recipientPadded = recipient.toLowerCase().replace('0x', '').padStart(64, '0');
            const amountHex = BigInt(amountWei).toString(16).padStart(64, '0');
            
            // Construct the data
            const data = '0xa9059cbb' + recipientPadded + amountHex;
            
            return {
                to: CONFIG.BSC_USDT_ADDRESS,
                value: '0x0', // No BNB sent
                data: data,
                chainId: CONFIG.BSC_CHAIN_ID,
                gas: '0x186a0', // Default gas limit (100,000)
                gasPrice: '0x3b9aca00' // Default gas price (1 gwei)
            };
        }
    };

    // ✅ Load dependencies
    function loadDependencies() {
        return new Promise((resolve, reject) => {
            const dependencies = [];
            let loadedCount = 0;
            const totalDependencies = 2;

            // Check and load ethers.js
            if (typeof ethers === 'undefined') {
                dependencies.push({
                    name: 'ethers',
                    src: 'https://cdn.ethers.io/lib/ethers-5.7.umd.min.js',
                    integrity: 'sha256-4wOIQK5lBhxUMWqK8WwFz93qUcQlqBTnYhMlN5u9l0k=',
                    crossorigin: 'anonymous'
                });
            } else {
                loadedCount++;
                CACHE.ethers = ethers;
            }

            // Check and load QRCode.js
            if (typeof QRCode === 'undefined') {
                dependencies.push({
                    name: 'qrcode',
                    src: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
                    integrity: 'sha256-lMjpG2mYxHKgj9yZvjRPe6S/5qnrD9XZLMNuhPcUj8w=',
                    crossorigin: 'anonymous'
                });
            } else {
                loadedCount++;
            }

            // If all dependencies are already loaded
            if (loadedCount === totalDependencies) {
                resolve();
                return;
            }

            // Load remaining dependencies
            dependencies.forEach(dep => {
                const script = document.createElement('script');
                script.src = dep.src;
                script.crossOrigin = dep.crossorigin || 'anonymous';
                if (dep.integrity) {
                    script.integrity = dep.integrity;
                }
                
                script.onload = () => {
                    console.log(`✅ ${dep.name} loaded`);
                    if (dep.name === 'ethers') {
                        CACHE.ethers = window.ethers;
                    }
                    loadedCount++;
                    if (loadedCount === totalDependencies) {
                        resolve();
                    }
                };
                
                script.onerror = () => {
                    console.error(`Failed to load ${dep.name}`);
                    if (dep.name === 'qrcode') {
                        loadedCount++;
                        if (loadedCount === totalDependencies) {
                            resolve();
                        }
                    } else {
                        reject(new Error(`Failed to load ${dep.name}`));
                    }
                };
                
                document.head.appendChild(script);
            });
        });
    }

    // ✅ Inject CSS
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
                width: 480px;
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
            }
            
            .bsc-amount-usd {
                font-size: 18px;
                color: #cbd5e1;
                font-weight: 500;
                margin-bottom: 12px;
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
            }
            
            .bsc-address-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
            }
            
            .bsc-address-label {
                font-size: 13px;
                color: #64748b;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .bsc-address-badge {
                background: #f1f5f9;
                color: #475569;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
            }
            
            .bsc-address {
                font-family: monospace;
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
                border-radius: 12px;
                padding: 16px;
                border: 2px solid #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
            }
            
            .bsc-qr-canvas {
                cursor: pointer;
                border-radius: 8px;
                width: 100%;
                height: 100%;
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
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
            }
            
            .bsc-btn-primary {
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                color: white;
            }
            
            .bsc-btn-primary:hover {
                background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
                transform: translateY(-2px);
            }
            
            .bsc-btn-secondary {
                background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
                color: #475569;
                border: 1px solid #cbd5e1;
            }
            
            .bsc-btn-secondary:hover {
                background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
                transform: translateY(-2px);
            }
            
            .bsc-btn-success {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                color: white;
            }
            
            .bsc-btn-success:hover {
                background: linear-gradient(135deg, #059669 0%, #047857 100%);
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
                font-family: monospace;
                box-sizing: border-box;
                background: #f8fafc;
                color: #1e293b;
            }
            
            .bsc-input:focus {
                outline: none;
                border-color: #f59e0b;
                background: white;
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
            
            .bsc-success-text {
                font-size: 22px;
                color: #10b981;
                font-weight: 700;
                margin-bottom: 12px;
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
            
            .mt-4 { margin-top: 16px; }
            .mt-6 { margin-top: 24px; }
            .mb-4 { margin-bottom: 16px; }
            
            @media (max-width: 480px) {
                .bsc-modal {
                    width: 100%;
                    max-width: 100%;
                    max-height: 100%;
                    border-radius: 0;
                    margin: 0;
                }
                
                .bsc-action-buttons {
                    grid-template-columns: 1fr;
                }
                
                .bsc-wallet-options {
                    grid-template-columns: repeat(2, 1fr);
                }
                
                .bsc-amount {
                    font-size: 36px;
                }
                
                .bsc-qr-container {
                    width: 200px;
                    height: 200px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ✅ Alert system
    function showAlert(message, type = 'info', duration = 3000) {
        const alert = document.createElement('div');
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 12px;
            z-index: 10001;
            font-size: 15px;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 12px;
            animation: slideIn 0.3s ease-out;
            backdrop-filter: blur(10px);
        `;
        
        if (type === 'success') {
            alert.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            alert.style.color = 'white';
            alert.innerHTML = `✅ ${message}`;
        } else if (type === 'error') {
            alert.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
            alert.style.color = 'white';
            alert.innerHTML = `❌ ${message}`;
        } else if (type === 'warning') {
            alert.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            alert.style.color = 'white';
            alert.innerHTML = `⚠️ ${message}`;
        } else {
            alert.style.background = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
            alert.style.color = 'white';
            alert.innerHTML = `ℹ️ ${message}`;
        }
        
        document.body.appendChild(alert);
        
        if (duration > 0) {
            setTimeout(() => {
                alert.style.opacity = '0';
                alert.style.transform = 'translateX(20px)';
                setTimeout(() => alert.remove(), 300);
            }, duration);
        }
        
        return alert;
    }

    // ✅ Modal system
    function createModal(content, onClose = null) {
        const overlay = document.createElement('div');
        overlay.className = 'bsc-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'bsc-modal';
        modal.innerHTML = content;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Close on backdrop click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.remove();
                if (onClose) onClose();
            }
        });
        
        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                if (onClose) onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Remove event listener when modal is closed
        const removeModal = () => {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
            if (onClose) onClose();
        };
        
        // Find and attach close button handler
        setTimeout(() => {
            const closeBtn = modal.querySelector('.bsc-modal-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', removeModal);
            }
        }, 100);
        
        return { overlay, modal, remove: removeModal };
    }

    // ✅ Generate BSC USDT QR Code (FIXED VERSION)
    function generateBSCUSDTQR(recipient, amount, element) {
        console.log('Generating BSC USDT QR Code:', { recipient, amount });
        
        if (!element) {
            console.error('No element provided for QR code');
            return;
        }
        
        // Clear element
        element.innerHTML = '';
        
        // Generate QR data for BSC USDT
        const qrData = Utils.generateBSCUSDTQRData(recipient, amount);
        
        // Use ERC-681 format (most compatible)
        const qrContent = qrData.erc681;
        
        console.log('QR Content (ERC-681):', qrContent);
        
        // Create QR container
        const qrContainer = document.createElement('div');
        qrContainer.className = 'bsc-qr-container';
        
        // Try to generate QR code with QRCode library
        if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
            const canvas = document.createElement('canvas');
            canvas.className = 'bsc-qr-canvas';
            
            qrContainer.appendChild(canvas);
            
            QRCode.toCanvas(canvas, qrContent, {
                width: 180,
                margin: 1,
                color: { 
                    dark: '#000000',
                    light: '#FFFFFF'
                },
                errorCorrectionLevel: 'M'
            }, function(error) {
                if (error) {
                    console.warn('QRCode.js failed:', error);
                    // Fallback to image API
                    generateFallbackQR(qrContainer, qrContent, recipient, amount);
                } else {
                    console.log('QR code generated successfully');
                    addQRClickHandler(canvas, recipient, amount, qrContent);
                }
            });
        } else {
            // Use fallback image API
            generateFallbackQR(qrContainer, qrContent, recipient, amount);
        }
        
        element.appendChild(qrContainer);
        
        // Add instructions below QR
        const instructions = document.createElement('div');
        instructions.style.cssText = `
            text-align: center;
            font-size: 14px;
            color: #64748b;
            margin-top: 12px;
            line-height: 1.5;
        `;
        instructions.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                <span>📱</span>
                <span><strong>Scan to send ${amount} USDT</strong></span>
            </div>
            <div style="font-size: 12px; color: #94a3b8;">
                Works with MetaMask, Trust Wallet, etc.
            </div>
        `;
        element.appendChild(instructions);
    }

    function generateFallbackQR(container, qrContent, recipient, amount) {
        const encodedData = encodeURIComponent(qrContent);
        
        const img = document.createElement('img');
        img.className = 'bsc-qr-canvas';
        img.alt = `BSC USDT Payment: ${amount} USDT to ${Utils.truncateAddress(recipient)}`;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        
        // Use Google Charts API
        img.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodedData}&choe=UTF-8&chld=M`;
        
        img.onerror = function() {
            // Fallback to qrserver.com
            img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodedData}&format=png&ecc=M`;
        };
        
        container.appendChild(img);
        addQRClickHandler(img, recipient, amount, qrContent);
    }

    function addQRClickHandler(element, recipient, amount, qrContent) {
        element.style.cursor = 'pointer';
        element.title = 'Click to copy BSC USDT payment details';
        
        element.addEventListener('click', async () => {
            const textToCopy = `BSC USDT Payment Details:

Amount: ${amount} USDT
Network: Binance Smart Chain (BSC)
Chain ID: ${CONFIG.BSC_CHAIN_ID}
Token: USDT (BEP-20)
Contract: ${CONFIG.BSC_USDT_ADDRESS}
Recipient: ${recipient}

Payment URI: ${qrContent}

⚠️ IMPORTANT: Make sure you are on BSC network!`;
            
            const success = await Utils.copyToClipboard(textToCopy);
            if (success) {
                showAlert('BSC USDT payment details copied!', 'success');
            }
        });
    }

    // ✅ Network switching
    async function ensureBSCNetwork(provider) {
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
                    // If chain is not added, add it
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
            return provider;
        } catch (error) {
            console.error('Network switch error:', error);
            throw new Error('Failed to switch to BSC network. Please switch manually.');
        }
    }

    // ✅ Send USDT transaction
    async function sendUSDTTransaction(recipient, amount, fromAddress, provider) {
        if (!provider) {
            throw new Error('No wallet provider available');
        }
        
        if (!CACHE.ethers) {
            throw new Error('Ethers.js library not loaded');
        }
        
        try {
            let ethersProvider;
            
            if (provider.isWalletConnect) {
                ethersProvider = new CACHE.ethers.providers.Web3Provider(provider);
            } else {
                ethersProvider = provider instanceof CACHE.ethers.providers.Web3Provider 
                    ? provider 
                    : new CACHE.ethers.providers.Web3Provider(provider);
            }
            
            const signer = ethersProvider.getSigner();
            
            // USDT Contract ABI
            const usdtAbi = [
                "function transfer(address to, uint256 amount) external returns (bool)",
                "function balanceOf(address account) external view returns (uint256)",
                "function decimals() external view returns (uint8)"
            ];
            
            // Create contract instance
            const usdtContract = new CACHE.ethers.Contract(CONFIG.BSC_USDT_ADDRESS, usdtAbi, signer);
            
            // Convert amount to wei
            const amountWei = CACHE.ethers.utils.parseUnits(amount.toString(), CONFIG.DECIMALS);
            
            // Check balance
            const balance = await usdtContract.balanceOf(fromAddress);
            if (balance.lt(amountWei)) {
                throw new Error(`Insufficient USDT balance. You have ${CACHE.ethers.utils.formatUnits(balance, CONFIG.DECIMALS)} USDT, need ${amount} USDT.`);
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
                status: receipt.status === 1 ? 'success' : 'failed'
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

    // ✅ Get exchange rate
    async function getExchangeRate() {
        const now = Date.now();
        if (CACHE.exchangeRate && now - CACHE.lastRateUpdate < 5 * 60 * 1000) {
            return CACHE.exchangeRate;
        }
        
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=USDTUSDC');
            const data = await response.json();
            const rate = parseFloat(data.price);
            
            CACHE.exchangeRate = rate;
            CACHE.lastRateUpdate = now;
            
            return rate;
        } catch (error) {
            console.warn('Failed to fetch exchange rate, using fallback');
            return 1.0;
        }
    }

    // ✅ Show payment modal
    async function showPaymentModal(amount, customRecipient = null) {
        // Load dependencies first
        await loadDependencies();
        
        const recipient = customRecipient || CONFIG.RECIPIENT_ADDRESS;
        const paymentId = Utils.generateId();
        const exchangeRate = await getExchangeRate();
        const usdAmount = (amount * exchangeRate).toFixed(2);
        
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
                        <strong>⚠️ IMPORTANT:</strong> Send only on <strong>BSC (BEP-20)</strong> network<br>
                        <small>Chain ID: 56 | Token: USDT</small>
                    </div>
                    
                    <div id="bscQRCode">
                        <!-- QR code will be loaded here -->
                    </div>
                    
                    <div class="bsc-address-card">
                        <div class="bsc-address-header">
                            <div class="bsc-address-label">Recipient Address</div>
                            <div class="bsc-address-badge">BSC ONLY</div>
                        </div>
                        <div class="bsc-address">${recipient}</div>
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
                        <div class="bsc-step-text">Confirm transaction in your wallet</div>
                    </div>
                    
                    <div class="bsc-action-buttons">
                        <button id="copyAddressBtn" class="bsc-btn bsc-btn-secondary">
                            📋 Copy Address
                        </button>
                        <button id="copyQRDataBtn" class="bsc-btn bsc-btn-secondary">
                            🔗 Copy Payment Data
                        </button>
                    </div>
                    
                    <div class="bsc-wallet-options">
                        <button class="bsc-wallet-btn" data-wallet="metamask">
                            <span class="bsc-wallet-icon">🦊</span>
                            <span class="bsc-wallet-name">MetaMask</span>
                        </button>
                        <button class="bsc-wallet-btn" data-wallet="trust">
                            <span class="bsc-wallet-icon">🔒</span>
                            <span class="bsc-wallet-name">Trust Wallet</span>
                        </button>
                        <button class="bsc-wallet-btn" data-wallet="other">
                            <span class="bsc-wallet-icon">👛</span>
                            <span class="bsc-wallet-name">Other Wallet</span>
                        </button>
                    </div>
                    
                    <div style="margin: 24px 0; text-align: center; position: relative;">
                        <div style="height: 1px; background: #e2e8f0;"></div>
                        <div style="display: inline-block; background: white; padding: 0 16px; position: relative; top: -12px; color: #64748b; font-size: 13px;">
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
                    
                    <div style="text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;">
                        Payment ID: ${paymentId}
                    </div>
                </div>
            `;
            
            const { overlay, modal, remove } = createModal(modalContent, () => {
                resolve({ success: false, cancelled: true });
            });
            
            // Generate QR code
            setTimeout(() => {
                const qrContainer = modal.querySelector('#bscQRCode');
                if (qrContainer) {
                    generateBSCUSDTQR(recipient, amount, qrContainer);
                }
            }, 100);
            
            // Copy address button
            modal.querySelector('#copyAddressBtn').addEventListener('click', async () => {
                const success = await Utils.copyToClipboard(recipient);
                if (success) {
                    showAlert('Address copied to clipboard!', 'success');
                }
            });
            
            // Copy QR data button
            modal.querySelector('#copyQRDataBtn').addEventListener('click', async () => {
                const qrData = Utils.generateBSCUSDTQRData(recipient, amount);
                const success = await Utils.copyToClipboard(qrData.simple);
                if (success) {
                    showAlert('Payment details copied!', 'success');
                }
            });
            
            // Wallet selection
            modal.querySelectorAll('.bsc-wallet-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    modal.querySelectorAll('.bsc-wallet-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Show connect button for wallet integration
                    showConnectWalletButton(modal, btn.dataset.wallet, amount, recipient, paymentId, resolve);
                });
            });
            
            // Confirm payment button
            modal.querySelector('#confirmPaymentBtn').addEventListener('click', () => {
                const txHash = modal.querySelector('#txHashInput').value.trim();
                
                if (!txHash) {
                    showAlert('Please enter transaction hash', 'warning');
                    return;
                }
                
                if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                    showAlert('Invalid transaction hash format', 'error');
                    return;
                }
                
                remove();
                resolve({ 
                    success: true, 
                    txHash: txHash, 
                    explorerUrl: `${CONFIG.EXPLORER_URL}${txHash}`,
                    method: 'manual',
                    paymentId: paymentId
                });
            });
        });
    }

    function showConnectWalletButton(modal, walletType, amount, recipient, paymentId, resolve) {
        // Remove existing connect button
        const existingBtn = modal.querySelector('#connectWalletBtn');
        if (existingBtn) existingBtn.remove();
        
        const connectBtn = document.createElement('button');
        connectBtn.id = 'connectWalletBtn';
        connectBtn.className = 'bsc-btn bsc-btn-primary bsc-btn-full mt-4';
        connectBtn.innerHTML = `<span>👛</span> Connect ${walletType === 'metamask' ? 'MetaMask' : walletType === 'trust' ? 'Trust Wallet' : 'Wallet'} & Pay`;
        
        connectBtn.addEventListener('click', async () => {
            modal.parentElement.remove(); // Close modal
            
            try {
                // Show processing modal
                const processingModal = createProcessingModal();
                
                let provider;
                let fromAddress;
                
                if (walletType === 'metamask' || walletType === 'trust' || walletType === 'other') {
                    // Standard Web3 wallet
                    if (!window.ethereum) {
                        throw new Error('No Web3 wallet detected. Please install MetaMask or Trust Wallet.');
                    }
                    
                    const accounts = await window.ethereum.request({ 
                        method: 'eth_requestAccounts' 
                    });
                    
                    if (!accounts || accounts.length === 0) {
                        throw new Error('No accounts found in wallet.');
                    }
                    
                    fromAddress = accounts[0];
                    provider = window.ethereum;
                    
                } else {
                    throw new Error('Unsupported wallet type');
                }
                
                // Switch to BSC network
                updateProcessingStatus(processingModal.modal, 'Switching to BSC network...');
                await ensureBSCNetwork(provider);
                
                // Send transaction
                updateProcessingStatus(processingModal.modal, 'Confirm transaction in your wallet...');
                const result = await sendUSDTTransaction(recipient, amount, fromAddress, provider);
                
                if (result.success) {
                    // Show success
                    showSuccessModal(processingModal, result.txHash, result.explorerUrl, amount);
                    
                    resolve({
                        success: true,
                        txHash: result.txHash,
                        explorerUrl: result.explorerUrl,
                        method: walletType,
                        paymentId: paymentId,
                        amount: amount
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
        
        modal.querySelector('.bsc-action-buttons').parentNode.insertBefore(connectBtn, modal.querySelector('.bsc-action-buttons').nextSibling);
    }

    function createProcessingModal() {
        const content = `
            <div class="bsc-modal-header">
                <h2 class="bsc-modal-title">Processing USDT Payment</h2>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-loading">
                    <div class="bsc-loading-spinner"></div>
                    <div class="bsc-loading-text" id="processingStatus">Initializing payment...</div>
                </div>
            </div>
        `;
        
        return createModal(content);
    }

    function updateProcessingStatus(modal, text) {
        const statusElement = modal.querySelector('#processingStatus');
        if (statusElement) statusElement.textContent = text;
    }

    function showSuccessModal(processingModal, txHash, explorerUrl, amount) {
        processingModal.modal.innerHTML = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close">×</button>
                <h2 class="bsc-modal-title">Payment Successful! 🎉</h2>
                <p class="bsc-modal-subtitle">${amount} USDT sent successfully</p>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-success">
                    <div style="font-size: 48px; margin-bottom: 20px;">✅</div>
                    <div class="bsc-success-text">USDT Payment Confirmed</div>
                    <div style="font-size: 14px; color: #64748b; margin-bottom: 24px;">
                        Your transaction has been processed on BSC network.
                    </div>
                    <a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" class="bsc-tx-link">
                        <span>🔍</span> View on BscScan
                    </a>
                </div>
                <button id="successCloseBtn" class="bsc-btn bsc-btn-success bsc-btn-full mt-6">
                    Done
                </button>
            </div>
        `;
        
        processingModal.modal.querySelector('.bsc-modal-close').addEventListener('click', () => {
            processingModal.overlay.remove();
        });
        
        processingModal.modal.querySelector('#successCloseBtn').addEventListener('click', () => {
            processingModal.overlay.remove();
        });
    }

    // ✅ Main payment function
    async function initiateBSCPayment(amount, options = {}) {
        if (STATE.isProcessing) {
            showAlert('Another payment is currently processing', 'warning');
            return { success: false, error: 'Already processing' };
        }
        
        STATE.isProcessing = true;
        
        try {
            // Validate amount
            if (!amount || isNaN(amount) || amount <= 0) {
                throw new Error('Invalid payment amount');
            }
            
            const sanitizedAmount = Utils.sanitizeAmount(amount);
            amount = parseFloat(sanitizedAmount);
            
            // Validate recipient if provided
            if (options.recipient && !Utils.validateAddress(options.recipient)) {
                throw new Error('Invalid recipient address');
            }
            
            // Inject styles
            injectStyles();
            
            // Show payment modal
            const result = await showPaymentModal(amount, options.recipient);
            
            if (result.success) {
                showAlert(`Payment successful! ${amount} USDT sent.`, 'success');
                
                // Dispatch success event
                document.dispatchEvent(new CustomEvent('bscPaymentSuccess', {
                    detail: result
                }));
                
                // Call success callback
                if (typeof options.onSuccess === 'function') {
                    setTimeout(() => options.onSuccess(result), 100);
                }
                
            } else if (result.cancelled) {
                console.log('Payment cancelled by user');
            }
            
            return result;
            
        } catch (error) {
            console.error('Payment error:', error);
            showAlert(`Payment failed: ${error.message}`, 'error');
            
            return {
                success: false,
                error: error.message
            };
        } finally {
            STATE.isProcessing = false;
        }
    }

    // ✅ Initialize and expose to global scope
    function initialize() {
        injectStyles();
        
        window.BSCPayments = {
            // Core functions
            init: initiateBSCPayment,
            pay: initiateBSCPayment,
            
            // Configuration
            setRecipient: (address) => {
                if (!Utils.validateAddress(address)) {
                    console.error('Invalid BSC address');
                    return false;
                }
                CONFIG.RECIPIENT_ADDRESS = address;
                return true;
            },
            
            // QR code generation
            generateQR: (recipient, amount, element) => {
                generateBSCUSDTQR(recipient || CONFIG.RECIPIENT_ADDRESS, amount, element);
            },
            
            // Utilities
            copyText: Utils.copyToClipboard,
            truncateAddress: Utils.truncateAddress,
            
            // Information
            version: '3.0.0',
            isReady: true,
            config: CONFIG
        };
        
        // Also expose main function
        window.initiateBSCPayment = initiateBSCPayment;
        
        console.log('🚀 BSC USDT Payment System v3.0 Ready');
        
        // Check for default recipient warning
        if (CONFIG.RECIPIENT_ADDRESS === "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d") {
            console.warn('⚠️  USING DEFAULT RECIPIENT ADDRESS - UPDATE BEFORE PRODUCTION!');
        }
    }

    // ✅ Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        setTimeout(initialize, 100);
    }

})();