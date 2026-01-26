// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

// Check if we're in a browser environment
if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// Public configuration (safe to expose)
const PUBLIC_CONFIG = {
    NETWORKS: {
        BSC: {
            USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
            EXPLORER: "https://bscscan.com/tx/",
            CHAIN_ID: 56,
            SYMBOL: "BSC"
        },
        TRON: {
            USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            EXPLORER: "https://tronscan.org/#/transaction/",
            SYMBOL: "TRON"
        }
    },
    UI: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000
    }
};

// Error codes
const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    TIMEOUT: 'TIMEOUT',
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    INITIALIZATION_ERROR: 'INITIALIZATION_ERROR',
    DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// Track payment attempts
const paymentAttempts = new Map();

// ======================================================
// 🛡️  ERROR HANDLING CLASS
// ======================================================

class PaymentError extends Error {
    constructor(message, code, metadata = {}) {
        super(message);
        this.name = 'PaymentError';
        this.code = code;
        this.metadata = metadata;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PaymentError);
        }
    }
}

// ======================================================
// 🔌  UTILITY FUNCTIONS
// ======================================================

function validateInputs(participantId, voteCount) {
    if (!participantId || typeof participantId !== 'string') {
        throw new PaymentError('Invalid participant ID', ERROR_CODES.INVALID_INPUT);
    }
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) {
        throw new PaymentError('Invalid vote count', ERROR_CODES.INVALID_INPUT);
    }
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = paymentAttempts.get(participantId) || [];
    const recentAttempts = attempts.filter(t => now - t < PUBLIC_CONFIG.UI.TIMEOUT_MS);
    
    if (recentAttempts.length >= PUBLIC_CONFIG.UI.MAX_RETRIES) {
        throw new PaymentError(
            'Too many payment attempts. Please try again later.',
            ERROR_CODES.RATE_LIMIT,
            { attempts: recentAttempts.length }
        );
    }
    
    paymentAttempts.set(participantId, [...recentAttempts, now]);
}

function trackEvent(name, metadata = {}) {
    try {
        if (window.analytics) {
            window.analytics.track(name, metadata);
        }
        console.log(`[Analytics] ${name}`, metadata);
    } catch (e) {
        console.error('Tracking error:', e);
    }
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            const tronNetwork = await window.tronWeb.trx.getNodeInfo();
            if (tronNetwork && tronNetwork.net) return 'TRON';
        }
        
        if (window.ethereum) {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            if (chainId === '0x38') return 'BSC';
        }
    } catch (error) {
        console.warn('Network detection error:', error);
    }
    return null;
}

async function loadWalletConnect() {
    try {
        if (window.EthereumProvider) return window.EthereumProvider;
        
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
            script.onload = () => {
                if (!window.EthereumProvider) {
                    reject(new PaymentError('WalletConnect not properly loaded', ERROR_CODES.PROVIDER_ERROR));
                    return;
                }
                console.log('✅ WalletConnect SDK loaded');
                resolve(window.EthereumProvider);
            };
            script.onerror = () => {
                reject(new PaymentError('Failed to load WalletConnect', ERROR_CODES.PROVIDER_ERROR));
            };
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error('WalletConnect loading error:', error);
        throw error;
    }
}

async function connectWalletMobile() {
    try {
        const wcProvider = await loadWalletConnect();
        const provider = await window.EthereumProvider.init({
            projectId: "default_project_id",
            chains: [PUBLIC_CONFIG.NETWORKS.BSC.CHAIN_ID],
            showQrModal: true,
            qrModalOptions: { themeMode: 'dark' },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment",
                url: window.location.origin,
                icons: ["https://yoursite.com/icon.png"]
            }
        });
        await provider.connect();
        return provider;
    } catch (error) {
        throw new PaymentError(
            'Failed to connect via WalletConnect',
            ERROR_CODES.WALLET_ERROR,
            { originalError: error }
        );
    }
}

// ======================================================
// 🧩  UI COMPONENTS
// ======================================================

function createModal(content, className = '') {
    const modal = document.createElement('div');
    modal.className = `fixed inset-0 bg-black/80 flex items-center justify-center z-50 ${className}`;
    modal.innerHTML = content;
    document.body.appendChild(modal);
    return modal;
}

function showPaymentStatusModal(network, amount) {
    return createModal(`
        <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-lg">${network} Payment</h3>
                <span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'BSC' ? 'BEP-20' : 'TRC-20'}</span>
            </div>
            <div class="text-2xl font-bold mb-4">${amount} USDT</div>
            <div id="statusText" class="min-h-6 mb-4">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden">
                <a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500">View on explorer</a>
            </div>
            <button id="closeModal" class="mt-4 text-gray-500 text-sm">Close</button>
        </div>
    `);
}

async function showWalletConnectQR(network, amount, recipient) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80">
                <h3 class="font-bold mb-3">${network} USDT Payment</h3>
                <p class="text-sm mb-4">Scan with your crypto wallet</p>
                <div id="wcQR" class="mx-auto mb-4"></div>
                <p class="text-sm text-gray-500">Or connect manually if your wallet supports it</p>
                <button id="connectWallet" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
                    Connect Wallet
                </button>
                <button id="closeModal" class="mt-2 text-gray-500 text-sm">Cancel</button>
            </div>
        `);

        // Initialize WalletConnect
        loadWalletConnect().then(async () => {
            const provider = await window.EthereumProvider.init({
                projectId: "default_project_id",
                chains: [PUBLIC_CONFIG.NETWORKS.BSC.CHAIN_ID],
                showQrModal: true,
                qrModalOptions: { themeMode: 'dark' }
            });

            provider.on('display_uri', (uri) => {
                modal.querySelector('#wcQR').innerHTML = `
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(uri)}" 
                         alt="WalletConnect QR Code" 
                         class="mx-auto" />
                `;
            });

            modal.querySelector('#connectWallet').onclick = async () => {
                try {
                    await provider.connect();
                    resolve(provider);
                    modal.remove();
                } catch (error) {
                    console.error('Connection error:', error);
                }
            };
        });

        modal.querySelector('#closeModal').onclick = () => {
            modal.remove();
            resolve(null);
        };
    });
}

// ======================================================
// 🚀  PAYMENT PROCESSING FUNCTIONS
// ======================================================

async function processBSCPayment(init) {
    try {
        console.debug('[BSC Payment] Starting BSC payment process');
        
        let provider;
        if (isMobileDevice() || !window.ethereum) {
            console.debug('[BSC Payment] Using WalletConnect');
            provider = await showWalletConnectQR('BSC', init.amount, init.recipient_address);
            if (!provider) {
                return { success: false, cancelled: true };
            }
            provider = new ethers.providers.Web3Provider(provider);
        } else {
            console.debug('[BSC Payment] Using window.ethereum provider');
            provider = new ethers.providers.Web3Provider(window.ethereum);
            await ensureBSCNetwork(provider);
        }
        
        const signer = provider.getSigner();
        return await executeBSCTransfer(signer, init.recipient_address, init.amount);
    } catch (error) {
        console.error('[BSC Payment] Error:', error);
        throw new PaymentError(
            error.message || 'BSC payment processing failed',
            error.code || ERROR_CODES.TRANSACTION_ERROR,
            { 
                originalError: error,
                stage: 'bsc-payment',
                providerAvailable: !!window.ethereum,
                isMobile: isMobileDevice()
            }
        );
    }
}

// ======================================================
// 🎯  MAIN PAYMENT FUNCTION
// ======================================================

async function processCryptoPayment() {
    try {
        console.debug('[Payment] Starting process with participant:', window.currentParticipant?.id);
        
        const participantId = window.currentParticipant?.id;
        const voteCount = window.selectedVoteAmount;

        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);

        console.debug('[Payment] Detecting preferred network...');
        const preferredNetwork = await detectPreferredNetwork();
        console.debug('[Payment] Showing network selection modal...');
        const network = await showNetworkSelectionModal(preferredNetwork);
        
        if (!network) {
            console.debug('[Payment] User cancelled network selection');
            trackEvent('payment_cancelled', { stage: 'network_selection' });
            return { success: false, cancelled: true };
        }

        console.debug('[Payment] Initializing payment for network:', network);
        const init = await initializeCryptoPayment(participantId, voteCount, network);
        const modal = showPaymentStatusModal(network, init.amount);

        try {
            let result;
            if (network === 'BSC') {
                console.debug('[Payment] Processing BSC payment...');
                updateStatus(modal, 'Processing BSC payment...');
                result = await processBSCPayment(init);
            } else if (network === 'TRON') {
                console.debug('[Payment] Processing TRON payment...');
                updateStatus(modal, 'Processing TRON payment...');
                result = await processTronPayment(init);
            } else {
                throw new PaymentError('Unsupported network', ERROR_CODES.NETWORK_ERROR, { network });
            }

            if (result.success !== false) {
                console.debug('[Payment] Payment successful, finalizing...');
                successStatus(modal, result.txHash, result.explorerUrl);
                trackEvent('payment_success', { network, amount: init.amount });
                return await finalizePayment(result.txHash, network);
            }

            return result;
        } catch (error) {
            console.error('[Payment] Inner payment error:', error);
            errorStatus(modal, error);
            throw new PaymentError(
                error.message || 'Payment processing failed',
                error.code || ERROR_CODES.TRANSACTION_ERROR,
                { 
                    originalError: error,
                    network,
                    stage: 'payment-processing'
                }
            );
        }
    } catch (error) {
        console.error('❌ Crypto Payment Error:', error);
        trackEvent('payment_failed', {
            error: error.message || 'Unknown error',
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            stack: error.stack,
            ...(error.metadata || {})
        });

        return {
            success: false,
            error: error.message || 'Payment failed',
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            cancelled: error.code === 4001,
            details: error.metadata
        };
    }
}

// ======================================================
// 🏁  INITIALIZATION & EXPORT
// ======================================================

async function initializePaymentSystem() {
    try {
        await loadDependencies();
        
        if (typeof ethers === 'undefined' || !ethers.providers) {
            throw new PaymentError(
                'Ethers.js not properly loaded',
                ERROR_CODES.DEPENDENCY_ERROR
            );
        }

        window.processCryptoPayment = processCryptoPayment;
        console.log('🔒 Crypto Payments Module Ready');
    } catch (error) {
        console.error('Initialization failed:', error);
        window.processCryptoPayment = () => Promise.resolve({
            success: false,
            error: 'Payment system initialization failed',
            code: ERROR_CODES.INITIALIZATION_ERROR,
            details: { error: error.message }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePaymentSystem);
} else {
    initializePaymentSystem();
}