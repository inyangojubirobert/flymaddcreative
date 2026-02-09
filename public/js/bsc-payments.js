// ======================================================
// 🚀 ENTERPRISE-GRADE BSC USDT PAYMENT SYSTEM
// Version 2.2 - Enhanced QR Codes with USDT Support
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
        // WalletConnect Project ID (Get one from https://cloud.walletconnect.com/)
        WALLETCONNECT_PROJECT_ID: "YOUR_WALLETCONNECT_PROJECT_ID",
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

    // ✅ Enhanced error types for better handling
    const ERROR_TYPES = {
        NETWORK: 'NETWORK_ERROR',
        WALLET: 'WALLET_ERROR',
        TRANSACTION: 'TRANSACTION_ERROR',
        VALIDATION: 'VALIDATION_ERROR',
        API: 'API_ERROR',
        USER: 'USER_ERROR'
    };

    // ✅ Utility functions
    const Utils = {
        // Generate unique ID
        generateId: () => 'bsc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        
        // Debounce function
        debounce: (func, wait) => {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        
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
        
        // Retry with exponential backoff
        retryWithBackoff: async (fn, maxRetries = CONFIG.MAX_RETRIES, delay = CONFIG.RETRY_DELAY) => {
            let lastError;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    return await fn();
                } catch (error) {
                    lastError = error;
                    if (i < maxRetries - 1) {
                        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
                    }
                }
            }
            throw lastError;
        },
        
        // Check if error is retryable
        isRetryableError: (error) => {
            const retryableMessages = [
                'timeout',
                'network',
                'gas',
                'nonce',
                'replacement',
                'underpriced'
            ];
            const message = error.message.toLowerCase();
            return retryableMessages.some(term => message.includes(term));
        },
        
        // Monitor transaction with timeout
        monitorTransaction: async (txHash, timeout = CONFIG.CONFIRMATION_TIMEOUT) => {
            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                
                const checkInterval = setInterval(async () => {
                    try {
                        if (Date.now() - startTime > timeout) {
                            clearInterval(checkInterval);
                            reject(new Error('Transaction confirmation timeout'));
                            return;
                        }
                        
                        if (CACHE.provider) {
                            const receipt = await CACHE.provider.getTransactionReceipt(txHash);
                            if (receipt) {
                                clearInterval(checkInterval);
                                resolve(receipt);
                            }
                        }
                    } catch (error) {
                        clearInterval(checkInterval);
                        reject(error);
                    }
                }, 2000);
            });
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
        
        // Generate USDT-specific QR code data
        generateUSDTQRData: (recipient, amount) => {
            // Calculate amount in wei (USDT has 18 decimals)
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            
            // Method 1: ERC681 URI for USDT transfer (Most compatible)
            const erc681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            
            // Method 2: Enhanced format with metadata
            const enhancedData = JSON.stringify({
                type: 'USDT_PAYMENT',
                network: 'BSC',
                chainId: CONFIG.BSC_CHAIN_ID,
                token: 'USDT',
                tokenAddress: CONFIG.BSC_USDT_ADDRESS,
                recipient: recipient,
                amount: amount,
                amountWei: amountWei,
                decimals: CONFIG.DECIMALS,
                timestamp: Date.now(),
                version: '2.2'
            });
            
            // Method 3: Simple address for basic wallets
            const simpleAddress = recipient;
            
            // Return all formats for different wallet compatibility
            return {
                erc681: erc681URI,
                enhanced: enhancedData,
                simple: simpleAddress,
                raw: `USDT Payment: ${amount} USDT to ${recipient} on BSC Network`
            };
        },
        
        // Generate USDT transaction data for manual sending
        generateUSDTTransactionData: (recipient, amount) => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            
            // USDT transfer function selector: transfer(address,uint256)
            // Function signature: transfer(address,uint256)
            // Keccak256: transfer(address,uint256) = 0xa9059cbb
            
            // Encode the parameters
            // Remove '0x' from recipient and pad to 64 chars
            const recipientPadded = recipient.toLowerCase().replace('0x', '').padStart(64, '0');
            // Convert amountWei to hex and pad to 64 chars
            const amountHex = BigInt(amountWei).toString(16).padStart(64, '0');
            
            // Construct the data
            const data = '0xa9059cbb' + recipientPadded + amountHex;
            
            return {
                to: CONFIG.BSC_USDT_ADDRESS,
                value: '0x0', // No ETH sent
                data: data,
                chainId: CONFIG.BSC_CHAIN_ID,
                gas: '0x186a0', // Default gas limit
                gasPrice: '0x3b9aca00' // Default gas price (1 gwei)
            };
        }
    };

    // ✅ Load dependencies with enhanced error handling
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
                        // QRCode is optional, we have fallbacks
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

    // ✅ Inject CSS with enhanced styles
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
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                font-weight: 300;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            
            .bsc-modal-close:hover {
                background: white;
                color: #1e293b;
                transform: rotate(90deg);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            .bsc-modal-close:focus {
                outline: none;
                box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.3);
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
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
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
                transition: all 0.2s;
            }
            
            .bsc-address-card:hover {
                border-color: #f59e0b;
                box-shadow: 0 10px 15px -3px rgba(245, 158, 11, 0.1);
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
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .bsc-address-label::before {
                content: '📬';
                font-size: 14px;
            }
            
            .bsc-address-badge {
                background: #f1f5f9;
                color: #475569;
                padding: 4px 10px;
                border-radius: 20px;
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.5px;
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
                transition: all 0.2s;
            }
            
            .bsc-address:hover {
                background: #f1f5f9;
                border-color: #cbd5e1;
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
                position: relative;
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .bsc-qr-container:hover {
                transform: translateY(-4px);
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
                border-color: #f59e0b;
            }
            
            .bsc-qr-canvas {
                cursor: pointer;
                transition: transform 0.3s;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .bsc-qr-canvas:hover {
                transform: scale(1.05);
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
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                letter-spacing: 0.3px;
                position: relative;
                overflow: hidden;
            }
            
            .bsc-btn::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 0;
                height: 0;
                background: rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                transform: translate(-50%, -50%);
                transition: width 0.6s, height 0.6s;
            }
            
            .bsc-btn:hover::after {
                width: 300px;
                height: 300px;
            }
            
            .bsc-btn:active {
                transform: translateY(1px);
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
            
            .bsc-btn-danger {
                background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                color: white;
                box-shadow: 0 4px 14px rgba(239, 68, 68, 0.25);
            }
            
            .bsc-btn-danger:hover {
                background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
                transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(239, 68, 68, 0.35);
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
            
            .bsc-input::placeholder {
                color: #94a3b8;
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
                position: relative;
            }
            
            .bsc-loading-spinner::after {
                content: '';
                position: absolute;
                top: -4px;
                left: -4px;
                right: -4px;
                bottom: -4px;
                border: 4px solid transparent;
                border-top-color: #fbbf24;
                border-radius: 50%;
                animation: spin 1.5s linear infinite reverse;
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
            
            .bsc-loading-subtext {
                font-size: 14px;
                color: #64748b;
                max-width: 300px;
                margin: 0 auto;
                line-height: 1.5;
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
                box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
            }
            
            .bsc-network-info {
                background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
                border: 2px solid #fde68a;
                border-radius: 12px;
                padding: 18px 20px;
                margin-bottom: 24px;
                font-size: 14px;
                color: #92400e;
                display: flex;
                align-items: flex-start;
                gap: 12px;
            }
            
            .bsc-network-info::before {
                content: '⚠️';
                font-size: 18px;
                flex-shrink: 0;
            }
            
            .bsc-network-info strong {
                font-weight: 700;
                color: #b45309;
            }
            
            .bsc-footer {
                text-align: center;
                margin-top: 28px;
                padding-top: 24px;
                border-top: 1px solid #e2e8f0;
            }
            
            .bsc-footer-text {
                font-size: 13px;
                color: #64748b;
                line-height: 1.6;
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
                transition: all 0.2s;
            }
            
            .bsc-step:hover {
                background: #f1f5f9;
                transform: translateX(4px);
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
                box-shadow: 0 4px 8px rgba(245, 158, 11, 0.2);
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
                line-height: 1.6;
            }
            
            .bsc-error-title {
                font-weight: 700;
                margin-bottom: 8px;
                font-size: 16px;
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
            
            /* WalletConnect Modal Styles */
            .bsc-wc-modal {
                background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
                border-radius: 20px;
                width: 420px;
                max-width: 95vw;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                animation: slideUp 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            .bsc-wc-qr-container {
                width: 280px;
                height: 280px;
                margin: 0 auto 24px;
                background: white;
                border-radius: 16px;
                padding: 20px;
                border: 1px solid #e2e8f0;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
            }
            
            .bsc-wc-qr-canvas {
                width: 100%;
                height: 100%;
                object-fit: contain;
            }
            
            .bsc-wc-instructions {
                background: #f8fafc;
                border-radius: 12px;
                padding: 20px;
                margin: 20px 0;
                border-left: 4px solid #3b82f6;
            }
            
            .bsc-wc-instruction-step {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
                font-size: 14px;
                color: #475569;
            }
            
            .bsc-wc-instruction-step:last-child {
                margin-bottom: 0;
            }
            
            .bsc-wc-instruction-number {
                background: #3b82f6;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 700;
                flex-shrink: 0;
            }
            
            /* QR Code Overlay */
            .bsc-qr-overlay {
                position: absolute;
                bottom: 10px;
                left: 0;
                right: 0;
                text-align: center;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 8px;
                border-radius: 0 0 8px 8px;
                font-size: 12px;
                font-weight: 600;
            }
            
            .bsc-qr-label {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            
            .mt-2 { margin-top: 8px; }
            .mt-4 { margin-top: 16px; }
            .mt-6 { margin-top: 24px; }
            .mb-2 { margin-bottom: 8px; }
            .mb-4 { margin-bottom: 16px; }
            .mb-6 { margin-bottom: 24px; }
            
            /* Accessibility */
            .bsc-btn:focus,
            .bsc-input:focus,
            .bsc-modal-close:focus {
                outline: 2px solid #f59e0b;
                outline-offset: 2px;
            }
            
            /* Dark mode support */
            @media (prefers-color-scheme: dark) {
                .bsc-modal {
                    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                    border-color: #334155;
                }
                
                .bsc-address-card,
                .bsc-qr-container,
                .bsc-wc-qr-container {
                    background: #1e293b;
                    border-color: #334155;
                }
                
                .bsc-address {
                    background: #0f172a;
                    color: #cbd5e1;
                    border-color: #334155;
                }
                
                .bsc-step {
                    background: #1e293b;
                    color: #cbd5e1;
                }
                
                .bsc-input {
                    background: #0f172a;
                    border-color: #334155;
                    color: #cbd5e1;
                }
                
                .bsc-btn-secondary {
                    background: linear-gradient(135deg, #334155 0%, #1e293b 100%);
                    color: #cbd5e1;
                    border-color: #475569;
                }
                
                .bsc-wc-instructions {
                    background: #1e293b;
                    color: #cbd5e1;
                }
                
                .bsc-qr-overlay {
                    background: rgba(255, 255, 255, 0.1);
                    color: #cbd5e1;
                }
            }
            
            /* Mobile responsiveness */
            @media (max-width: 480px) {
                .bsc-modal {
                    width: 100%;
                    max-width: 100%;
                    max-height: 100%;
                    border-radius: 0;
                    margin: 0;
                }
                
                .bsc-modal-overlay {
                    padding: 0;
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
                
                .bsc-wc-qr-container {
                    width: 240px;
                    height: 240px;
                }
            }
            
            /* Animation for alerts */
            .bsc-alert-enter {
                animation: slideDown 0.3s ease-out;
            }
            
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translate(-50%, -20px);
                }
                to {
                    opacity: 1;
                    transform: translate(-50%, 0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ✅ Enhanced alert system with multiple positions and types
    function showAlert(message, type = 'info', duration = 5000, position = 'top') {
        // Remove existing alerts of same type/position
        const existingAlerts = document.querySelectorAll(`.bsc-alert[data-position="${position}"]`);
        existingAlerts.forEach(alert => {
            if (alert.parentNode) {
                alert.style.animation = 'slideDown 0.3s ease-out reverse';
                setTimeout(() => alert.remove(), 300);
            }
        });
        
        const alert = document.createElement('div');
        alert.className = `bsc-alert bsc-alert-${type}`;
        alert.dataset.position = position;
        
        // Define colors based on type
        const colors = {
            success: { bg: '#10b981', text: '#ffffff', icon: '✅' },
            error: { bg: '#ef4444', text: '#ffffff', icon: '❌' },
            warning: { bg: '#f59e0b', text: '#ffffff', icon: '⚠️' },
            info: { bg: '#3b82f6', text: '#ffffff', icon: 'ℹ️' }
        };
        
        const color = colors[type] || colors.info;
        
        // Calculate position
        let positionStyle;
        switch(position) {
            case 'top':
                positionStyle = 'top: 20px; left: 50%; transform: translateX(-50%);';
                break;
            case 'bottom':
                positionStyle = 'bottom: 20px; left: 50%; transform: translateX(-50%);';
                break;
            case 'top-left':
                positionStyle = 'top: 20px; left: 20px; transform: translateX(0);';
                break;
            case 'top-right':
                positionStyle = 'top: 20px; right: 20px; left: auto; transform: translateX(0);';
                break;
            default:
                positionStyle = 'top: 20px; left: 50%; transform: translateX(-50%);';
        }
        
        alert.innerHTML = `
            <div style="position: fixed; ${positionStyle}
                       background: ${color.bg};
                       color: ${color.text}; 
                       padding: 14px 28px;
                       border-radius: 12px;
                       z-index: 10001;
                       font-size: 15px;
                       font-weight: 600;
                       box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                       display: flex;
                       align-items: center;
                       gap: 12px;
                       min-width: 300px;
                       max-width: 500px;
                       animation: slideDown 0.3s ease-out;
                       backdrop-filter: blur(10px);
                       border: 1px solid rgba(255,255,255,0.1);">
                <span style="font-size: 18px;">${color.icon}</span>
                <span style="flex: 1;">${message}</span>
            </div>
        `;
        
        document.body.appendChild(alert);
        
        // Auto-dismiss
        if (duration > 0) {
            setTimeout(() => {
                if (alert.parentNode) {
                    alert.style.opacity = '0';
                    alert.style.transform = position.includes('top') 
                        ? 'translateX(-50%) translateY(-20px)' 
                        : 'translateX(-50%) translateY(20px)';
                    setTimeout(() => alert.remove(), 300);
                }
            }, duration);
        }
        
        return alert;
    }

    // ✅ Enhanced modal system with event listener cleanup
    function createModal(content, onClose = null) {
        const overlay = document.createElement('div');
        overlay.className = 'bsc-modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Payment Modal');
        
        const modal = document.createElement('div');
        modal.className = 'bsc-modal';
        modal.innerHTML = content;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Store modal ID for cleanup
        const modalId = Utils.generateId();
        overlay.dataset.modalId = modalId;
        
        // Function to cleanup event listeners
        const cleanup = () => {
            const listeners = STATE.modalListeners.get(modalId);
            if (listeners) {
                listeners.forEach(listener => {
                    if (listener.element && listener.handler) {
                        listener.element.removeEventListener(listener.event, listener.handler);
                    }
                });
                STATE.modalListeners.delete(modalId);
            }
        };
        
        // Helper to add tracked event listeners
        const addModalListener = (element, event, handler) => {
            if (!element || !handler) return;
            
            element.addEventListener(event, handler);
            
            if (!STATE.modalListeners.has(modalId)) {
                STATE.modalListeners.set(modalId, []);
            }
            STATE.modalListeners.get(modalId).push({ element, event, handler });
        };
        
        // Close on backdrop click
        addModalListener(overlay, 'click', function(e) {
            if (e.target === overlay) {
                cleanup();
                overlay.remove();
                if (onClose) onClose();
            }
        });
        
        // Close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                overlay.remove();
                if (onClose) onClose();
            }
        };
        addModalListener(document, 'keydown', handleEscape);
        
        // Focus trap for accessibility
        const focusableElements = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length > 0) {
            focusableElements[0].focus();
        }
        
        return { 
            overlay, 
            modal, 
            cleanup,
            addModalListener,
            focus: () => focusableElements[0]?.focus()
        };
    }

    // ✅ WalletConnect Implementation
    async function initializeWalletConnect() {
        try {
            await Utils.loadWalletConnect();
            
            if (!CONFIG.WALLETCONNECT_PROJECT_ID || CONFIG.WALLETCONNECT_PROJECT_ID === "YOUR_WALLETCONNECT_PROJECT_ID") {
                throw new Error('Please set your WalletConnect Project ID in CONFIG.WALLETCONNECT_PROJECT_ID');
            }
            
            // Initialize WalletConnect
            const connector = new WalletConnect.default({
                bridge: "https://bridge.walletconnect.org",
                qrcodeModal: {
                    open: (uri, cb) => {
                        // We'll handle QR display ourselves
                        STATE.walletConnectURI = uri;
                        if (typeof cb === 'function') cb();
                    },
                    close: () => {
                        // We'll handle closing ourselves
                    }
                },
                clientMeta: CONFIG.WALLETCONNECT_METADATA,
                chainId: CONFIG.BSC_CHAIN_ID
            });
            
            STATE.walletConnect = connector;
            
            // Check if connection is already established
            if (connector.connected) {
                STATE.walletConnectProvider = connector;
                console.log('WalletConnect already connected');
                return connector;
            }
            
            return connector;
        } catch (error) {
            console.error('WalletConnect initialization failed:', error);
            throw new Error(`WalletConnect initialization failed: ${error.message}`);
        }
    }

    // ✅ Generate QR code for WalletConnect
    function generateWalletConnectQR(uri, element) {
        if (!element) return;
        
        element.innerHTML = '';
        
        if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
            const canvas = document.createElement('canvas');
            canvas.className = 'bsc-wc-qr-canvas';
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            
            element.appendChild(canvas);
            
            QRCode.toCanvas(canvas, uri, {
                width: 240,
                margin: 2,
                color: { 
                    dark: '#000000', 
                    light: '#FFFFFF',
                    background: '#FFFFFF'
                },
                errorCorrectionLevel: 'H'
            }, function(error) {
                if (error) {
                    console.warn('WalletConnect QR generation failed:', error);
                    // Fallback to image
                    const img = document.createElement('img');
                    img.className = 'bsc-wc-qr-canvas';
                    img.src = `https://chart.googleapis.com/chart?chs=240x240&cht=qr&chl=${encodeURIComponent(uri)}&choe=UTF-8&chld=H`;
                    element.innerHTML = '';
                    element.appendChild(img);
                }
            });
        } else {
            // Fallback to image
            const img = document.createElement('img');
            img.className = 'bsc-wc-qr-canvas';
            img.src = `https://chart.googleapis.com/chart?chs=240x240&cht=qr&chl=${encodeURIComponent(uri)}&choe=UTF-8&chld=H`;
            element.appendChild(img);
        }
    }

    // ✅ Show WalletConnect modal
    async function showWalletConnectModal(amount, recipient, paymentId) {
        return new Promise((resolve, reject) => {
            try {
                const modalContent = `
                    <div class="bsc-modal-header">
                        <button class="bsc-modal-close" id="wcClose" aria-label="Close">×</button>
                        <h2 class="bsc-modal-title">Connect with WalletConnect</h2>
                        <p class="bsc-modal-subtitle">Scan QR code with your wallet app</p>
                    </div>
                    <div class="bsc-modal-body">
                        <div class="bsc-wc-qr-container" id="wcQrCode">
                            <!-- QR code will be loaded here -->
                        </div>
                        
                        <div class="bsc-wc-instructions">
                            <div class="bsc-wc-instruction-step">
                                <div class="bsc-wc-instruction-number">1</div>
                                <div>Open your wallet app (MetaMask, Trust Wallet, etc.)</div>
                            </div>
                            <div class="bsc-wc-instruction-step">
                                <div class="bsc-wc-instruction-number">2</div>
                                <div>Tap "Scan QR Code" or "Connect Wallet"</div>
                            </div>
                            <div class="bsc-wc-instruction-step">
                                <div class="bsc-wc-instruction-number">3</div>
                                <div>Scan the QR code above</div>
                            </div>
                            <div class="bsc-wc-instruction-step">
                                <div class="bsc-wc-instruction-number">4</div>
                                <div>Approve the connection request</div>
                            </div>
                        </div>
                        
                        <div style="text-align: center; margin: 24px 0;">
                            <button id="wcCopyUri" class="bsc-btn bsc-btn-secondary">
                                📋 Copy Connection URI
                            </button>
                        </div>
                        
                        <div style="font-size: 12px; color: #94a3b8; text-align: center; line-height: 1.5;">
                            Supported by 100+ wallets including MetaMask, Trust Wallet, Rainbow, Argent, and more
                        </div>
                        
                        <div id="wcError" style="display: none; margin-top: 20px;">
                            <div class="bsc-error">
                                <div class="bsc-error-title" id="wcErrorTitle">Connection Error</div>
                                <div id="wcErrorMessage">Unable to connect. Please try again.</div>
                            </div>
                        </div>
                    </div>
                `;
                
                const { overlay, modal, cleanup, addModalListener } = createModal(modalContent, () => {
                    cleanup();
                    reject(new Error('WalletConnect modal closed'));
                });
                
                // Close button
                const closeBtn = modal.querySelector('#wcClose');
                addModalListener(closeBtn, 'click', () => {
                    cleanup();
                    overlay.remove();
                    reject(new Error('WalletConnect cancelled'));
                });
                
                // Copy URI button
                const copyBtn = modal.querySelector('#wcCopyUri');
                addModalListener(copyBtn, 'click', async () => {
                    if (STATE.walletConnectURI) {
                        const success = await Utils.copyToClipboard(STATE.walletConnectURI);
                        if (success) {
                            showAlert('Connection URI copied to clipboard!', 'success', 2000);
                        }
                    }
                });
                
                // Initialize WalletConnect and generate QR
                setTimeout(async () => {
                    try {
                        const connector = await initializeWalletConnect();
                        
                        if (connector.connected) {
                            // Already connected
                            cleanup();
                            overlay.remove();
                            resolve(connector);
                            return;
                        }
                        
                        // Create new session
                        await connector.createSession();
                        
                        // Get URI and generate QR
                        const uri = connector.uri;
                        STATE.walletConnectURI = uri;
                        
                        const qrContainer = modal.querySelector('#wcQrCode');
                        if (qrContainer) {
                            generateWalletConnectQR(uri, qrContainer);
                        }
                        
                        // Listen for connection
                        connector.on("connect", (error, payload) => {
                            if (error) {
                                console.error('WalletConnect connection error:', error);
                                showErrorInModal(modal, 'Connection failed. Please try again.');
                                return;
                            }
                            
                            console.log('WalletConnect connected:', payload);
                            cleanup();
                            overlay.remove();
                            
                            // Store provider
                            STATE.walletConnectProvider = connector;
                            
                            resolve(connector);
                        });
                        
                        // Listen for disconnect
                        connector.on("disconnect", (error, payload) => {
                            if (error) {
                                console.error('WalletConnect disconnect error:', error);
                            }
                            console.log('WalletConnect disconnected');
                            STATE.walletConnectProvider = null;
                        });
                        
                        // Listen for session update
                        connector.on("session_update", (error, payload) => {
                            if (error) {
                                console.error('WalletConnect session update error:', error);
                            }
                            console.log('WalletConnect session updated:', payload);
                        });
                        
                        // Timeout after 5 minutes
                        setTimeout(() => {
                            if (connector && !connector.connected) {
                                cleanup();
                                overlay.remove();
                                reject(new Error('Connection timeout. Please try again.'));
                            }
                        }, 5 * 60 * 1000);
                        
                    } catch (error) {
                        console.error('WalletConnect error:', error);
                        showErrorInModal(modal, error.message);
                        setTimeout(() => {
                            cleanup();
                            overlay.remove();
                            reject(error);
                        }, 3000);
                    }
                }, 100);
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    function showErrorInModal(modal, message) {
        const errorDiv = modal.querySelector('#wcError');
        const errorTitle = modal.querySelector('#wcErrorTitle');
        const errorMessage = modal.querySelector('#wcErrorMessage');
        
        if (errorDiv && errorTitle && errorMessage) {
            errorDiv.style.display = 'block';
            errorMessage.textContent = message;
        }
    }

    // ✅ Enhanced QR code generation with USDT support
    function generateBSCQR(recipient, amount, element) {
        console.log('[BSC QR] Generating USDT QR code:', {
            recipient: recipient,
            amount: amount,
            network: 'BSC (BEP-20)',
            token: 'USDT',
            chainId: CONFIG.BSC_CHAIN_ID,
            contract: CONFIG.BSC_USDT_ADDRESS
        });
        
        if (!element) {
            console.error('[BSC QR] No element provided');
            return;
        }
        
        // Clear the element first
        element.innerHTML = '';
        
        // Generate USDT-specific QR data
        const qrData = Utils.generateUSDTQRData(recipient, amount);
        
        // Use ERC681 URI for best wallet compatibility
        const qrContent = qrData.erc681;
        
        // Create QR container
        const qrContainer = document.createElement('div');
        qrContainer.className = 'bsc-qr-container';
        
        // Create canvas for QR code
        const canvas = document.createElement('canvas');
        canvas.className = 'bsc-qr-canvas';
        canvas.setAttribute('role', 'button');
        canvas.setAttribute('tabindex', '0');
        canvas.setAttribute('aria-label', `Scan to send ${amount} USDT to ${Utils.truncateAddress(recipient)}`);
        canvas.title = `Click to copy payment details. Amount: ${amount} USDT`;
        
        qrContainer.appendChild(canvas);
        element.appendChild(qrContainer);
        
        // Try QRCode.js library first
        if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
            QRCode.toCanvas(canvas, qrContent, {
                width: 180,
                margin: 2,
                color: { 
                    dark: '#000000', 
                    light: '#FFFFFF',
                    background: '#FFFFFF'
                },
                errorCorrectionLevel: 'H'
            }, function(error) {
                if (error) {
                    console.warn('[BSC QR] QRCode.js failed:', error);
                    showImageBasedQR(element, qrContent, recipient, amount, qrContainer);
                } else {
                    console.log('[BSC QR] USDT QR code generated with QRCode.js');
                    
                    // Add USDT overlay
                    const overlay = document.createElement('div');
                    overlay.className = 'bsc-qr-overlay';
                    overlay.innerHTML = `
                        <div class="bsc-qr-label">
                            <span>💰</span>
                            <span>${amount} USDT</span>
                        </div>
                    `;
                    qrContainer.appendChild(overlay);
                    
                    // Add click handler
                    qrContainer.onclick = () => copyUSDTOaymentDetails(recipient, amount, qrData);
                    qrContainer.onkeydown = (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            copyUSDTOaymentDetails(recipient, amount, qrData);
                        }
                    };
                    
                    // Add context menu for saving
                    qrContainer.oncontextmenu = (e) => {
                        e.preventDefault();
                        const dataUrl = canvas.toDataURL('image/png');
                        const link = document.createElement('a');
                        link.download = `usdt-payment-${amount}-${Date.now()}.png`;
                        link.href = dataUrl;
                        link.click();
                        showAlert('USDT QR code image saved!', 'success', 2000);
                    };
                }
            });
        } else {
            console.log('[BSC QR] QRCode.js not available, using image API');
            showImageBasedQR(element, qrContent, recipient, amount, qrContainer);
        }
    }

    async function copyUSDTOaymentDetails(recipient, amount, qrData) {
        const txData = Utils.generateUSDTTransactionData(recipient, amount);
        
        const textToCopy = `USDT Payment Details:
        
Amount: ${amount} USDT (BEP-20)
Recipient: ${recipient}
Contract: ${CONFIG.BSC_USDT_ADDRESS}
Network: Binance Smart Chain (Chain ID: ${CONFIG.BSC_CHAIN_ID})

Manual Transaction Data:
To: ${txData.to}
Value: ${txData.value}
Data: ${txData.data}
Chain ID: ${txData.chainId}

Scan QR code or use ERC681 URI: ${qrData.erc681}`;
        
        const success = await Utils.copyToClipboard(textToCopy);
        if (success) {
            showAlert('USDT payment details copied to clipboard!', 'success', 2000);
        } else {
            showAlert('Failed to copy. Please copy manually.', 'error');
        }
    }

    function showImageBasedQR(element, qrContent, recipient, amount, qrContainer) {
        if (!element) return;
        
        const encodedData = encodeURIComponent(qrContent);
        
        const img = document.createElement('img');
        img.className = 'bsc-qr-canvas';
        img.alt = `USDT Payment QR: ${amount} USDT to ${Utils.truncateAddress(recipient)}`;
        img.setAttribute('role', 'button');
        img.setAttribute('tabindex', '0');
        img.setAttribute('aria-label', `Scan to send ${amount} USDT`);
        img.title = `Click to copy USDT payment details`;
        
        img.style.cssText = 'width: 180px; height: 180px; border-radius: 8px; cursor: pointer;';
        
        // Add USDT overlay
        const overlay = document.createElement('div');
        overlay.className = 'bsc-qr-overlay';
        overlay.innerHTML = `
            <div class="bsc-qr-label">
                <span>💰</span>
                <span>${amount} USDT</span>
            </div>
        `;
        
        img.onclick = () => {
            const qrData = Utils.generateUSDTQRData(recipient, amount);
            copyUSDTOaymentDetails(recipient, amount, qrData);
        };
        img.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const qrData = Utils.generateUSDTQRData(recipient, amount);
                copyUSDTOaymentDetails(recipient, amount, qrData);
            }
        };
        
        // Try Google Charts API first (most reliable)
        img.src = `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodedData}&choe=UTF-8&chld=H&chof=png`;
        
        img.onerror = function() {
            console.warn('[BSC QR] Google Charts failed, trying qrserver.com');
            img.onerror = function() {
                console.warn('[BSC QR] All QR APIs failed, showing text fallback');
                showTextFallback(element, recipient, amount);
            };
            img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodedData}&format=png&ecc=H&color=000&bgcolor=fff`;
        };
        
        if (qrContainer) {
            qrContainer.innerHTML = '';
            qrContainer.appendChild(img);
            qrContainer.appendChild(overlay);
        } else {
            element.innerHTML = '';
            element.appendChild(img);
        }
    }
    
    function showTextFallback(container, recipient, amount) {
        if (!container) return;
        
        const qrData = Utils.generateUSDTQRData(recipient, amount);
        const txData = Utils.generateUSDTTransactionData(recipient, amount);
        
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; width: 100%;">
                <div style="font-size: 14px; color: #64748b; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <span>📱</span>
                    <span>QR Code Unavailable</span>
                </div>
                
                <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 20px; border-radius: 12px; margin-bottom: 16px; border: 2px solid #fbbf24;">
                    <div style="font-size: 28px; font-weight: 800; color: #92400e;">
                        <span>💰</span> ${amount} USDT
                    </div>
                    <div style="font-size: 13px; color: #b45309; font-weight: 600; margin-top: 4px;">
                        BEP-20 (BSC NETWORK)
                    </div>
                </div>
                
                <div style="background: #f8fafc; border-radius: 10px; padding: 16px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 8px;">
                        Manual Transaction Data:
                    </div>
                    <div style="font-family: monospace; font-size: 11px; color: #475569; word-break: break-all; background: white; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
                        <div><strong>To:</strong> ${txData.to}</div>
                        <div><strong>Value:</strong> ${txData.value}</div>
                        <div><strong>Data:</strong> ${txData.data.substring(0, 40)}...</div>
                    </div>
                </div>
                
                <button onclick="window.BSCPayments.copyText('${recipient}')" 
                        style="padding: 12px 24px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; margin-bottom: 12px;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(245, 158, 11, 0.3)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
                    <span>📋</span> Copy Address
                </button>
                
                <button onclick="window.BSCPayments.copyText('${qrData.erc681}')" 
                        style="padding: 12px 24px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(59, 130, 246, 0.3)';"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
                    <span>🔗</span> Copy ERC681 URI
                </button>
            </div>
        `;
    }

    // ✅ Enhanced network switching with EIP-6963 support
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
            
            if (error.code === 4001) {
                throw new Error('Network switch was rejected. Please switch to BSC network manually.');
            }
            
            throw new Error(`Failed to switch to BSC network: ${error.message}`);
        }
    }

    // ✅ Enhanced USDT transaction with retry logic and better error handling
    async function sendUSDTTransaction(recipient, amount, fromAddress, provider) {
        if (!provider) {
            throw new Error('No wallet provider available');
        }
        
        if (!CACHE.ethers) {
            throw new Error('Ethers.js library not loaded');
        }
        
        const executeTransaction = async () => {
            try {
                let ethersProvider;
                
                // Handle different provider types
                if (provider.isWalletConnect) {
                    // WalletConnect provider
                    ethersProvider = new CACHE.ethers.providers.Web3Provider(provider);
                } else {
                    // Standard Web3 provider
                    ethersProvider = provider instanceof CACHE.ethers.providers.Web3Provider 
                        ? provider 
                        : new CACHE.ethers.providers.Web3Provider(provider);
                }
                
                const signer = ethersProvider.getSigner();
                
                // Cache provider for later use
                CACHE.provider = ethersProvider;
                
                // USDT Contract ABI (optimized)
                const usdtAbi = [
                    "function transfer(address to, uint256 amount) external returns (bool)",
                    "function balanceOf(address account) external view returns (uint256)",
                    "function decimals() external view returns (uint8)",
                    "function symbol() external view returns (string)"
                ];
                
                // Create contract instance
                const usdtContract = new CACHE.ethers.Contract(CONFIG.BSC_USDT_ADDRESS, usdtAbi, signer);
                
                // Cache contract for later use
                CACHE.contract = usdtContract;
                
                // Convert amount to wei
                const amountWei = CACHE.ethers.utils.parseUnits(amount.toString(), CONFIG.DECIMALS);
                
                // Validate recipient address
                if (!CACHE.ethers.utils.isAddress(recipient)) {
                    throw new Error('Invalid recipient address');
                }
                
                // Check balance first
                const balance = await usdtContract.balanceOf(fromAddress);
                if (balance.lt(amountWei)) {
                    throw new Error(`Insufficient USDT balance. You have ${CACHE.ethers.utils.formatUnits(balance, CONFIG.DECIMALS)} USDT, need ${amount} USDT.`);
                }
                
                console.log('Sending USDT transaction:', {
                    from: fromAddress,
                    to: recipient,
                    amount: amount,
                    amountWei: amountWei.toString(),
                    contract: CONFIG.BSC_USDT_ADDRESS,
                    balance: balance.toString()
                });
                
                // Estimate gas with retry
                const gasEstimate = await Utils.retryWithBackoff(
                    () => usdtContract.estimateGas.transfer(recipient, amountWei)
                );
                
                // Get gas price
                const feeData = await ethersProvider.getFeeData();
                const gasPrice = feeData.gasPrice || await ethersProvider.getGasPrice();
                
                console.log('Transaction details:', {
                    gasEstimate: gasEstimate.toString(),
                    gasPrice: gasPrice.toString(),
                    maxFeePerGas: feeData.maxFeePerGas?.toString(),
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
                });
                
                // Send transaction with optimized gas
                const tx = await usdtContract.transfer(recipient, amountWei, {
                    gasLimit: gasEstimate.mul(100 + CONFIG.GAS_BUFFER).div(100), // Add buffer
                    gasPrice: gasPrice,
                    nonce: await ethersProvider.getTransactionCount(fromAddress, 'pending')
                });
                
                console.log('Transaction sent:', tx.hash);
                
                // Wait for transaction confirmation with timeout
                const receipt = await Promise.race([
                    tx.wait(),
                    Utils.monitorTransaction(tx.hash)
                ]);
                
                // Store in transaction history
                STATE.transactionHistory.push({
                    txHash: tx.hash,
                    amount: amount,
                    recipient: recipient,
                    from: fromAddress,
                    timestamp: Date.now(),
                    status: receipt.status === 1 ? 'success' : 'failed',
                    blockNumber: receipt.blockNumber
                });
                
                // Save to localStorage for persistence
                try {
                    localStorage.setItem('bsc_payment_history', JSON.stringify(STATE.transactionHistory.slice(-50))); // Keep last 50
                } catch (e) {
                    console.warn('Failed to save transaction history:', e);
                }
                
                return {
                    success: receipt.status === 1,
                    txHash: tx.hash,
                    explorerUrl: `${CONFIG.EXPLORER_URL}${tx.hash}`,
                    receipt: receipt,
                    gasUsed: receipt.gasUsed.toString(),
                    effectiveGasPrice: receipt.effectiveGasPrice?.toString()
                };
                
            } catch (error) {
                console.error('Transaction error:', error);
                
                // Enhanced error messages
                if (error.code === 4001 || error.message.includes('user rejected')) {
                    throw new Error('Transaction was rejected by user');
                }
                
                if (error.message.includes('insufficient funds') || error.message.includes('balance')) {
                    throw new Error('Insufficient USDT balance for this transaction');
                }
                
                if (error.message.includes('gas')) {
                    throw new Error('Transaction failed due to gas estimation error. Please try again.');
                }
                
                if (error.message.includes('nonce')) {
                    throw new Error('Nonce error. Please try again in a moment.');
                }
                
                if (error.message.includes('replacement')) {
                    throw new Error('Transaction replacement detected. Please wait for previous transaction to complete.');
                }
                
                throw new Error(`Transaction failed: ${error.message}`);
            }
        };
        
        return Utils.retryWithBackoff(executeTransaction);
    }

    // ✅ Get exchange rate for USD display
    async function getExchangeRate() {
        // Check cache first
        const now = Date.now();
        if (CACHE.exchangeRate && now - CACHE.lastRateUpdate < 5 * 60 * 1000) { // 5 minutes cache
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
            console.warn('Failed to fetch exchange rate, using fallback:', error);
            // Fallback rate
            return 1.0;
        }
    }

    // ✅ Handle wallet connection based on selected type
    async function handleWalletConnection(selectedWallet, amount, recipient, paymentId) {
        let provider;
        let fromAddress;
        
        if (selectedWallet === 'walletconnect') {
            // WalletConnect flow
            try {
                // Show WalletConnect modal
                const connector = await showWalletConnectModal(amount, recipient, paymentId);
                
                // Get accounts
                const accounts = connector.accounts;
                if (!accounts || accounts.length === 0) {
                    throw new Error('No accounts found in wallet.');
                }
                
                fromAddress = accounts[0];
                provider = connector;
                
            } catch (error) {
                throw new Error(`WalletConnect failed: ${error.message}`);
            }
        } else {
            // Standard wallet flow (MetaMask, Trust Wallet, etc.)
            let ethereumProvider = window.ethereum;
            
            // Check for EIP-6963 multi-injector support
            if (window.ethereum?.providers) {
                const providers = window.ethereum.providers;
                if (selectedWallet === 'metamask') {
                    ethereumProvider = providers.find(p => p.isMetaMask) || providers[0];
                } else if (selectedWallet === 'trust') {
                    ethereumProvider = providers.find(p => p.isTrust) || providers[0];
                } else {
                    ethereumProvider = providers[0];
                }
            }
            
            if (!ethereumProvider) {
                throw new Error('No Web3 wallet detected. Please install a Web3 wallet.');
            }
            
            // Request account access
            let accounts;
            try {
                accounts = await ethereumProvider.request({ 
                    method: 'eth_requestAccounts' 
                });
            } catch (connectError) {
                if (connectError.code === 4001) {
                    throw new Error('Wallet connection rejected. Please connect to proceed.');
                }
                throw connectError;
            }
            
            if (!accounts || accounts.length === 0) {
                throw new Error('No accounts found in wallet.');
            }
            
            fromAddress = accounts[0];
            provider = ethereumProvider;
        }
        
        return { provider, fromAddress };
    }

    // ✅ Enhanced payment modal with wallet selection
    async function showPaymentModal(amount, customRecipient = null, options = {}) {
        await loadDependencies();
        
        // Get exchange rate for USD display
        const exchangeRate = await getExchangeRate();
        const usdAmount = (amount * exchangeRate).toFixed(2);
        
        return new Promise((resolve) => {
            const recipient = customRecipient || CONFIG.RECIPIENT_ADDRESS;
            const paymentId = Utils.generateId();
            STATE.currentPaymentId = paymentId;
            
            const modalContent = `
                <div class="bsc-modal-header">
                    <button class="bsc-modal-close" id="modalClose" aria-label="Close payment modal">×</button>
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
                        <div style="font-size: 13px; color: #92400e; margin-top: 8px; font-weight: normal;">
                            Contract: ${Utils.truncateAddress(CONFIG.BSC_USDT_ADDRESS)}
                        </div>
                    </div>
                    
                    <div class="bsc-address-card">
                        <div class="bsc-address-header">
                            <div class="bsc-address-label">Recipient Address</div>
                            <div class="bsc-address-badge">BSC NETWORK</div>
                        </div>
                        <div class="bsc-address" id="bscAddress" aria-label="Recipient address">${recipient}</div>
                    </div>
                    
                    <div class="bsc-qr-container" id="bscQRCode">
                        <!-- USDT QR code will be loaded here -->
                    </div>
                    
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 14px; color: #64748b; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <span>📱</span>
                            <span>Scan QR with wallet app to send ${amount} USDT</span>
                        </div>
                        <div style="font-size: 13px; color: #94a3b8; font-weight: 500;">QR contains USDT payment data</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">1</div>
                        <div class="bsc-step-text">Scan QR code with your wallet app to auto-fill USDT payment</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">2</div>
                        <div class="bsc-step-text">Verify the amount is ${amount} USDT and recipient is correct</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">3</div>
                        <div class="bsc-step-text">Confirm the transaction in your wallet</div>
                    </div>
                    
                    <div class="bsc-action-buttons">
                        <button id="copyAddressBtn" class="bsc-btn bsc-btn-secondary" aria-label="Copy recipient address">
                            <span>📋</span> Copy Address
                        </button>
                        <button id="copyPaymentDataBtn" class="bsc-btn bsc-btn-secondary" aria-label="Copy payment data">
                            <span>🔗</span> Copy Payment Data
                        </button>
                    </div>
                    
                    <div class="bsc-wallet-options" id="walletOptions">
                        <button class="bsc-wallet-btn" data-wallet="metamask" id="metamaskBtn">
                            <span class="bsc-wallet-icon">🦊</span>
                            <span class="bsc-wallet-name">MetaMask</span>
                        </button>
                        <button class="bsc-wallet-btn" data-wallet="trust" id="trustBtn">
                            <span class="bsc-wallet-icon">🔒</span>
                            <span class="bsc-wallet-name">Trust</span>
                        </button>
                        <button class="bsc-wallet-btn" data-wallet="walletconnect" id="walletConnectBtn">
                            <span class="bsc-wallet-icon">⚡</span>
                            <span class="bsc-wallet-name">WalletConnect</span>
                        </button>
                    </div>
                    
                    <button id="connectWalletBtn" class="bsc-btn bsc-btn-primary bsc-btn-full">
                        <span>👛</span> Connect Wallet & Pay
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
                           class="bsc-input"
                           aria-label="Transaction hash input">
                    
                    <button id="confirmPaymentBtn" class="bsc-btn bsc-btn-success bsc-btn-full">
                        ✅ I've Already Paid
                    </button>
                    
                    <div class="bsc-footer">
                        <p class="bsc-footer-text">
                            Transaction will be confirmed on BSC network within 15-60 seconds.
                            <br>
                            <span style="font-size: 11px; color: #94a3b8; margin-top: 4px; display: block;">
                                Payment ID: ${paymentId}
                            </span>
                        </p>
                    </div>
                </div>
            `;
            
            const { overlay, modal, cleanup, addModalListener } = createModal(modalContent, () => {
                cleanup();
                resolve({ success: false, cancelled: true });
            });
            
            // Close button
            const closeBtn = modal.querySelector('#modalClose');
            addModalListener(closeBtn, 'click', () => {
                cleanup();
                overlay.remove();
                resolve({ success: false, cancelled: true });
            });
            
            // Generate USDT QR code immediately
            setTimeout(() => {
                const qrContainer = modal.querySelector('#bscQRCode');
                if (qrContainer) {
                    generateBSCQR(recipient, amount, qrContainer);
                }
            }, 100);
            
            // Copy address button
            const copyBtn = modal.querySelector('#copyAddressBtn');
            addModalListener(copyBtn, 'click', async () => {
                const success = await Utils.copyToClipboard(recipient);
                if (success) {
                    showAlert('Address copied to clipboard!', 'success', 2000);
                } else {
                    showAlert('Failed to copy address', 'error');
                }
            });
            
            // Copy payment data button
            const copyDataBtn = modal.querySelector('#copyPaymentDataBtn');
            addModalListener(copyDataBtn, 'click', async () => {
                const qrData = Utils.generateUSDTQRData(recipient, amount);
                const success = await Utils.copyToClipboard(qrData.raw);
                if (success) {
                    showAlert('USDT payment details copied!', 'success', 2000);
                }
            });
            
            // Wallet selection
            const walletButtons = modal.querySelectorAll('.bsc-wallet-btn');
            let selectedWallet = 'metamask';
            
            // Set default active
            walletButtons[0]?.classList.add('active');
            
            walletButtons.forEach(btn => {
                addModalListener(btn, 'click', () => {
                    walletButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    selectedWallet = btn.dataset.wallet;
                });
            });
            
            // Connect wallet and pay button
            const connectBtn = modal.querySelector('#connectWalletBtn');
            addModalListener(connectBtn, 'click', async () => {
                // Close current modal
                cleanup();
                overlay.remove();
                
                // Show processing modal
                const processingModal = createProcessingModal(paymentId);
                
                try {
                    updateProcessingStatus(processingModal.modal, 'Connecting to wallet...');
                    
                    // Handle wallet connection
                    const { provider, fromAddress } = await handleWalletConnection(selectedWallet, amount, recipient, paymentId);
                    
                    // Show recipient confirmation
                    updateProcessingStatus(processingModal.modal, 'Verifying details...');
                    const confirmed = await showRecipientConfirmation(recipient, amount, fromAddress);
                    if (!confirmed) {
                        throw new Error('Payment cancelled by user');
                    }
                    
                    // Switch to BSC network
                    updateProcessingStatus(processingModal.modal, 'Switching to BSC network...');
                    const bscProvider = await ensureBSCNetwork(provider);
                    
                    // Send transaction
                    updateProcessingStatus(processingModal.modal, 'Confirm transaction in your wallet...');
                    const result = await sendUSDTTransaction(recipient, amount, fromAddress, bscProvider);
                    
                    if (result.success) {
                        // Show success
                        showSuccessModal(processingModal, result.txHash, result.explorerUrl, amount);
                        
                        resolve({
                            success: true,
                            txHash: result.txHash,
                            explorerUrl: result.explorerUrl,
                            method: selectedWallet,
                            paymentId: paymentId,
                            amount: amount,
                            usdAmount: usdAmount
                        });
                    } else {
                        throw new Error('Transaction failed on chain');
                    }
                    
                } catch (error) {
                    console.error('Payment error:', error);
                    showErrorModal(processingModal, error.message, amount, paymentId);
                }
            });
            
            // Confirm payment with transaction hash
            const confirmBtn = modal.querySelector('#confirmPaymentBtn');
            addModalListener(confirmBtn, 'click', () => {
                const txHash = modal.querySelector('#txHashInput').value.trim();
                
                if (!txHash) {
                    if (!confirm(`No transaction hash entered. Are you sure you have already sent ${amount} USDT on BSC network?`)) {
                        return;
                    }
                    cleanup();
                    overlay.remove();
                    resolve({ 
                        success: false, 
                        manual: true, 
                        pendingConfirmation: true,
                        paymentId: paymentId
                    });
                    return;
                }
                
                if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                    showAlert('Invalid transaction hash format. Should start with 0x and be 64 characters.', 'error');
                    return;
                }
                
                cleanup();
                overlay.remove();
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

    // ✅ Recipient confirmation modal
    async function showRecipientConfirmation(recipient, amount, fromAddress) {
        return new Promise((resolve) => {
            const content = `
                <div class="bsc-modal-header">
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
                        <div style="font-size: 14px; color: #92400e; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                            <span>⚠️</span>
                            <span>Important Notice</span>
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
            
            const { overlay, modal, cleanup } = createModal(content);
            
            modal.querySelector('#confirmCancelBtn').onclick = () => {
                cleanup();
                overlay.remove();
                resolve(false);
            };
            
            modal.querySelector('#confirmProceedBtn').onclick = () => {
                cleanup();
                overlay.remove();
                resolve(true);
            };
        });
    }

    // ✅ Enhanced processing modal
    function createProcessingModal(paymentId) {
        const content = `
            <div class="bsc-modal-header">
                <h2 class="bsc-modal-title">Processing USDT Payment</h2>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-loading">
                    <div class="bsc-loading-spinner"></div>
                    <div class="bsc-loading-text" id="processingStatus">Initializing USDT payment...</div>
                    <div class="bsc-loading-subtext" id="processingSubtext">
                        Please do not close this window
                    </div>
                </div>
            </div>
        `;
        
        return createModal(content);
    }

    function updateProcessingStatus(modal, text, subtext = 'Please do not close this window') {
        const statusElement = modal.querySelector('#processingStatus');
        const subtextElement = modal.querySelector('#processingSubtext');
        
        if (statusElement) statusElement.textContent = text;
        if (subtextElement) subtextElement.textContent = subtext;
    }

    // ✅ Enhanced success modal
    function showSuccessModal(processingModal, txHash, explorerUrl, amount) {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close" id="successClose" aria-label="Close">×</button>
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
        
        // Replace processing modal content
        processingModal.modal.innerHTML = content;
        
        // Update modal object
        processingModal.modal = processingModal.overlay.querySelector('.bsc-modal');
        
        // Copy TX Hash button
        processingModal.modal.querySelector('#successCopyBtn').onclick = async () => {
            const success = await Utils.copyToClipboard(txHash);
            if (success) {
                showAlert('Transaction hash copied!', 'success', 2000);
            }
        };
        
        // Close button
        processingModal.modal.querySelector('#successClose').onclick = () => {
            processingModal.overlay.remove();
        };
        
        // Done button
        processingModal.modal.querySelector('#successDoneBtn').onclick = () => {
            processingModal.overlay.remove();
        };
    }

    // ✅ Enhanced error modal
    function showErrorModal(processingModal, errorMessage, amount, paymentId) {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close" id="errorClose" aria-label="Close">×</button>
                <h2 class="bsc-modal-title">USDT Payment Failed</h2>
                <p class="bsc-modal-subtitle">Please try again</p>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-error">
                    <div class="bsc-error-title">Error Details</div>
                    ${errorMessage}
                    <div style="margin-top: 12px; font-size: 12px; color: #b91c1c; background: rgba(220, 38, 38, 0.1); padding: 8px; border-radius: 6px;">
                        Payment ID: ${paymentId}
                    </div>
                </div>
                
                <div style="margin: 24px 0; padding: 16px; background: #f8fafc; border-radius: 12px; border-left: 4px solid #3b82f6;">
                    <div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">💡 USDT Payment Tips:</div>
                    <div style="font-size: 13px; color: #475569; line-height: 1.6;">
                        • Ensure you have enough USDT balance (not just BNB)<br>
                        • Make sure you're on BSC network (Chain ID: 56)<br>
                        • Verify you're sending USDT (BEP-20), not other tokens<br>
                        • Check that you have BNB for gas fees<br>
                        • Try increasing gas price if transaction is stuck
                    </div>
                </div>
                
                <button id="errorRetryBtn" class="bsc-btn bsc-btn-primary bsc-btn-full">
                    🔄 Try Again
                </button>
                <button id="errorManualBtn" class="bsc-btn bsc-btn-secondary bsc-btn-full mt-4">
                    📝 Enter TX Hash Manually
                </button>
                <button id="errorCloseBtn" class="bsc-btn bsc-btn-secondary bsc-btn-full mt-2">
                    Close
                </button>
            </div>
        `;
        
        processingModal.modal.innerHTML = content;
        processingModal.modal = processingModal.overlay.querySelector('.bsc-modal');
        
        processingModal.modal.querySelector('#errorClose').onclick = () => {
            processingModal.overlay.remove();
        };
        
        processingModal.modal.querySelector('#errorCloseBtn').onclick = () => {
            processingModal.overlay.remove();
        };
        
        processingModal.modal.querySelector('#errorRetryBtn').onclick = () => {
            processingModal.overlay.remove();
            // Re-initiate payment
            setTimeout(() => initiateBSCPayment(amount || STATE.lastPaymentAmount), 300);
        };
        
        processingModal.modal.querySelector('#errorManualBtn').onclick = () => {
            processingModal.overlay.remove();
            // Show manual entry modal
            setTimeout(() => initiateBSCPayment(amount || STATE.lastPaymentAmount, { mode: 'manual' }), 300);
        };
    }

    // ✅ Main payment function with enhanced options
    async function initiateBSCPayment(amount, options = {}) {
        // Prevent multiple simultaneous payments
        if (STATE.isProcessing) {
            showAlert('Another payment is currently processing. Please wait.', 'warning');
            return { success: false, error: 'Already processing' };
        }
        
        STATE.isProcessing = true;
        
        try {
            // Validate and sanitize amount
            if (!amount || isNaN(amount) || amount <= 0) {
                throw new Error('Invalid payment amount. Please enter a positive number.');
            }
            
            const sanitizedAmount = Utils.sanitizeAmount(amount);
            amount = parseFloat(sanitizedAmount);
            
            if (amount <= 0) {
                throw new Error('Amount must be greater than zero.');
            }
            
            // Validate recipient if provided
            if (options.recipient && !Utils.validateAddress(options.recipient)) {
                throw new Error('Invalid recipient address format.');
            }
            
            // Store last payment amount for retry
            STATE.lastPaymentAmount = amount;
            
            // Inject styles if not already injected
            injectStyles();
            
            // Load transaction history from localStorage
            try {
                const savedHistory = localStorage.getItem('bsc_payment_history');
                if (savedHistory) {
                    STATE.transactionHistory = JSON.parse(savedHistory);
                }
            } catch (e) {
                console.warn('Failed to load transaction history:', e);
            }
            
            // Show payment modal and get result
            const result = await showPaymentModal(amount, options.recipient, options);
            
            if (result.success) {
                // Show success notification
                showAlert(`USDT payment successful! ${amount} USDT sent.`, 'success', 5000, 'top-right');
                
                // Call success callback if provided
                if (typeof options.onSuccess === 'function') {
                    setTimeout(() => options.onSuccess(result), 100);
                }
                
                // Dispatch success event
                document.dispatchEvent(new CustomEvent('bscPaymentSuccess', {
                    detail: {
                        ...result,
                        timestamp: Date.now(),
                        version: '2.2'
                    }
                }));
                
                // Analytics tracking (optional)
                if (options.trackAnalytics !== false) {
                    try {
                        console.log('Payment Analytics:', {
                            event: 'usdt_payment_success',
                            amount: amount,
                            method: result.method,
                            paymentId: result.paymentId,
                            timestamp: Date.now()
                        });
                    } catch (e) {
                        // Silent fail for analytics
                    }
                }
                
            } else if (result.cancelled) {
                console.log('Payment cancelled by user');
                showAlert('USDT payment cancelled', 'info', 3000);
            } else if (result.pendingConfirmation) {
                console.log('Payment pending manual confirmation');
                showAlert('Please confirm payment manually with transaction hash', 'warning', 5000);
            }
            
            return result;
            
        } catch (error) {
            console.error('Payment initiation error:', error);
            showAlert(`USDT payment failed: ${error.message}`, 'error', 5000, 'top-right');
            
            // Call error callback if provided
            if (typeof options.onError === 'function') {
                setTimeout(() => options.onError(error), 100);
            }
            
            // Dispatch error event
            document.dispatchEvent(new CustomEvent('bscPaymentError', {
                detail: {
                    error: error.message,
                    amount: amount,
                    timestamp: Date.now()
                }
            }));
            
            return {
                success: false,
                error: error.message,
                type: error.type || ERROR_TYPES.TRANSACTION
            };
        } finally {
            STATE.isProcessing = false;
        }
    }

    // ✅ Enhanced recipient address update
    function setRecipientAddress(address) {
        if (!Utils.validateAddress(address)) {
            console.error('Invalid BSC address format');
            showAlert('Invalid BSC address format', 'error');
            return false;
        }
        
        CONFIG.RECIPIENT_ADDRESS = address;
        console.log('✅ BSC Recipient address updated:', address);
        showAlert('Recipient address updated successfully', 'success', 3000);
        
        // Dispatch event
        document.dispatchEvent(new CustomEvent('bscRecipientUpdated', {
            detail: { address }
        }));
        
        return true;
    }

    // ✅ Get transaction history
    function getTransactionHistory(limit = 10) {
        return STATE.transactionHistory.slice(-limit).reverse();
    }

    // ✅ Clear transaction history
    function clearTransactionHistory() {
        STATE.transactionHistory = [];
        try {
            localStorage.removeItem('bsc_payment_history');
        } catch (e) {
            console.warn('Failed to clear transaction history:', e);
        }
        return true;
    }

    // ✅ Check if wallet is installed
    function checkWalletInstalled() {
        const wallets = {
            metamask: !!(window.ethereum?.isMetaMask),
            trustwallet: !!(window.ethereum?.isTrust || window.trustwallet),
            coinbase: !!(window.ethereum?.isCoinbaseWallet),
            phantom: !!(window.phantom?.ethereum),
            brave: !!(window.ethereum?.isBraveWallet)
        };
        
        const installed = Object.keys(wallets).filter(key => wallets[key]);
        
        return {
            installed: installed.length > 0,
            wallets: wallets,
            preferred: installed[0] || null
        };
    }

    // ✅ Generate USDT transaction data for manual sending
    function generateUSDTTransaction(recipient, amount) {
        return Utils.generateUSDTTransactionData(recipient, amount);
    }

    // ✅ Initialize and expose to global scope
    function initialize() {
        // Inject styles
        injectStyles();
        
        // Expose functions to window with enhanced API
        window.BSCPayments = {
            // Core functions
            init: initiateBSCPayment,
            initiate: initiateBSCPayment,
            pay: initiateBSCPayment,
            
            // Configuration
            setRecipient: setRecipientAddress,
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
            copyText: async (text) => {
                const success = await Utils.copyToClipboard(text);
                if (success) {
                    showAlert('Copied to clipboard!', 'success', 2000);
                }
                return success;
            },
            truncateAddress: Utils.truncateAddress,
            validateAddress: Utils.validateAddress,
            
            // USDT Specific Functions
            generateUSDTQR: (recipient, amount, element) => {
                generateBSCQR(recipient, amount, element);
            },
            generateUSDTTransaction: generateUSDTTransaction,
            
            // Transaction management
            getHistory: getTransactionHistory,
            clearHistory: clearTransactionHistory,
            
            // Wallet utilities
            checkWallet: checkWalletInstalled,
            
            // State information
            isReady: true,
            version: '2.2.0',
            state: () => ({
                isProcessing: STATE.isProcessing,
                currentPaymentId: STATE.currentPaymentId,
                lastPaymentAmount: STATE.lastPaymentAmount,
                transactionCount: STATE.transactionHistory.length
            }),
            
            // Events
            on: (event, callback) => {
                document.addEventListener(`bsc${event.charAt(0).toUpperCase() + event.slice(1)}`, (e) => callback(e.detail));
            }
        };
        
        // Also expose the main function for backward compatibility
        window.initiateBSCPayment = initiateBSCPayment;
        
        // Mark as ready
        window.BSCPaymentsReady = true;
        document.dispatchEvent(new CustomEvent('bscPaymentsReady', {
            detail: { version: '2.2.0', timestamp: Date.now() }
        }));
        
        // Log initialization
        console.log('🚀 BSC USDT Payment System v2.2 Ready');
        console.log('📋 Available methods:', Object.keys(window.BSCPayments).join(', '));
        
        // Check for default recipient warning
        if (CONFIG.RECIPIENT_ADDRESS === "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d") {
            console.warn('⚠️  USING DEFAULT RECIPIENT ADDRESS - UPDATE BEFORE PRODUCTION!');
        }
        
        // Check for WalletConnect Project ID warning
        if (CONFIG.WALLETCONNECT_PROJECT_ID === "YOUR_WALLETCONNECT_PROJECT_ID") {
            console.warn('⚠️  Please set your WalletConnect Project ID from https://cloud.walletconnect.com/');
            console.warn('⚠️  Update CONFIG.WALLETCONNECT_PROJECT_ID with your actual project ID');
        }
    }

    // ✅ Auto-initialize with error handling
    function safeInitialize() {
        try {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initialize);
            } else {
                setTimeout(initialize, 100); // Small delay for better integration
            }
        } catch (error) {
            console.error('Failed to initialize BSC Payments:', error);
            // Still expose basic functions
            window.BSCPayments = {
                init: () => Promise.reject('System not initialized properly'),
                isReady: false,
                error: error.message
            };
        }
    }

    // Start initialization
    safeInitialize();

})();