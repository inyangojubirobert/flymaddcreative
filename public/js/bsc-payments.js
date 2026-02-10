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
        DECIMALS: 18,  // Fixed: USDT on BSC has 18 decimals
        // Enhanced config
        MAX_RETRIES: 3,
        RETRY_DELAY: 1000,
        GAS_BUFFER: 20, // 20% buffer
        CONFIRMATION_TIMEOUT: 60000, // 60 seconds
        TEST_MODE: false,
        DEFAULT_CURRENCY: 'USD',
        // WalletConnect Project ID (Get one from https://cloud.walletconnect.com/)
        WALLETCONNECT_PROJECT_ID: "YOUR_WALLETCONNECT_PROJECT_ID", // REPLACE WITH YOUR ACTUAL ID
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
            if (window.ethers && window.ethers.utils) {
                try {
                    return window.ethers.utils.isAddress(address);
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
                return amount.toString();
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
            const message = error.message ? error.message.toLowerCase() : '';
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
                        
                        if (CACHE.provider && typeof CACHE.provider.getTransactionReceipt === 'function') {
                            const receipt = await CACHE.provider.getTransactionReceipt(txHash);
                            if (receipt) {
                                clearInterval(checkInterval);
                                resolve(receipt);
                            }
                        } else if (window.ethereum) {
                            // Fallback to window.ethereum
                            try {
                                const receipt = await window.ethereum.request({
                                    method: 'eth_getTransactionReceipt',
                                    params: [txHash]
                                });
                                if (receipt) {
                                    clearInterval(checkInterval);
                                    resolve(receipt);
                                }
                            } catch (e) {
                                // Continue polling
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
                if (typeof window.WalletConnect !== 'undefined') {
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
            // Calculate amount in wei (USDT has 18 decimals on BSC)
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
                gas: '0x186a0', // Default gas limit (100,000)
                gasPrice: '0x3b9aca00' // Default gas price (1 gwei)
            };
        },
        
        // Generate multiple URI formats for wallet compatibility
        generatePaymentURIs: (recipient, amount) => {
            const amountWei = BigInt(Math.floor(parseFloat(amount) * 1e18)).toString();
            
            // Format 1: EIP-681 for token transfer (MetaMask, some wallets)
            const eip681Token = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
            
            // Format 2: Simple address with chain
            const simpleAddress = recipient;
            
            // Format 3: BNB Chain specific format
            const bnbFormat = `bnb:${recipient}?amount=${amount}&token=${CONFIG.BSC_USDT_ADDRESS}`;
            
            // Format 4: WalletConnect compatible deep link
            const wcFormat = `wc:${recipient}@${CONFIG.BSC_CHAIN_ID}?asset=USDT&amount=${amount}`;
            
            return {
                eip681Token,
                simpleAddress,
                bnbFormat,
                wcFormat,
                primary: eip681Token
            };
        },
        
        // Safe parse float with validation
        safeParseFloat: (value) => {
            if (typeof value === 'number') return value;
            const num = parseFloat(value);
            if (isNaN(num)) throw new Error('Invalid number format');
            return num;
        }
    };

    // ✅ Load dependencies with enhanced error handling
    function loadDependencies() {
        return new Promise((resolve, reject) => {
            const dependencies = [];
            let loadedCount = 0;
            const totalDependencies = 2;

            // Check and load ethers.js
            if (typeof window.ethers === 'undefined') {
                dependencies.push({
                    name: 'ethers',
                    src: 'https://cdn.ethers.io/lib/ethers-5.7.umd.min.js',
                    integrity: 'sha256-4wOIQK5lBhxUMWqK8WwFz93qUcQlqBTnYhMlN5u9l0k=',
                    crossorigin: 'anonymous'
                });
            } else {
                loadedCount++;
                CACHE.ethers = window.ethers;
            }

            // Check and load QRCode.js
            if (typeof window.QRCode === 'undefined') {
                dependencies.push({
                    name: 'qrcode',
                    src: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
                    integrity: 'sha256-lMjpG2mYxHKgj9yZvjRPe6S/5qnrD9XZLMNuhPcUj8w=',
                    crossorigin: 'anonymous'
                });
            } else {
                loadedCount++;
                window.QRCode = window.QRCode || window.qrcode;
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
            /* Your CSS styles here - same as original */
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
            
            /* ... rest of the CSS styles ... */
            
            /* Add missing alert styles */
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
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1);
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

    // ✅ Enhanced alert system
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
        
        alert.style.cssText = `
            position: fixed;
            ${positionStyle}
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
            border: 1px solid rgba(255,255,255,0.1);
        `;
        
        alert.innerHTML = `
            <span style="font-size: 18px;">${color.icon}</span>
            <span style="flex: 1;">${message}</span>
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

    // ✅ Create modal function
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

    // ✅ Enhanced QR code generation with BSC USDT support
    function generateBSCQR(recipient, amount, element) {
        console.log('[BSC QR] Generating BSC USDT QR code:', {
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
        
        // Calculate amount in wei (USDT has 18 decimals on BSC)
        let amountWei;
        try {
            const amountFloat = parseFloat(amount);
            amountWei = BigInt(Math.floor(amountFloat * 1e18)).toString();
        } catch (e) {
            console.warn('[BSC QR] Amount conversion error');
            amountWei = '0';
        }
        
        // EIP-681 URI format for BSC USDT transfer
        const eip681URI = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@${CONFIG.BSC_CHAIN_ID}/transfer?address=${recipient}&uint256=${amountWei}`;
        
        console.log('[BSC QR] Generated EIP-681 URI:', eip681URI);
        
        // Create wrapper for QR code with info
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 100%;';
        
        // Create canvas for QR code
        const canvas = document.createElement('canvas');
        canvas.className = 'bsc-qr-canvas';
        canvas.setAttribute('role', 'button');
        canvas.setAttribute('tabindex', '0');
        canvas.setAttribute('aria-label', `Scan to send ${amount} USDT on BSC to ${Utils.truncateAddress(recipient)}`);
        canvas.title = `Click to copy BSC USDT payment details`;
        
        wrapper.appendChild(canvas);
        
        // Add network badge below QR
        const badge = document.createElement('div');
        badge.style.cssText = 'margin-top: 12px; padding: 6px 12px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
        badge.textContent = `${amount} USDT • BSC Network`;
        wrapper.appendChild(badge);
        
        element.appendChild(wrapper);
        
        // Try QRCode.js library first
        if (window.QRCode && window.QRCode.toCanvas) {
            window.QRCode.toCanvas(canvas, eip681URI, {
                width: 180,
                margin: 2,
                color: { 
                    dark: '#000000', 
                    light: '#FFFFFF'
                },
                errorCorrectionLevel: 'M'
            }, function(error) {
                if (error) {
                    console.warn('[BSC QR] QRCode.js failed:', error);
                    showImageBasedQR(element, eip681URI, recipient, amount);
                } else {
                    console.log('[BSC QR] BSC USDT QR code generated successfully');
                    
                    // Add click handler to copy details
                    const clickHandler = () => copyBSCPaymentDetails(recipient, amount, eip681URI);
                    canvas.onclick = clickHandler;
                    canvas.onkeydown = (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            clickHandler();
                        }
                    };
                }
            });
        } else {
            console.log('[BSC QR] QRCode.js not available, using image API');
            showImageBasedQR(element, eip681URI, recipient, amount);
        }
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
            
            // Show payment modal (simplified for example)
            showAlert(`Ready to process ${amount} USDT payment on BSC`, 'info', 3000);
            
            // Here you would show the actual payment modal
            // For now, return a simple response
            return {
                success: true,
                message: `Ready to process ${amount} USDT payment on BSC`,
                paymentId: Utils.generateId(),
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('Payment initiation error:', error);
            showAlert(`USDT payment failed: ${error.message}`, 'error', 5000, 'top-right');
            
            return {
                success: false,
                error: error.message,
                type: ERROR_TYPES.TRANSACTION
            };
        } finally {
            STATE.isProcessing = false;
        }
    }

    // ✅ Initialize and expose to global scope
    function initialize() {
        // Inject styles
        injectStyles();
        
        // Expose functions to window
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
                showAlert('Recipient address updated successfully', 'success', 3000);
                return true;
            },
            
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
            generateUSDTTransaction: Utils.generateUSDTTransactionData,
            
            // Simple state
            isReady: true,
            version: '2.2.0'
        };
        
        // Mark as ready
        window.BSCPaymentsReady = true;
        
        // Log initialization
        console.log('🚀 BSC USDT Payment System v2.2 Ready');
        console.log('📋 Available methods:', Object.keys(window.BSCPayments).join(', '));
    }

    // ✅ Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        setTimeout(initialize, 100);
    }

})();