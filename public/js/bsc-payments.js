// ======================================================
// 🚀 ENTERPRISE-GRADE BSC USDT PAYMENT SYSTEM
// Version 2.2 - Enhanced QR Codes with USDT Support
// ======================================================

(function() {
    'use strict';
    
    // ✅ State management
    const STATE = {
        currentPaymentId: null,
        modalListeners: new Map(),
        transactionHistory: [],
        lastPaymentAmount: null,
        isProcessing: false,
        exchangeRates: {},
        walletConnect: null,
        walletConnectProvider: null,
        walletConnectURI: null
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

    // ✅ Configuration with enhanced validation
    const CONFIG = {
        BSC_USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        BSC_CHAIN_ID: 56,
        BSC_RPC: "https://bsc-dataseed.binance.org/",
        EXPLORER_URL: "https://bscscan.com/tx/",
        RECIPIENT_ADDRESS: "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d", // Replace with your address
        DECIMALS: 18,  // BSC USDT uses 18 decimals
        // Enhanced config
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        GAS_BUFFER: 20, // 20% buffer
        CONFIRMATION_TIMEOUT: 60000, // 60 seconds
        TEST_MODE: false,
        DEFAULT_CURRENCY: 'USD',
        // WalletConnect Project ID (Get one from https://cloud.walletconnect.com/)
        WALLETCONNECT_PROJECT_ID: "61d9b98f81731dffa9988c0422676fc5",
        WALLETCONNECT_METADATA: {
            name: "BSC USDT Payment System",
            description: "Enterprise BSC USDT Payment Solution",
            url: window.location.origin,
            icons: ["https://bscscan.com/favicon.ico"]
        }
    };

    // ✅ Wallet-specific instructions (globally accessible)
    function getWalletSpecificInstructions(walletType, amount) {
        const instructions = {
            metamask: {
                title: "MetaMask Instructions",
                steps: [
                    "Scan QR code or paste URI",
                    "MetaMask will prompt to switch to BSC",
                    `Verify amount is ${amount} BSC USDT`,
                    "Confirm transaction"
                ]
            },
            trustwallet: {
                title: "Trust Wallet Instructions",
                steps: [
                    "Scan QR code",
                    "Trust Wallet opens BSC USDT transfer",
                    "Verify recipient and amount",
                    "Confirm and send"
                ]
            },
            default: {
                title: "General Instructions",
                steps: [
                    "Scan QR with any BSC-compatible wallet",
                    "Make sure you're on BSC network (Chain ID: 56)",
                    "Verify you're sending BSC USDT (BEP-20)",
                    "Confirm transaction"
                ]
            }
        };
        return instructions[walletType] || instructions.default;
    }

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

        // Enhanced BSC USDT QR data generator
        generateBSCUSDTQRData: (recipient, amount) => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            // Option 1: Standard EIP-681 with BSC chain ID
            const erc681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            // Option 2: With explicit chainId param
            const withChainParam = `ethereum:${CONFIG.BSC_USDT_ADDRESS}/transfer?address=${recipient}&uint256=${amountWei}&chainId=${CONFIG.BSC_CHAIN_ID}`;
            // Option 3: BSC-specific URI
            const bscSpecific = `bsc:${CONFIG.BSC_USDT_ADDRESS}/transfer?to=${recipient}&value=${amountWei}`;
            return {
                primary: erc681URI,
                withChainParam: withChainParam,
                bscSpecific: bscSpecific,
                recipient: recipient,
                amount: amount,
                amountWei: amountWei,
                network: 'BSC',
                token: 'USDT',
                decimals: 18
            };
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
        generateUSDTTransaction: (recipient, amount) => {
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
        },

        // Generate multiple URI formats for wallet compatibility
        generatePaymentURIs: (recipient, amount) => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            // Format 1: EIP-681 for token transfer (MetaMask, some wallets)
            // ethereum:<contract>@<chainId>/transfer?address=<to>&uint256=<amount>
            const eip681Token = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            // Format 2: Simple address with chain (Trust Wallet, basic wallets)
            // Just the recipient address - user manually selects token
            const simpleAddress = recipient;
            // Format 3: BNB Chain specific format (some BSC wallets)
            const bnbFormat = `bnb:${recipient}?amount=${amount}&token=${CONFIG.BSC_USDT_ADDRESS}`;
            // Format 4: WalletConnect compatible deep link
            const wcFormat = `wc:${recipient}@${CONFIG.BSC_CHAIN_ID}?asset=USDT&amount=${amount}`;
            return {
                eip681Token,      // Best for MetaMask
                simpleAddress,    // Universal fallback
                bnbFormat,        // BSC specific
                wcFormat,         // WalletConnect
                // Primary - use EIP-681 as most compatible for token transfers
                primary: eip681Token
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
                border-radius: 50
                            .bsc-step-number {
                background: #f59e0b;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                font-size: 14px;
                flex-shrink: 0;
            }
            
            .bsc-step-content {
                flex: 1;
            }
            
            .bsc-step-title {
                font-size: 15px;
                font-weight: 600;
                color: #1e293b;
                margin-bottom: 4px;
            }
            
            .bsc-step-desc {
                font-size: 13px;
                color: #64748b;
                line-height: 1.5;
            }
            
            .bsc-connection-status {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 12px 18px;
                border-radius: 12px;
                margin-bottom: 20px;
                font-size: 14px;
                font-weight: 500;
            }
            
            .bsc-status-connected {
                background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
                color: #065f46;
                border: 2px solid #10b981;
            }
            
            .bsc-status-disconnected {
                background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                color: #991b1b;
                border: 2px solid #ef4444;
            }
            
            .bsc-status-connecting {
                background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                color: #92400e;
                border: 2px solid #f59e0b;
            }
            
            .bsc-status-indicator {
                width: 10px;
                height: 10px;
                border-radius: 50%;
            }
            
            .bsc-status-connected .bsc-status-indicator {
                background: #10b981;
                box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
                animation: pulse 2s infinite;
            }
            
            .bsc-status-disconnected .bsc-status-indicator {
                background: #ef4444;
            }
            
            .bsc-status-connecting .bsc-status-indicator {
                background: #f59e0b;
                animation: pulse 1s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .bsc-toggle-container {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 20px;
                padding: 16px;
                background: #f8fafc;
                border-radius: 12px;
                border: 1px solid #e2e8f0;
            }
            
            .bsc-toggle-label {
                font-size: 15px;
                font-weight: 600;
                color: #1e293b;
            }
            
            .bsc-toggle-switch {
                position: relative;
                display: inline-block;
                width: 60px;
                height: 34px;
            }
            
            .bsc-toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            
            .bsc-toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: #cbd5e1;
                transition: .4s;
                border-radius: 34px;
            }
            
            .bsc-toggle-slider:before {
                position: absolute;
                content: "";
                height: 26px;
                width: 26px;
                left: 4px;
                bottom: 4px;
                background-color: white;
                transition: .4s;
                border-radius: 50%;
            }
            
            input:checked + .bsc-toggle-slider {
                background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            }
            
            input:checked + .bsc-toggle-slider:before {
                transform: translateX(26px);
            }
            
            .bsc-expanded-details {
                background: #f8fafc;
                border-radius: 12px;
                padding: 20px;
                margin-top: 20px;
                border: 1px solid #e2e8f0;
                animation: slideDown 0.3s ease-out;
            }
            
            @keyframes slideDown {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .bsc-detail-row {
                display: flex;
                justify-content: space-between;
                padding: 12px 0;
                border-bottom: 1px solid #e2e8f0;
            }
            
            .bsc-detail-row:last-child {
                border-bottom: none;
            }
            
            .bsc-detail-label {
                color: #64748b;
                font-weight: 500;
                font-size: 14px;
            }
            
            .bsc-detail-value {
                color: #1e293b;
                font-weight: 600;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
                font-size: 14px;
            }
            
            .bsc-wallet-selector {
                background: white;
                border-radius: 12px;
                border: 2px solid #e2e8f0;
                padding: 24px;
                margin-bottom: 24px;
            }
            
            .bsc-wallet-option {
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 16px;
                border-radius: 12px;
                background: #f8fafc;
                border: 2px solid #e2e8f0;
                margin-bottom: 12px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .bsc-wallet-option:hover {
                border-color: #f59e0b;
                background: white;
                transform: translateY(-2px);
                box-shadow: 0 8px 16px rgba(245, 158, 11, 0.1);
            }
            
            .bsc-wallet-option:last-child {
                margin-bottom: 0;
            }
            
            .bsc-wallet-icon {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                flex-shrink: 0;
                border: 1px solid #e2e8f0;
            }
            
            .bsc-wallet-info {
                flex: 1;
            }
            
            .bsc-wallet-name {
                font-size: 16px;
                font-weight: 700;
                color: #1e293b;
                margin-bottom: 4px;
            }
            
            .bsc-wallet-desc {
                font-size: 13px;
                color: #64748b;
            }
            
            @media (max-width: 480px) {
                .bsc-modal {
                    width: 100%;
                    max-width: 100vw;
                    max-height: 100vh;
                    border-radius: 0;
                }
                
                .bsc-modal-header {
                    padding: 20px 20px 16px;
                }
                
                .bsc-modal-body {
                    padding: 20px;
                }
                
                .bsc-amount {
                    font-size: 36px;
                }
                
                .bsc-action-buttons {
                    grid-template-columns: 1fr;
                }
                
                .bsc-qr-container {
                    width: 200px;
                    height: 200px;
                }
            }
            
            .bsc-error {
                background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                border: 2px solid #ef4444;
                border-radius: 12px;
                padding: 18px 20px;
                margin-bottom: 24px;
                font-size: 14px;
                color: #991b1b;
                animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
            }
            
            @keyframes shake {
                10%, 90% { transform: translateX(-1px); }
                20%, 80% { transform: translateX(2px); }
                30%, 50%, 70% { transform: translateX(-2px); }
                40%, 60% { transform: translateX(2px); }
            }
            
            .bsc-error-title {
                font-weight: 700;
                margin-bottom: 6px;
                font-size: 16px;
            }
            
            .bsc-error-message {
                line-height: 1.5;
            }
            
            .bsc-warning {
                background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                border: 2px solid #f59e0b;
                border-radius: 12px;
                padding: 18px 20px;
                margin-bottom: 24px;
                font-size: 14px;
                color: #92400e;
            }
            
            .bsc-notification {
                position: fixed;
                bottom: 24px;
                right: 24px;
                background: white;
                border-radius: 12px;
                padding: 18px 24px;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
                z-index: 10001;
                animation: slideInRight 0.3s ease-out;
                border-left: 4px solid #f59e0b;
                min-width: 300px;
                max-width: 400px;
            }
            
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            .bsc-notification-success {
                border-left-color: #10b981;
            }
            
            .bsc-notification-error {
                border-left-color: #ef4444;
            }
            
            .bsc-notification-warning {
                border-left-color: #f59e0b;
            }
            
            .bsc-notification-title {
                font-weight: 700;
                margin-bottom: 6px;
                font-size: 15px;
                color: #1e293b;
            }
            
            .bsc-notification-message {
                font-size: 14px;
                color: #64748b;
                line-height: 1.5;
            }
            
            .bsc-loader-text {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 14px;
                color: #64748b;
            }
            
            .bsc-loader-dots {
                display: flex;
                gap: 4px;
            }
            
            .bsc-loader-dots span {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #f59e0b;
                animation: bounce 1.4s infinite ease-in-out both;
            }
            
            .bsc-loader-dots span:nth-child(1) { animation-delay: -0.32s; }
            .bsc-loader-dots span:nth-child(2) { animation-delay: -0.16s; }
            
            @keyframes bounce {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1); }
            }
            
            .bsc-qr-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 16px;
                opacity: 0;
                transition: opacity 0.3s;
            }
            
            .bsc-qr-container:hover .bsc-qr-overlay {
                opacity: 1;
            }
            
            .bsc-qr-overlay-content {
                text-align: center;
                color: white;
                padding: 20px;
            }
            
            .bsc-qr-overlay-icon {
                font-size: 48px;
                margin-bottom: 12px;
            }
            
            .bsc-qr-overlay-text {
                font-size: 16px;
                font-weight: 600;
            }
            
            .bsc-progress-bar {
                width: 100%;
                height: 6px;
                background: #e2e8f0;
                border-radius: 3px;
                overflow: hidden;
                margin: 20px 0;
            }
            
            .bsc-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #f59e0b, #fbbf24);
                border-radius: 3px;
                transition: width 0.3s ease-out;
                width: 0%;
            }
        `;
        document.head.appendChild(style);
    }

    // ✅ Enhanced notification system
    const Notification = {
        show: (type, title, message, duration = 5000) => {
            const notification = document.createElement('div');
            notification.className = `bsc-notification bsc-notification-${type}`;
            notification.innerHTML = `
                <div class="bsc-notification-title">${title}</div>
                <div class="bsc-notification-message">${message}</div>
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideInRight 0.3s ease-out reverse';
                setTimeout(() => {
                    if (notification.parentNode) {
                        document.body.removeChild(notification);
                    }
                }, 300);
            }, duration);
            
            return notification;
        },
        
        success: (message, title = 'Success', duration = 5000) => {
            return Notification.show('success', title, message, duration);
        },
        
        error: (message, title = 'Error', duration = 7000) => {
            return Notification.show('error', title, message, duration);
        },
        
        warning: (message, title = 'Warning', duration = 6000) => {
            return Notification.show('warning', title, message, duration);
        }
    };

    // ✅ Wallet detection and connection
    const Wallet = {
        // Detect available wallets
        detectAvailableWallets: () => {
            const wallets = [];
            
            // Check for MetaMask
            if (typeof window.ethereum !== 'undefined') {
                wallets.push({
                    id: 'metamask',
                    name: 'MetaMask',
                    icon: '🦊',
                    description: 'Most popular Ethereum wallet',
                    detected: true,
                    priority: 1
                });
            }
            
            // Check for Trust Wallet
            if (typeof window.ethereum !== 'undefined' && 
                window.ethereum.isTrust === true) {
                wallets.push({
                    id: 'trustwallet',
                    name: 'Trust Wallet',
                    icon: '🔒',
                    description: 'Mobile-first crypto wallet',
                    detected: true,
                    priority: 2
                });
            }
            
            // Check for Binance Chain Wallet
            if (typeof window.BinanceChain !== 'undefined') {
                wallets.push({
                    id: 'binance',
                    name: 'Binance Chain Wallet',
                    icon: '💰',
                    description: 'Official Binance wallet',
                    detected: true,
                    priority: 3
                });
            }
            
            // Check for WalletConnect capability
            wallets.push({
                id: 'walletconnect',
                name: 'WalletConnect',
                icon: '🔗',
                description: 'Connect any wallet via QR code',
                detected: true,
                priority: 4
            });
            
            // Add Coinbase Wallet if available
            if (typeof window.coinbaseWalletExtension !== 'undefined' || 
                (typeof window.ethereum !== 'undefined' && window.ethereum.isCoinbaseWallet)) {
                wallets.push({
                    id: 'coinbase',
                    name: 'Coinbase Wallet',
                    icon: '🏦',
                    description: 'Coinbase official wallet',
                    detected: true,
                    priority: 5
                });
            }
            
            // Sort by priority and detection
            return wallets.sort((a, b) => {
                if (a.detected !== b.detected) return b.detected - a.detected;
                return a.priority - b.priority;
            });
        },

        // Connect to a specific wallet
        connectWallet: async (walletId, retries = 3) => {
            try {
                // Check if already connected
                if (STATE.walletConnect && walletId === 'walletconnect') {
                    return STATE.walletConnect;
                }
                
                // Switch network to BSC
                await Wallet.switchToBSCNetwork(walletId);
                
                let provider;
                
                switch (walletId) {
                    case 'metamask':
                    case 'trustwallet':
                    case 'coinbase':
                        if (typeof window.ethereum === 'undefined') {
                            throw new Error(`${walletId} not detected. Please install the extension.`);
                        }
                        provider = new ethers.providers.Web3Provider(window.ethereum);
                        await provider.send('eth_requestAccounts', []);
                        break;
                        
                    case 'binance':
                        if (typeof window.BinanceChain === 'undefined') {
                            throw new Error('Binance Chain Wallet not detected.');
                        }
                        await window.BinanceChain.request({ method: 'eth_requestAccounts' });
                        provider = new ethers.providers.Web3Provider(window.BinanceChain);
                        break;
                        
                    case 'walletconnect':
                        provider = await Wallet.connectWithWalletConnect();
                        break;
                        
                    default:
                        throw new Error(`Unknown wallet: ${walletId}`);
                }
                
                if (provider) {
                    const signer = provider.getSigner();
                    const address = await signer.getAddress();
                    const network = await provider.getNetwork();
                    
                    console.log(`✅ Connected to ${walletId}:`, address);
                    
                    return {
                        walletId,
                        provider,
                        signer,
                        address,
                        network,
                        chainId: network.chainId
                    };
                }
                
                throw new Error('Failed to connect wallet');
                
            } catch (error) {
                console.error(`❌ Wallet connection error (${walletId}):`, error);
                
                if (retries > 0 && Utils.isRetryableError(error)) {
                    console.log(`Retrying connection... (${retries} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return Wallet.connectWallet(walletId, retries - 1);
                }
                
                throw error;
            }
        },

        // Connect with WalletConnect
        connectWithWalletConnect: async () => {
            try {
                // Load WalletConnect library
                await Utils.loadWalletConnect();
                
                if (typeof WalletConnect === 'undefined') {
                    throw new Error('WalletConnect library failed to load');
                }
                
                // Destroy existing connection
                if (STATE.walletConnect) {
                    try {
                        await STATE.walletConnect.killSession();
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                }
                
                // Create new WalletConnect instance
                STATE.walletConnect = new WalletConnect.default({
                    bridge: "https://bridge.walletconnect.org",
                    qrcodeModal: {
                        open: (uri) => {
                            STATE.walletConnectURI = uri;
                            // Show custom QR modal
                            Wallet.showWalletConnectQR(uri);
                        },
                        close: () => {
                            // Hide custom QR modal
                            const modal = document.querySelector('.bsc-walletconnect-modal');
                            if (modal) modal.remove();
                        }
                    }
                });
                
                // Check if connection is already established
                if (!STATE.walletConnect.connected) {
                    // Create new session
                    await STATE.walletConnect.createSession();
                }
                
                // Subscribe to session updates
                STATE.walletConnect.on("session_update", (error, payload) => {
                    if (error) throw error;
                    console.log("WalletConnect session updated:", payload);
                });
                
                STATE.walletConnect.on("disconnect", (error) => {
                    if (error) throw error;
                    console.log("WalletConnect disconnected");
                    STATE.walletConnect = null;
                    Notification.warning('WalletConnect session disconnected');
                });
                
                // Get provider
                STATE.walletConnectProvider = STATE.walletConnect;
                return new ethers.providers.Web3Provider(STATE.walletConnect);
                
            } catch (error) {
                console.error('❌ WalletConnect error:', error);
                throw error;
            }
        },

        // Show WalletConnect QR modal
        showWalletConnectQR: (uri) => {
            const modal = document.createElement('div');
            modal.className = 'bsc-modal-overlay bsc-walletconnect-modal';
            modal.innerHTML = `
                <div class="bsc-modal">
                    <div class="bsc-modal-header">
                        <h2 class="bsc-modal-title">WalletConnect</h2>
                        <p class="bsc-modal-subtitle">Scan with your mobile wallet</p>
                        <button class="bsc-modal-close" onclick="this.closest('.bsc-modal-overlay').remove()">×</button>
                    </div>
                    <div class="bsc-modal-body">
                        <div class="bsc-qr-container" style="margin: 0 auto 24px;">
                            <canvas id="bsc-walletconnect-qr"></canvas>
                            <div class="bsc-qr-overlay">
                                <div class="bsc-qr-overlay-content">
                                    <div class="bsc-qr-overlay-icon">📱</div>
                                    <div class="bsc-qr-overlay-text">Scan with Wallet</div>
                                </div>
                            </div>
                        </div>
                        <div class="bsc-network-info">
                            Make sure your wallet is set to <strong>BSC Mainnet (Chain ID: 56)</strong>
                        </div>
                        <button class="bsc-btn bsc-btn-secondary bsc-btn-full" onclick="navigator.clipboard.writeText('${uri}')">
                            📋 Copy Connection URI
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Generate QR code
            if (typeof QRCode !== 'undefined') {
                new QRCode(document.getElementById('bsc-walletconnect-qr'), {
                    text: uri,
                    width: 200,
                    height: 200,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });
            }
        },

        // Switch to BSC network
        switchToBSCNetwork: async (walletId) => {
            try {
                if (walletId === 'walletconnect') {
                    // WalletConnect handles network switching differently
                    return true;
                }
                
                const chainIdHex = '0x' + CONFIG.BSC_CHAIN_ID.toString(16);
                const chainData = {
                    chainId: chainIdHex,
                    chainName: 'BNB Smart Chain',
                    nativeCurrency: {
                        name: 'BNB',
                        symbol: 'BNB',
                        decimals: 18
                    },
                    rpcUrls: [CONFIG.BSC_RPC],
                    blockExplorerUrls: [CONFIG.EXPLORER_URL.replace('/tx/', '')]
                };
                
                if (walletId === 'metamask' || walletId === 'trustwallet' || walletId === 'coinbase') {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_switchEthereumChain',
                            params: [{ chainId: chainIdHex }],
                        });
                    } catch (switchError) {
                        // This error code indicates that the chain has not been added to MetaMask
                        if (switchError.code === 4902) {
                            await window.ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [chainData],
                            });
                        } else {
                            throw switchError;
                        }
                    }
                } else if (walletId === 'binance') {
                    try {
                        await window.BinanceChain.switchNetwork(CONFIG.BSC_CHAIN_ID);
                    } catch (error) {
                        console.warn('Network switch failed, continuing anyway:', error);
                    }
                }
                
                return true;
            } catch (error) {
                console.error('Network switch error:', error);
                Notification.warning(
                    'Failed to switch to BSC network. Please manually switch to BSC Mainnet (Chain ID: 56) in your wallet.',
                    'Network Warning'
                );
                return false;
            }
        },

        // Disconnect wallet
        disconnectWallet: async () => {
            try {
                if (STATE.walletConnect) {
                    await STATE.walletConnect.killSession();
                    STATE.walletConnect = null;
                    STATE.walletConnectProvider = null;
                }
                
                // Clear any stored connection data
                localStorage.removeItem('bsc-wallet-connected');
                
                Notification.success('Wallet disconnected successfully');
                return true;
            } catch (error) {
                console.error('Disconnection error:', error);
                return false;
            }
        }
    };

    // ✅ QR Code management
    const QRCodeManager = {
        // Generate QR code with enhanced options
        generate: async (data, elementId, options = {}) => {
            return new Promise((resolve, reject) => {
                try {
                    if (typeof QRCode === 'undefined') {
                        throw new Error('QRCode library not loaded');
                    }
                    
                    const defaultOptions = {
                        text: data,
                        width: 200,
                        height: 200,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.H,
                        quietZone: 10,
                        quietZoneColor: "transparent",
                        logo: null,
                        logoWidth: 40,
                        logoHeight: 40,
                        logoBackgroundColor: "#ffffff"
                    };
                    
                    const finalOptions = { ...defaultOptions, ...options };
                    
                    // Clear previous QR code
                    const element = document.getElementById(elementId);
                    if (!element) {
                        throw new Error(`Element with id "${elementId}" not found`);
                    }
                    
                    element.innerHTML = '';
                    
                    // Create QR code
                    const qrcode = new QRCode(element, finalOptions);
                    
                    // Add logo if specified
                    if (finalOptions.logo) {
                        setTimeout(() => {
                            const canvas = element.querySelector('canvas');
                            if (canvas) {
                                const ctx = canvas.getContext('2d');
                                const logo = new Image();
                                logo.onload = () => {
                                    const centerX = canvas.width / 2 - finalOptions.logoWidth / 2;
                                    const centerY = canvas.height / 2 - finalOptions.logoHeight / 2;
                                    
                                    // Draw logo background
                                    ctx.fillStyle = finalOptions.logoBackgroundColor;
                                    ctx.fillRect(centerX - 5, centerY - 5, 
                                               finalOptions.logoWidth + 10, finalOptions.logoHeight + 10);
                                    
                                    // Draw logo
                                    ctx.drawImage(logo, centerX, centerY, 
                                                finalOptions.logoWidth, finalOptions.logoHeight);
                                };
                                logo.src = finalOptions.logo;
                            }
                        }, 100);
                    }
                    
                    CACHE.qrCode = qrcode;
                    resolve(qrcode);
                    
                } catch (error) {
                    console.error('❌ QR Code generation error:', error);
                    
                    // Fallback: Show data as text
                    const element = document.getElementById(elementId);
                    if (element) {
                        element.innerHTML = `
                            <div style="text-align: center; padding: 20px;">
                                <div style="color: #ef4444; margin-bottom: 10px;">⚠️ QR Generation Failed</div>
                                <div style="font-family: monospace; font-size: 12px; color: #64748b;">
                                    ${data.substring(0, 100)}...
                                </div>
                                <button onclick="navigator.clipboard.writeText('${data}')" 
                                        style="margin-top: 10px; padding: 8px 16px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                    📋 Copy Payment Data
                                </button>
                            </div>
                        `;
                    }
                    
                    reject(error);
                }
            });
        },

        // Generate multiple QR codes for different formats
        generateAllFormats: (recipient, amount) => {
            const uris = Utils.generatePaymentURIs(recipient, amount);
            const txData = Utils.generateUSDTTransaction(recipient, amount);
            
            return {
                uris: uris,
                transaction: txData,
                primary: uris.primary,
                fallback: uris.simpleAddress
            };
        },

        // Save QR code as image
        saveAsImage: (elementId, filename = 'bsc-payment-qr.png') => {
            return new Promise((resolve, reject) => {
                try {
                    const canvas = document.querySelector(`#${elementId} canvas`);
                    if (!canvas) {
                        throw new Error('QR Code canvas not found');
                    }
                    
                    // Create a temporary link
                    const link = document.createElement('a');
                    link.download = filename;
                    link.href = canvas.toDataURL('image/png');
                    
                    // Trigger download
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    Notification.success('QR code saved as image', 'Download Complete');
                    resolve();
                } catch (error) {
                    console.error('❌ QR Code save error:', error);
                    Notification.error('Failed to save QR code', 'Error');
                    reject(error);
                }
            });
        }
    };

    // ✅ Payment processor
    const PaymentProcessor = {
        // Initialize payment
        initialize: async (amount, currency = 'USD') => {
            try {
                STATE.isProcessing = true;
                STATE.currentPaymentId = Utils.generateId();
                STATE.lastPaymentAmount = amount;
                
                // Convert amount if needed
                let finalAmount = amount;
                if (currency !== 'USDT') {
                    const exchangeRate = await PaymentProcessor.getExchangeRate(currency);
                    if (exchangeRate) {
                        finalAmount = (amount / exchangeRate).toFixed(6);
                    }
                }
                
                // Store transaction
                STATE.transactionHistory.push({
                    id: STATE.currentPaymentId,
                    amount: finalAmount,
                    currency: 'USDT',
                    originalAmount: amount,
                    originalCurrency: currency,
                    status: 'initialized',
                    timestamp: Date.now(),
                    recipient: CONFIG.RECIPIENT_ADDRESS
                });
                
                return {
                    paymentId: STATE.currentPaymentId,
                    amount: finalAmount,
                    currency: 'USDT',
                    recipient: CONFIG.RECIPIENT_ADDRESS
                };
                
            } catch (error) {
                console.error('❌ Payment initialization error:', error);
                throw error;
            }
        },

        // Get exchange rate
        getExchangeRate: async (currency = 'USD') => {
            try {
                // Check cache first
                const now = Date.now();
                if (CACHE.exchangeRate && 
                    now - CACHE.lastRateUpdate < 300000) { // 5 minutes cache
                    return CACHE.exchangeRate[currency] || 1;
                }
                
                // Fetch from Binance API
                const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=USDT${currency.toUpperCase()}`);
                if (!response.ok) throw new Error('Failed to fetch exchange rate');
                
                const data = await response.json();
                const rate = parseFloat(data.price);
                
                // Update cache
                CACHE.exchangeRate = {
                    [currency]: rate,
                    lastUpdate: now
                };
                CACHE.lastRateUpdate = now;
                
                return rate;
                
            } catch (error) {
                console.warn('Exchange rate fetch failed, using default:', error);
                return 1; // Fallback to 1:1
            }
        },

        // Process payment from connected wallet
        processWithWallet: async (walletId, amount) => {
            try {
                STATE.isProcessing = true;
                
                // Connect wallet if not already connected
                const wallet = await Wallet.connectWallet(walletId);
                if (!wallet) {
                    throw new Error('Wallet connection failed');
                }
                
                // Generate transaction data
                const txData = Utils.generateUSDTTransaction(CONFIG.RECIPIENT_ADDRESS, amount);
                
                // Estimate gas
                const gasEstimate = await wallet.provider.estimateGas({
                    to: txData.to,
                    data: txData.data
                });
                
                // Add buffer to gas
                const gasWithBuffer = gasEstimate.mul(100 + CONFIG.GAS_BUFFER).div(100);
                
                // Get current gas price
                const gasPrice = await wallet.provider.getGasPrice();
                
                // Build transaction
                const transaction = {
                    to: txData.to,
                    data: txData.data,
                    value: '0x0',
                    gasLimit: gasWithBuffer.toHexString(),
                    gasPrice: gasPrice.mul(120).div(100).toHexString(), // 20% higher for speed
                    chainId: CONFIG.BSC_CHAIN_ID
                };
                
                // Send transaction
                Notification.show('info', 'Processing', 'Please confirm transaction in your wallet...', 0);
                
                const txResponse = await wallet.signer.sendTransaction(transaction);
                
                // Update UI
                Notification.show('info', 'Transaction Sent', 'Waiting for confirmation...', 0);
                
                // Wait for confirmation
                const receipt = await Utils.monitorTransaction(txResponse.hash);
                
                // Update transaction history
                const txIndex = STATE.transactionHistory.findIndex(tx => tx.id === STATE.currentPaymentId);
                if (txIndex !== -1) {
                    STATE.transactionHistory[txIndex] = {
                        ...STATE.transactionHistory[txIndex],
                        txHash: txResponse.hash,
                        receipt: receipt,
                        status: receipt.status === 1 ? 'completed' : 'failed',
                        confirmedAt: Date.now(),
                        blockNumber: receipt.blockNumber,
                        gasUsed: receipt.gasUsed.toString()
                    };
                }
                
                // Show success
                Notification.success(
                    `Payment of ${amount} USDT completed successfully!`,
                    'Payment Successful'
                );
                
                return {
                    success: true,
                    txHash: txResponse.hash,
                    receipt: receipt,
                    explorerUrl: `${CONFIG.EXPLORER_URL}${txResponse.hash}`
                };
                
            } catch (error) {
                console.error('❌ Payment processing error:', error);
                
                // Update transaction history
                const txIndex = STATE.transactionHistory.findIndex(tx => tx.id === STATE.currentPaymentId);
                if (txIndex !== -1) {
                    STATE.transactionHistory[txIndex].status = 'failed';
                    STATE.transactionHistory[txIndex].error = error.message;
                }
                
                Notification.error(
                    `Payment failed: ${error.message}`,
                    'Payment Error'
                );
                
                throw error;
            } finally {
                STATE.isProcessing = false;
            }
        },

        // Verify transaction
        verifyTransaction: async (txHash) => {
            try {
                if (!CACHE.provider) {
                    CACHE.provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
                }
                
                const receipt = await CACHE.provider.getTransactionReceipt(txHash);
                if (!receipt) {
                    throw new Error('Transaction not found');
                }
                
                // Check if transaction is to USDT contract
                const tx = await CACHE.provider.getTransaction(txHash);
                if (tx.to.toLowerCase() !== CONFIG.BSC_USDT_ADDRESS.toLowerCase()) {
                    throw new Error('Transaction is not to USDT contract');
                }
                
                // Parse transaction data to verify amount and recipient
                // This would require parsing the USDT transfer event logs
                
                return {
                    found: true,
                    confirmed: receipt.confirmations > 0,
                    confirmations: receipt.confirmations,
                    blockNumber: receipt.blockNumber,
                    status: receipt.status === 1 ? 'success' : 'failed',
                    receipt: receipt
                };
                
            } catch (error) {
                console.error('❌ Transaction verification error:', error);
                return {
                    found: false,
                    error: error.message
                };
            }
        }
    };

    // ✅ Modal management
    const Modal = {
        // Create and show modal
        show: (content, options = {}) => {
            // Close any existing modal
            Modal.close();
            
            const modalId = options.id || 'bsc-payment-modal';
            const title = options.title || 'BSC USDT Payment';
            const subtitle = options.subtitle || 'Send USDT on Binance Smart Chain';
            
            // Create modal container
            const overlay = document.createElement('div');
            overlay.className = 'bsc-modal-overlay';
            overlay.id = modalId;
            
            // Create modal content
            overlay.innerHTML = `
                <div class="bsc-modal">
                    <div class="bsc-modal-header">
                        <h2 class="bsc-modal-title">${title}</h2>
                        ${subtitle ? `<p class="bsc-modal-subtitle">${subtitle}</p>` : ''}
                        <button class="bsc-modal-close" onclick="window.BSCPayment.closeModal('${modalId}')">×</button>
                    </div>
                    <div class="bsc-modal-body">
                        ${content}
                    </div>
                </div>
            `;
            
            // Add to document
            document.body.appendChild(overlay);
            
            // Add click outside to close
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    Modal.close();
                }
            });
            
            // Add ESC key listener
            const escListener = (e) => {
                if (e.key === 'Escape') {
                    Modal.close();
                }
            };
            STATE.modalListeners.set(modalId, escListener);
            document.addEventListener('keydown', escListener);
            
            return modalId;
        },

        // Close modal
        close: (modalId = 'bsc-payment-modal') => {
            const modal = document.getElementById(modalId);
            if (modal) {
                // Remove event listener
                const listener = STATE.modalListeners.get(modalId);
                if (listener) {
                    document.removeEventListener('keydown', listener);
                    STATE.modalListeners.delete(modalId);
                }
                
                // Add fade out animation
                modal.style.animation = 'fadeIn 0.25s ease-out reverse';
                setTimeout(() => {
                    if (modal.parentNode) {
                        document.body.removeChild(modal);
                    }
                }, 250);
            }
        },

        // Show loading state
        showLoading: (message = 'Processing...', submessage = 'Please wait') => {
            const content = `
                <div class="bsc-loading">
                    <div class="bsc-loading-spinner"></div>
                    <div class="bsc-loading-text">${message}</div>
                    ${submessage ? `<div class="bsc-loading-subtext">${submessage}</div>` : ''}
                </div>
            `;
            return Modal.show(content, { title: 'Processing Payment' });
        },

        // Show success state
        showSuccess: (message, txHash = null) => {
            let txLink = '';
            if (txHash) {
                txLink = `
                    <a href="${CONFIG.EXPLORER_URL}${txHash}" 
                       target="_blank" 
                       class="bsc-tx-link">
                        🔍 View on BscScan
                    </a>
                `;
            }
            
            const content = `
                <div class="bsc-success">
                    <div class="bsc-success-icon">✅</div>
                    <div class="bsc-success-text">Payment Successful!</div>
                    <div class="bsc-success-subtext">${message}</div>
                    ${txLink}
                    <div style="margin-top: 32px;">
                        <button class="bsc-btn bsc-btn-primary bsc-btn-full" 
                                onclick="window.BSCPayment.closeModal()">
                            Close
                        </button>
                    </div>
                </div>
            `;
            
            return Modal.show(content, { title: 'Payment Complete' });
        },

        // Show error state
        showError: (error, title = 'Payment Error') => {
            const content = `
                <div class="bsc-error">
                    <div class="bsc-error-title">${title}</div>
                    <div class="bsc-error-message">${error}</div>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                    <button class="bsc-btn bsc-btn-secondary" 
                            onclick="window.BSCPayment.closeModal()">
                        Close
                    </button>
                    <button class="bsc-btn bsc-btn-primary" 
                            onclick="window.BSCPayment.retryPayment()" 
                            style="margin-left: 12px;">
                        Try Again
                    </button>
                </div>
            `;
            
            return Modal.show(content, { title: 'Error' });
        },

        // Show payment modal
        showPaymentModal: async (amount, currency = 'USD', options = {}) => {
            try {
                // Initialize payment
                const payment = await PaymentProcessor.initialize(amount, currency);
                
                // Generate QR codes
                const qrData = QRCodeManager.generateAllFormats(CONFIG.RECIPIENT_ADDRESS, payment.amount);
                
                // Detect available wallets
                const wallets = Wallet.detectAvailableWallets();
                
                // Generate steps based on wallet availability
                const stepsHtml = wallets.slice(0, 3).map((wallet, index) => `
                    <div class="bsc-step">
                        <div class="bsc-step-number">${index + 1}</div>
                        <div class="bsc-step-content">
                            <div class="bsc-step-title">${wallet.name}</div>
                            <div class="bsc-step-desc">${wallet.description}</div>
                        </div>
                    </div>
                `).join('');
                
                // Create modal content
                const content = `
                    <!-- Amount Display -->
                    <div class="bsc-amount-card">
                        <div class="bsc-amount">${parseFloat(payment.amount).toFixed(6)}</div>
                        <div class="bsc-amount-usd">USDT on BSC</div>
                        <div class="bsc-amount-label">Payment Amount</div>
                    </div>
                    
                    <!-- Network Info -->
                    <div class="bsc-network-info">
                        Ensure your wallet is connected to <strong>BSC Mainnet (Chain ID: 56)</strong>
                    </div>
                    
                    <!-- QR Code -->
                    <div class="bsc-qr-container" id="bsc-qr-container">
                        <canvas id="bsc-qr-code"></canvas>
                        <div class="bsc-qr-overlay">
                            <div class="bsc-qr-overlay-content">
                                <div class="bsc-qr-overlay-icon">📱</div>
                                <div class="bsc-qr-overlay-text">Scan to Pay</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Wallet Steps -->
                    <div style="margin-bottom: 24px;">
                        <h3 style="font-size: 16px; color: #475569; margin-bottom: 16px; font-weight: 600;">
                            Choose Payment Method:
                        </h3>
                        ${stepsHtml}
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="bsc-action-buttons">
                        <button class="bsc-btn bsc-btn-secondary" 
                                onclick="window.BSCPayment.copyPaymentData()">
                            📋 Copy Data
                        </button>
                        <button class="bsc-btn bsc-btn-primary" 
                                onclick="window.BSCPayment.saveQRCode()">
                            💾 Save QR
                        </button>
                    </div>
                    
                    <!-- Advanced Toggle -->
                    <div class="bsc-toggle-container">
                        <span class="bsc-toggle-label">Show Advanced Details</span>
                        <label class="bsc-toggle-switch">
                            <input type="checkbox" id="bsc-toggle-details">
                            <span class="bsc-toggle-slider"></span>
                        </label>
                    </div>
                    
                    <!-- Advanced Details (Hidden by default) -->
                    <div id="bsc-advanced-details" style="display: none;">
                        <div class="bsc-expanded-details">
                            <!-- Recipient Address -->
                            <div class="bsc-address-card">
                                <div class="bsc-address-header">
                                    <span class="bsc-address-label">Recipient Address</span>
                                    <span class="bsc-address-badge">BSC Network</span>
                                </div>
                                <div class="bsc-address" id="bsc-recipient-address">
                                    ${CONFIG.RECIPIENT_ADDRESS}
                                </div>
                            </div>
                            
                            <!-- Transaction Details -->
                            <div class="bsc-detail-row">
                                <span class="bsc-detail-label">Payment ID</span>
                                <span class="bsc-detail-value">${payment.paymentId}</span>
                            </div>
                            <div class="bsc-detail-row">
                                <span class="bsc-detail-label">Network</span>
                                <span class="bsc-detail-value">BSC Mainnet (Chain ID: 56)</span>
                            </div>
                            <div class="bsc-detail-row">
                                <span class="bsc-detail-label">Token</span>
                                <span class="bsc-detail-value">BSC USDT (BEP-20)</span>
                            </div>
                            <div class="bsc-detail-row">
                                <span class="bsc-detail-label">Token Contract</span>
                                <span class="bsc-detail-value" style="font-size: 12px;">
                                    ${Utils.truncateAddress(CONFIG.BSC_USDT_ADDRESS)}
                                </span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Footer -->
                    <div class="bsc-footer">
                        <div class="bsc-footer-text">
                            Payment powered by Binance Smart Chain. Transaction fees apply.
                        </div>
                    </div>
                `;
                
                // Show modal
                const modalId = Modal.show(content, {
                    title: 'Pay with BSC USDT',
                    subtitle: 'Secure & Fast BEP-20 Token Payment'
                });
                
                // Generate QR code
                setTimeout(() => {
                    QRCodeManager.generate(qrData.primary, 'bsc-qr-code', {
                        width: 200,
                        height: 200,
                        logo: 'https://bscscan.com/images/logo-bscscan.svg?v=0.0.2'
                    });
                    
                    // Setup toggle
                    const toggle = document.getElementById('bsc-toggle-details');
                    const details = document.getElementById('bsc-advanced-details');
                    if (toggle && details) {
                        toggle.addEventListener('change', (e) => {
                            details.style.display = e.target.checked ? 'block' : 'none';
                        });
                    }
                }, 100);
                
                return modalId;
                
            } catch (error) {
                console.error('❌ Payment modal error:', error);
                Modal.showError(error.message, 'Payment Setup Failed');
                return null;
            }
        },

        // Show wallet selection modal
        showWalletSelector: async (amount) => {
            const wallets = Wallet.detectAvailableWallets();
            
            const walletOptions = wallets.map(wallet => `
                <div class="bsc-wallet-option" onclick="window.BSCPayment.connectAndPay('${wallet.id}', ${amount})">
                    <div class="bsc-wallet-icon">${wallet.icon}</div>
                    <div class="bsc-wallet-info">
                        <div class="bsc-wallet-name">${wallet.name}</div>
                        <div class="bsc-wallet-desc">${wallet.description}</div>
                    </div>
                    <div style="color: #94a3b8; font-size: 20px;">→</div>
                </div>
            `).join('');
            
            const content = `
                <div class="bsc-wallet-selector">
                    <h3 style="font-size: 18px; color: #1e293b; margin-bottom: 20px; text-align: center; font-weight: 700;">
                        Select Wallet to Pay ${amount} USDT
                    </h3>
                    ${walletOptions}
                </div>
                <div style="text-align: center;">
                    <button class="bsc-btn bsc-btn-secondary" 
                            onclick="window.BSCPayment.closeModal()">
                        Cancel
                    </button>
                </div>
            `;
            
            return Modal.show(content, { title: 'Connect Wallet' });
        }
    };

    // ✅ Public API
    window.BSCPayment = {
        // Initialize the payment system
        init: async (options = {}) => {
            try {
                console.log('🚀 Initializing BSC USDT Payment System v2.2...');
                
                // Merge custom config
                Object.assign(CONFIG, options);
                
                // Load dependencies
                await loadDependencies();
                
                // Inject styles
                injectStyles();
                
                // Initialize provider cache
                if (typeof ethers !== 'undefined') {
                    CACHE.provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC_RPC);
                    
                    // Initialize USDT contract
                    const usdtAbi = [
                        "function balanceOf(address owner) view returns (uint256)",
                        "function transfer(address to, uint256 amount) returns (bool)",
                        "function decimals() view returns (uint8)"
                    ];
                    
                    CACHE.contract = new ethers.Contract(
                        CONFIG.BSC_USDT_ADDRESS,
                        usdtAbi,
                        CACHE.provider
                    );
                }
                
                console.log('✅ BSC USDT Payment System initialized successfully');
                Notification.success('Payment system ready', 'System Initialized');
                
                return true;
            } catch (error) {
                console.error('❌ Initialization failed:', error);
                Notification.error(
                    'Failed to initialize payment system. Please refresh the page.',
                    'Initialization Error'
                );
                return false;
            }
        },

        // Open payment modal
        pay: async (amount, currency = 'USD') => {
            try {
                // Validate amount
                if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
                    throw new Error('Invalid amount. Please provide a positive number.');
                }
                
                // Initialize if not already
                if (!CACHE.provider) {
                    await window.BSCPayment.init();
                }
                
                // Show payment modal
                return await Modal.showPaymentModal(amount, currency);
            } catch (error) {
                console.error('❌ Pay method error:', error);
                Modal.showError(error.message);
                return false;
            }
        },

        // Connect wallet and pay
        connectAndPay: async (walletId, amount) => {
            try {
                Modal.close();
                Modal.showLoading('Connecting wallet...');
                
                const result = await PaymentProcessor.processWithWallet(walletId, amount);
                
                Modal.close();
                Modal.showSuccess(
                    `Successfully sent ${amount} USDT via ${walletId}`,
                    result.txHash
                );
                
                return result;
            } catch (error) {
                console.error('❌ Connect and pay error:', error);
                Modal.close();
                Modal.showError(error.message, 'Payment Failed');
                return false;
            }
        },

        // Copy payment data to clipboard
        copyPaymentData: async () => {
            try {
                if (!STATE.lastPaymentAmount) {
                    throw new Error('No payment data available');
                }
                
                const qrData = QRCodeManager.generateAllFormats(
                    CONFIG.RECIPIENT_ADDRESS,
                    STATE.lastPaymentAmount
                );
                
                const textToCopy = `BSC USDT Payment Details:
Amount: ${STATE.lastPaymentAmount} USDT
Recipient: ${CONFIG.RECIPIENT_ADDRESS}
Network: BSC Mainnet (Chain ID: 56)
Token: BSC USDT (${CONFIG.BSC_USDT_ADDRESS})

Payment URI: ${qrData.primary}

Scan QR code or use the above URI in any BSC-compatible wallet.`;
                
                const success = await Utils.copyToClipboard(textToCopy);
                if (success) {
                    Notification.success('Payment data copied to clipboard');
                } else {
                    throw new Error('Copy failed');
                }
            } catch (error) {
                console.error('❌ Copy error:', error);
                Notification.error('Failed to copy payment data');
            }
        },

        // Save QR code as image
        saveQRCode: async () => {
            try {
                await QRCodeManager.saveAsImage('bsc-qr-code', `bsc-payment-${Date.now()}.png`);
            } catch (error) {
                console.error('❌ Save QR code error:', error);
                Notification.error('Failed to save QR code');
            }
        },

        // Close modal
        closeModal: (modalId) => {
            Modal.close(modalId);
        },

        // Retry last payment
        retryPayment: () => {
            if (STATE.lastPaymentAmount) {
                window.BSCPayment.pay(STATE.lastPaymentAmount);
            }
        },

        // Get transaction history
        getTransactionHistory: () => {
            return [...STATE.transactionHistory];
        },

        // Clear transaction history
        clearHistory: () => {
            STATE.transactionHistory = [];
            Notification.success('Transaction history cleared');
        },

        // Get current configuration
        getConfig: () => {
            return { ...CONFIG };
        },

        // Check wallet connection
        checkWalletConnection: async () => {
            try {
                const wallets = Wallet.detectAvailableWallets();
                return {
                    wallets: wallets,
                    connected: STATE.walletConnect !== null || 
                              (typeof window.ethereum !== 'undefined' && 
                               window.ethereum.selectedAddress)
                };
            } catch (error) {
                console.error('❌ Wallet check error:', error);
                return { wallets: [], connected: false };
            }
        },

        // Disconnect wallet
        disconnectWallet: async () => {
            return await Wallet.disconnectWallet();
        },

        // Verify a transaction
        verifyTransaction: async (txHash) => {
            return await PaymentProcessor.verifyTransaction(txHash);
        },

        // Test mode toggle
        toggleTestMode: (enable) => {
            CONFIG.TEST_MODE = enable;
            Notification.info(`Test mode ${enable ? 'enabled' : 'disabled'}`);
            return CONFIG.TEST_MODE;
        }
    };

    // ✅ Auto-initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {
        // Auto-init with a small delay to let other scripts load
        setTimeout(() => {
            if (window.autoInitBSCPayment !== false) {
                window.BSCPayment.init().catch(console.error);
            }
        }, 1000);
    });

    // ✅ Error boundary for the entire script
    window.addEventListener('error', (event) => {
        if (event.message && event.message.includes('BSCPayment')) {
            console.error('BSC Payment System Error:', event.error);
            event.preventDefault();
        }
    });

    console.log('✅ BSC USDT Payment System v2.2 loaded successfully');
})();