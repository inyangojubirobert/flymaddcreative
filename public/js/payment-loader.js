// ======================================================
// 🔌 PAYMENT LOADER - Central loader for all payment modules
// ======================================================

(function() {
    console.log('🔌 Payment loader initializing...');
    
    // Track loading status
    window.PAYMENT_MODULES = {
        bsc: false,
        crypto: false,
        allLoaded: false
    };
    
    // Function to check if all modules are loaded
    function checkAllLoaded() {
        if (window.PAYMENT_MODULES.bsc && window.PAYMENT_MODULES.crypto) {
            window.PAYMENT_MODULES.allLoaded = true;
            console.log('✅ All payment modules loaded successfully');
            
            // Dispatch event for vote.js to listen to
            document.dispatchEvent(new CustomEvent('paymentModulesReady'));
        }
    }
    
    // Monitor BSC module
    Object.defineProperty(window, 'BSCPayments', {
        set: function(value) {
            window._bscPayments = value;
            window.PAYMENT_MODULES.bsc = true;
            console.log('✅ BSC Payments module detected');
            checkAllLoaded();
        },
        get: function() {
            return window._bscPayments;
        },
        configurable: true
    });
    
    // Monitor Crypto module
    Object.defineProperty(window, 'CryptoPayments', {
        set: function(value) {
            window._cryptoPayments = value;
            window.PAYMENT_MODULES.crypto = true;
            console.log('✅ Crypto Payments module detected');
            checkAllLoaded();
        },
        get: function() {
            return window._cryptoPayments;
        },
        configurable: true
    });
    
    // Fallback: Check every 500ms for 10 seconds
    let attempts = 0;
    const interval = setInterval(function() {
        attempts++;
        
        if (window.BSCPayments) {
            window.PAYMENT_MODULES.bsc = true;
        }
        
        if (window.CryptoPayments) {
            window.PAYMENT_MODULES.crypto = true;
        }
        
        if (window.PAYMENT_MODULES.bsc && window.PAYMENT_MODULES.crypto) {
            clearInterval(interval);
            window.PAYMENT_MODULES.allLoaded = true;
            document.dispatchEvent(new CustomEvent('paymentModulesReady'));
            console.log('✅ Payment modules ready (polling)');
        } else if (attempts > 20) {
            clearInterval(interval);
            console.warn('⚠️ Payment modules not fully loaded after 10 seconds');
            // Still dispatch event to prevent infinite waiting
            document.dispatchEvent(new CustomEvent('paymentModulesReady'));
        }
    }, 500);
    
    // Create unified payment interface
    window.unifiedPayment = {
        // BSC payments
        payBSC: function(amount, options) {
            if (window.BSCPayments) {
                return window.BSCPayments.pay(amount, options);
            } else {
                console.error('BSC Payments not available');
                return Promise.reject(new Error('BSC Payments not available'));
            }
        },
        
        // Crypto payments (TRON + Mobile)
        payCrypto: function(amount, options) {
            if (window.CryptoPayments) {
                return window.CryptoPayments.pay(amount, options);
            } else {
                console.error('Crypto Payments not available');
                return Promise.reject(new Error('Crypto Payments not available'));
            }
        },
        
        // Auto-detect and use appropriate method
        pay: function(amount, options = {}) {
            const network = options.network || 'auto';
            
            if (network === 'BSC') {
                return this.payBSC(amount, options);
            } else if (network === 'TRON' || network === 'crypto') {
                return this.payCrypto(amount, options);
            } else {
                // Auto-detect based on device
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
                
                if (isMobile) {
                    // Mobile devices use crypto-payments (combined)
                    return this.payCrypto(amount, options);
                } else {
                    // Desktop - let user choose or use BSC
                    return this.payBSC(amount, options);
                }
            }
        },
        
        // Check if ready
        isReady: function() {
            return window.PAYMENT_MODULES.allLoaded;
        }
    };
    
    console.log('🔌 Payment loader ready');
})();