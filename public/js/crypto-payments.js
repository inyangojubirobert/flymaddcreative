// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// ✅ Inject required CSS for loading spinner
(function injectStyles() {
    if (document.getElementById('crypto-payments-styles')) return;
    const style = document.createElement('style');
    style.id = 'crypto-payments-styles';
    style.textContent = `
        .loading-spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: crypto-spin 0.8s linear infinite; }
        @keyframes crypto-spin { to { transform: rotate(360deg); } }
        .crypto-modal-fade-in { animation: crypto-fade-in 0.2s ease-out; }
        @keyframes crypto-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    `;
    document.head.appendChild(style);
})();

const scriptTag = document.currentScript || document.querySelector('script[src*="crypto-payments"]');

const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        RPC_URL: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: 56,
        EXPLORER: "https://bscscan.com/tx/",
        WALLET_ADDRESS: scriptTag?.dataset?.bscWallet || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/",
        WALLET_ADDRESS: scriptTag?.dataset?.tronWallet || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: scriptTag?.dataset?.wcProjectId || "61d9b98f81731dffa9988c0422676fc5"
    },
    ETHERS: {
        SRC: "https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"
    },
    PAYSTACK: {
        PUBLIC_KEY: scriptTag?.dataset?.paystackKey || window.PAYSTACK_PUBLIC_KEY || "",
        SRC: "https://js.paystack.co/v1/inline.js"
    },
    LIMITS: { MAX_RETRIES: 5, TIMEOUT_MS: 300000, ATTEMPT_TIMEOUT: 5 * 60 * 1000 }
};

const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT', RATE_LIMIT: 'RATE_LIMIT', NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR', TRANSACTION_ERROR: 'TRANSACTION_ERROR', TIMEOUT: 'TIMEOUT',
    PROVIDER_ERROR: 'PROVIDER_ERROR', INITIALIZATION_ERROR: 'INITIALIZATION_ERROR',
    DEPENDENCY_ERROR: 'DEPENDENCY_ERROR', UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

// ======================================================
// 🔄  INITIALIZATION STATE
// ======================================================

let isInitialized = false;
let initializationPromise = null;
let walletConnectLoaded = false;
let walletConnectPromise = null;
let walletConnectProvider = null;
let tronLinkInitialized = false;
let resolveReady, rejectReady;
const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

// Helper to find EthereumProvider from various possible locations
function getEthereumProviderClass() {
    // Check all possible locations where the UMD bundle might export
    const locations = [
        window.EthereumProvider,
        window.WalletConnectEthereumProvider,
        window['@walletconnect/ethereum-provider']?.EthereumProvider,
        window['@walletconnect/ethereum-provider'],
        window.WalletConnect?.EthereumProvider,
    ];
    
    for (const provider of locations) {
        if (provider && typeof provider.init === 'function') {
            return provider;
        }
    }
    
    // Search window object for any provider with init method
    for (const key of Object.keys(window)) {
        if (key.toLowerCase().includes('ethereum') || key.toLowerCase().includes('walletconnect')) {
            const val = window[key];
            if (val && typeof val.init === 'function') {
                console.log(`[WalletConnect] Found provider at window.${key}`);
                return val;
            }
        }
    }
    
    return null;
}

// ======================================================
// 🔷 TRONLINK INITIALIZATION
// ======================================================

/**
 * Initialize TronLink connection early as recommended by TronLink
 * This ensures TronWeb is fully injected before we need to use it
 */
async function initTronLink() {
    if (tronLinkInitialized) return window.tronWeb?.ready || false;
    
    try {
        // Check if TronLink extension is available
        if (typeof window.tronLink !== 'undefined') {
            console.log('[TronLink] Extension detected, requesting accounts...');
            
            // Request account access as recommended by TronLink
            const result = await window.tronLink.request({ method: 'tron_requestAccounts' });
            
            if (result.code === 200) {
                console.log('✅ TronLink connected successfully');
                tronLinkInitialized = true;
                
                // Verify TronWeb is ready
                if (window.tronWeb?.ready) {
                    const address = window.tronWeb.defaultAddress?.base58;
                    console.log('[TronLink] Connected address:', address);
                    return true;
                }
            } else if (result.code === 4000) {
                console.log('[TronLink] User has not unlocked wallet');
                return false;
            } else if (result.code === 4001) {
                console.log('[TronLink] User rejected the connection');
                return false;
            } else {
                console.warn('[TronLink] Unexpected response:', result);
            }
        } else if (window.tronWeb?.ready) {
            // TronWeb already injected (older TronLink version)
            console.log('✅ TronWeb already available');
            tronLinkInitialized = true;
            return true;
        } else {
            console.log('[TronLink] Extension not detected');
        }
    } catch (error) {
        console.warn('[TronLink] Initialization error:', error.message);
    }
    
    return false;
}

/**
 * Check if TronLink is available and connected
 */
function isTronLinkReady() {
    return window.tronWeb?.ready && window.tronWeb?.defaultAddress?.base58;
}

/**
 * Connect to TronLink (for payment flow)
 */
async function connectTronLink() {
    // First try standard initialization
    if (!tronLinkInitialized) {
        await initTronLink();
    }
    
    // Check if ready after initialization
    if (isTronLinkReady()) {
        return true;
    }
    
    // Try requesting accounts again
    if (window.tronLink) {
        try {
            const result = await window.tronLink.request({ method: 'tron_requestAccounts' });
            if (result.code === 200 && window.tronWeb?.ready) {
                return true;
            }
            throw new PaymentError(
                result.code === 4001 ? 'Connection rejected by user' : 'Please unlock your TronLink wallet',
                ERROR_CODES.WALLET_ERROR
            );
        } catch (e) {
            if (e instanceof PaymentError) throw e;
            throw new PaymentError('Failed to connect to TronLink', ERROR_CODES.WALLET_ERROR);
        }
    }
    
    throw new PaymentError(
        'TronLink not detected. Please install the TronLink extension.',
        ERROR_CODES.PROVIDER_ERROR
    );
}

// ======================================================
// 🛡️  ERROR HANDLING CLASS
// ======================================================

class PaymentError extends Error {
    constructor(message, code, metadata = {}) {
        super(message);
        this.name = 'PaymentError';
        this.code = code;
        this.metadata = metadata;
        if (Error.captureStackTrace) Error.captureStackTrace(this, PaymentError);
    }
}

// ======================================================
// 🔌  DEPENDENCY LOADING
// ======================================================

async function loadScript(src, checkFn, name, timeout = 20000) {
    if (checkFn()) { 
        console.log(`✅ ${name} already loaded`); 
        return true; 
    }
    
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const srcFile = src.split('/').pop().split('?')[0];
        const existingScript = document.querySelector(`script[src*="${srcFile}"]`);
        
        // If script exists, wait for it
        if (existingScript) {
            console.log(`[${name}] Waiting for existing script...`);
            const check = setInterval(() => {
                if (checkFn()) { 
                    clearInterval(check); 
                    console.log(`✅ ${name} ready`);
                    resolve(true); 
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(check);
                    console.warn(`[${name}] Timeout waiting for existing script`);
                    // Don't reject - mark as "soft fail" and let caller handle
                    resolve(false);
                }
            }, 150);
            return;
        }
        
        // Load fresh script
        const script = document.createElement('script'); 
        script.src = src;
        script.async = true;
        
        script.onload = () => {
            const initCheck = setInterval(() => {
                if (checkFn()) { 
                    clearInterval(initCheck);
                    console.log(`✅ ${name} loaded`); 
                    resolve(true); 
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(initCheck);
                    reject(new PaymentError(`${name} init timeout`, ERROR_CODES.DEPENDENCY_ERROR));
                }
            }, 100);
        };
        
        script.onerror = () => reject(new PaymentError(`Failed to load ${name}`, ERROR_CODES.DEPENDENCY_ERROR));
        document.head.appendChild(script);
    });
}

async function loadEthers() { 
    return loadScript(CONFIG.ETHERS.SRC, () => typeof ethers !== 'undefined' && ethers.utils, 'Ethers.js', 25000); 
}

// Shared WalletConnect loader with retry logic - can be called from vote.js
async function loadWalletConnectWithRetry(retries = 3, delay = 2000) {
    // Check if already loaded
    const existingProvider = getEthereumProviderClass();
    if (walletConnectLoaded && existingProvider) {
        console.log('✅ WalletConnect already available');
        return existingProvider;
    }
    
    if (walletConnectPromise) {
        console.log('[WalletConnect] Waiting for existing load...');
        try {
            return await walletConnectPromise;
        } catch (e) {
            console.warn('[WalletConnect] Existing load failed, retrying...');
            walletConnectPromise = null;
        }
    }
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[WalletConnect] Load attempt ${attempt}/${retries}...`);
            
            // Create a promise that resolves when the provider is available
            walletConnectPromise = new Promise(async (resolve, reject) => {
                try {
                    // Load the script
                    const scriptLoaded = await loadScript(
                        CONFIG.WALLETCONNECT.SRC, 
                        () => !!getEthereumProviderClass(), 
                        'WalletConnect',
                        30000
                    );
                    
                    if (!scriptLoaded) {
                        // Script loaded but provider not immediately available
                        // Wait and check multiple times
                        for (let i = 0; i < 10; i++) {
                            await new Promise(r => setTimeout(r, 500));
                            const provider = getEthereumProviderClass();
                            if (provider) {
                                console.log(`[WalletConnect] Provider found after ${(i + 1) * 500}ms`);
                                resolve(provider);
                                return;
                            }
                        }
                        reject(new Error('Provider not found after extended wait'));
                        return;
                    }
                    
                    const provider = getEthereumProviderClass();
                    if (provider) {
                        resolve(provider);
                    } else {
                        reject(new Error('EthereumProvider not available after load'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
            
            const provider = await walletConnectPromise;
            
            if (provider) {
                walletConnectLoaded = true;
                window.EthereumProvider = provider; // Normalize location
                console.log('✅ WalletConnect loaded successfully');
                return provider;
            }
            
            throw new Error('EthereumProvider not available after load');
            
        } catch (e) {
            console.warn(`[WalletConnect] Attempt ${attempt} failed:`, e.message);
            walletConnectPromise = null;
            
            if (attempt < retries) {
                console.log(`[WalletConnect] Waiting ${delay}ms before retry...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    
    // Final fallback: return null instead of throwing, let caller handle gracefully
    console.warn('[WalletConnect] All attempts failed, will use QR/manual fallback');
    return null;
}

// Simple alias for backward compatibility
async function loadWalletConnect() {
    return loadWalletConnectWithRetry(2, 1500);
}

async function loadPaystack() { 
    return loadScript(CONFIG.PAYSTACK.SRC, () => typeof PaystackPop !== 'undefined', 'Paystack', 15000); 
}

// ======================================================
// 🔌  UTILITY FUNCTIONS
// ======================================================

function validateInputs(participantId, voteCount) {
    if (!participantId || typeof participantId !== 'string') throw new PaymentError('Invalid participant ID', ERROR_CODES.INVALID_INPUT);
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) throw new PaymentError('Invalid vote count', ERROR_CODES.INVALID_INPUT);
}

function getAttempts(pid) { try { return JSON.parse(sessionStorage.getItem(`crypto_pay_${pid}`) || '[]'); } catch { return []; } }
function setAttempts(pid, a) { try { sessionStorage.setItem(`crypto_pay_${pid}`, JSON.stringify(a)); } catch {} }
function checkRateLimit(pid) {
    const now = Date.now(), attempts = getAttempts(pid).filter(t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT);
    if (attempts.length >= CONFIG.LIMITS.MAX_RETRIES) throw new PaymentError('Too many attempts. Try later.', ERROR_CODES.RATE_LIMIT);
    attempts.push(now); setAttempts(pid, attempts);
}

function trackEvent(name, meta = {}) { try { window.analytics?.track(name, meta); console.log(`[Analytics] ${name}`, meta); } catch {} }
function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }

function generateQR(text, elementId) {
    const el = document.getElementById(elementId); if (!el) return;
    const img = document.createElement('img'); img.className = 'mx-auto rounded-lg'; img.alt = 'QR Code'; img.style.cssText = 'width:200px;height:200px;';
    const urls = [`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}`, `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=200`];
    let i = 0; img.onerror = () => { if (++i < urls.length) img.src = urls[i]; };
    img.src = urls[0]; el.innerHTML = ''; el.appendChild(img);
}

// ======================================================
// 🌐  WALLET MANAGEMENT
// ======================================================

async function detectNetwork() {
    try {
        // Check TronLink first (using new method)
        if (window.tronLink || window.tronWeb?.ready) {
            if (isTronLinkReady()) return 'TRON';
            // Try to initialize if not ready
            const tronReady = await initTronLink();
            if (tronReady) return 'TRON';
        }
        // Check Ethereum/BSC
        if (window.ethereum) { 
            const c = await window.ethereum.request({ method: 'eth_chainId' }); 
            if (c === '0x38') return 'BSC'; 
        }
    } catch (e) {
        console.warn('[detectNetwork] Error:', e.message);
    } 
    return null;
}

async function connectWalletConnect() {
    try {
        // STEP 1: Check for injected wallet first (MetaMask, Trust Wallet, etc.)
        if (window.ethereum) {
            console.log('[Wallet] Injected wallet detected, trying direct connection...');
            try {
                // Request account access
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                
                if (accounts?.length) {
                    // Verify/switch to BSC network
                    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                    const targetChain = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
                    
                    if (chainId !== targetChain) {
                        console.log('[Wallet] Switching to BSC network...');
                        try {
                            await window.ethereum.request({
                                method: 'wallet_switchEthereumChain',
                                params: [{ chainId: targetChain }]
                            });
                        } catch (switchError) {
                            // Error code 4902 = chain not added
                            if (switchError.code === 4902) {
                                console.log('[Wallet] Adding BSC network...');
                                await window.ethereum.request({
                                    method: 'wallet_addEthereumChain',
                                    params: [{
                                        chainId: targetChain,
                                        chainName: 'BNB Smart Chain Mainnet',
                                        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                                        rpcUrls: [CONFIG.BSC.RPC_URL, 'https://bsc-dataseed1.binance.org/'],
                                        blockExplorerUrls: ['https://bscscan.com']
                                    }]
                                });
                            } else if (switchError.code === 4001) {
                                throw new PaymentError('You need to switch to BSC network', ERROR_CODES.NETWORK_ERROR);
                            } else {
                                throw switchError;
                            }
                        }
                    }
                    
                    console.log('✅ Connected via injected wallet:', accounts[0]);
                    return window.ethereum;
                }
            } catch (injectedError) {
                // User rejected or other error
                if (injectedError.code === 4001) {
                    throw new PaymentError('Wallet connection rejected', ERROR_CODES.WALLET_ERROR);
                }
                console.log('[Wallet] Injected wallet failed:', injectedError.message);
                // Fall through to WalletConnect
            }
        }
        
        // STEP 2: Try WalletConnect
        console.log('[Wallet] Trying WalletConnect...');
        const EthereumProvider = await loadWalletConnectWithRetry(3, 2000);
        
        if (!EthereumProvider) {
            // No WalletConnect available
            throw new PaymentError(
                'No wallet detected. Please install MetaMask or use the QR code payment option.',
                ERROR_CODES.PROVIDER_ERROR
            );
        }
        
        // Clear any stale WalletConnect sessions
        try {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('wc@') || key.includes('walletconnect'))) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        } catch (e) {
            console.warn('[Wallet] Could not clear stale sessions:', e);
        }
        
        console.log('[WalletConnect] Initializing provider...');
        
        // Initialize the WalletConnect provider
        const provider = await EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [CONFIG.BSC.CHAIN_ID],
            optionalChains: [1, 56, 137, 43114], // ETH, BSC, Polygon, Avalanche
            showQrModal: true,
            qrModalOptions: { 
                themeMode: 'light',
                themeVariables: {
                    '--wcm-accent-color': '#e63946',
                    '--wcm-background-color': '#ffffff',
                    '--wcm-z-index': '999999'
                },
                enableExplorer: true,
                explorerRecommendedWalletIds: [
                    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
                    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
                    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
                    'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase
                    '225affb176778569276e484e1b92637ad061b01e13a048b35a9d280c3b58970f'  // Safe
                ]
            },
            metadata: { 
                name: 'OneDream Voting', 
                description: 'Secure USDT Payment for OneDream Initiative', 
                url: window.location.origin, 
                icons: [
                    `${window.location.origin}/images/logo.png`,
                    `${window.location.origin}/favicon.ico`
                ]
            },
            rpcMap: {
                1: 'https://eth.llamarpc.com',
                56: CONFIG.BSC.RPC_URL,
                137: 'https://polygon-rpc.com',
                43114: 'https://api.avax.network/ext/bc/C/rpc'
            }
        });
        
        // Event listeners for debugging
        provider.on('display_uri', (uri) => {
            console.log('[WalletConnect] QR URI ready');
            // Update UI if needed
            if (window.updateOverlayMessage) {
                window.updateOverlayMessage('Scan QR Code', 'Open your wallet app and scan');
            }
        });
        
        provider.on('connect', (info) => {
            console.log('[WalletConnect] Connected:', info);
        });
        
        provider.on('disconnect', (error) => {
            console.log('[WalletConnect] Disconnected:', error);
            walletConnectProvider = null;
        });
        
        // Connect
        console.log('[WalletConnect] Opening connection modal...');
        await provider.connect();
        
        // Verify chain
        const chainId = await provider.request({ method: 'eth_chainId' });
        const targetChain = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
        
        if (chainId !== targetChain) {
            console.log('[WalletConnect] Requesting chain switch to BSC...');
            try { 
                await provider.request({ 
                    method: 'wallet_switchEthereumChain', 
                    params: [{ chainId: targetChain }] 
                }); 
            } catch (switchError) {
                console.warn('[WalletConnect] Chain switch failed:', switchError);
                throw new PaymentError('Please switch to BSC network in your wallet app', ERROR_CODES.NETWORK_ERROR); 
            }
        }
        
        // Get accounts
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts?.length) {
            throw new PaymentError('No wallet accounts found. Please unlock your wallet.', ERROR_CODES.WALLET_ERROR);
        }
        
        walletConnectProvider = provider;
        console.log('✅ WalletConnect connected:', accounts[0]);
        return provider;
        
    } catch (error) {
        console.error('[Wallet] Connection error:', error);
        
        // Handle specific error cases
        if (error.code === 4001 || error.message?.includes('rejected') || error.message?.includes('cancelled')) {
            throw new PaymentError('Connection cancelled', ERROR_CODES.WALLET_ERROR);
        }
        
        if (error.message?.includes('already been used') || error.message?.includes('already registered')) {
            console.log('[Wallet] Component conflict - trying to use existing provider');
            if (walletConnectProvider) return walletConnectProvider;
        }
        
        // Re-throw PaymentError as-is, wrap others
        if (error instanceof PaymentError) throw error;
        throw new PaymentError(error.message || 'Wallet connection failed', ERROR_CODES.WALLET_ERROR);
    }
}

// ======================================================
// 🏦  PAYMENT EXECUTION
// ======================================================

async function executeBSCTransfer(provider, recipient, amount) {
    await loadEthers();
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts[0]) throw new PaymentError('No wallet connected', ERROR_CODES.WALLET_ERROR);
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const iface = new ethers.utils.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
    const txHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: CONFIG.BSC.USDT_ADDRESS, data }] });
    return { txHash, network: 'BSC', explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` };
}

async function executeTronTransfer(recipient, amount) {
    // Ensure TronLink is connected
    await connectTronLink();
    
    if (!window.tronWeb?.ready) {
        throw new PaymentError('TronLink not available. Please install and unlock TronLink.', ERROR_CODES.PROVIDER_ERROR);
    }
    
    try {
        console.log('[TRON] Initiating transfer of', amount, 'USDT to', recipient);
        
        // Get USDT contract
        const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
        
        // USDT on TRON has 6 decimals
        const amountSun = Math.floor(amount * 1e6);
        
        console.log('[TRON] Amount in smallest unit:', amountSun);
        
        // Execute transfer
        const tx = await contract.transfer(recipient, amountSun).send({
            feeLimit: 100_000_000, // 100 TRX max fee
            callValue: 0,
            shouldPollResponse: false
        });
        
        // Handle different response formats
        let txHash;
        if (typeof tx === 'string') {
            txHash = tx;
        } else if (tx?.transaction?.txID) {
            txHash = tx.transaction.txID;
        } else if (tx?.txid) {
            txHash = tx.txid;
        } else {
            console.log('[TRON] Transaction response:', tx);
            throw new PaymentError('Unable to get transaction hash', ERROR_CODES.TRANSACTION_ERROR);
        }
        
        console.log('✅ TRON transaction submitted:', txHash);
        
        return { 
            txHash, 
            network: 'TRON', 
            explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` 
        };
        
    } catch (error) {
        console.error('[TRON] Transfer error:', error);
        
        // Handle specific TronLink errors
        if (error.message?.includes('Confirmation declined') || error.message?.includes('rejected')) {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        
        if (error.message?.includes('balance')) {
            throw new PaymentError('Insufficient USDT balance', ERROR_CODES.TRANSACTION_ERROR);
        }
        
        throw new PaymentError(error.message || 'TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
    }
}

async function finalizePayment(txHash, network) {
    const res = await fetch('/api/onedream/finalize-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_hash: txHash, network: network.toLowerCase() }) });
    if (!res.ok) throw new PaymentError('Finalization failed', ERROR_CODES.NETWORK_ERROR);
    return res.json();
}

// ======================================================
// 💳  PAYSTACK INTEGRATION
// ======================================================

async function initiatePaystackPayment(email, amount, participantId, voteCount, onSuccess, onClose) {
    if (!CONFIG.PAYSTACK.PUBLIC_KEY) { alert('Paystack not configured'); return { success: false }; }
    await loadPaystack();
    return new Promise((resolve) => {
        const handler = PaystackPop.setup({
            key: CONFIG.PAYSTACK.PUBLIC_KEY,
            email: email,
            amount: Math.round(amount * 100), // Paystack uses kobo/cents
            currency: 'NGN',
            ref: `vote_${participantId}_${Date.now()}`,
            metadata: { participant_id: participantId, vote_count: voteCount },
            callback: (response) => {
                trackEvent('paystack_success', { reference: response.reference, participantId });
                if (onSuccess) onSuccess(response);
                resolve({ success: true, reference: response.reference });
            },
            onClose: () => {
                trackEvent('paystack_closed', { participantId });
                if (onClose) onClose();
                resolve({ success: false, cancelled: true });
            }
        });
        handler.openIframe();
    });
}

// ======================================================
// 🧩  UI COMPONENTS
// ======================================================

function createModal(content) { const m = document.createElement('div'); m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 crypto-modal-fade-in'; m.innerHTML = content; document.body.appendChild(m); return m; }

function showPaymentStatusModal(network, amount) {
    return createModal(`<div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]"><div class="flex justify-between items-center mb-3"><h3 class="font-bold text-lg">${network} Payment</h3><span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'BSC' ? 'BEP-20' : 'TRC-20'}</span></div><div class="text-2xl font-bold mb-4">${amount} USDT</div><div id="statusText" class="min-h-6 mb-4">Initializing…</div><div class="loading-spinner mx-auto"></div><div id="txLink" class="mt-4 text-sm hidden"><a href="#" target="_blank" class="text-blue-500">View on explorer</a></div><button id="closeModal" class="mt-4 text-gray-500 text-sm hidden">Close</button></div>`);
}

function showNetworkModal(preferred) {
    return new Promise(resolve => {
        const m = createModal(`<div class="bg-white p-6 rounded-xl w-80 text-center"><h3 class="font-bold mb-4">Choose Payment Method</h3><button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-2">🟡 BSC (USDT BEP-20)${preferred === 'BSC' ? ' ✓' : ''}</button><button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded mb-2">🔴 TRON (USDT TRC-20)${preferred === 'TRON' ? ' ✓' : ''}</button>${CONFIG.PAYSTACK.PUBLIC_KEY ? '<button id="card" class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded mb-2">💳 Pay with Card (Paystack)</button>' : ''}<button id="cancel" class="mt-2 text-gray-500 text-sm">Cancel</button></div>`);
        m.querySelector('#bsc').onclick = () => { m.remove(); resolve('BSC'); };
        m.querySelector('#tron').onclick = () => { m.remove(); resolve('TRON'); };
        m.querySelector('#card')?.addEventListener('click', () => { m.remove(); resolve('CARD'); });
        m.querySelector('#cancel').onclick = () => { m.remove(); resolve(null); };
    });
}

function showWalletOptionsModal(network) {
    return new Promise(resolve => {
        const m = createModal(`<div class="bg-white p-6 rounded-xl text-center w-80"><h3 class="font-bold mb-3">Connect Wallet</h3><p class="text-sm text-gray-600 mb-4">${isMobile() ? 'Tap to open your wallet app:' : 'Scan QR code or pay manually:'}</p><button id="wc" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2">🔗 ${isMobile() ? 'Open Wallet App' : 'WalletConnect QR'}</button><button id="qr" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2">📱 Pay via QR Code</button><button id="back" class="w-full bg-gray-200 py-2 rounded mt-2">← Back</button></div>`);
        m.querySelector('#wc').onclick = () => { m.remove(); resolve('walletconnect'); };
        m.querySelector('#qr').onclick = () => { m.remove(); resolve('qr'); };
        m.querySelector('#back').onclick = () => { m.remove(); resolve('back'); };
    });
}

function showManualPaymentModal(network, recipient, amount) {
    return new Promise(resolve => {
        const id = network.toLowerCase() + 'QR';
        const m = createModal(`<div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw]"><h3 class="font-bold mb-3">${network} USDT Payment</h3><p class="text-sm mb-2">Send <strong>${amount} USDT</strong> to:</p><div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div><div id="${id}" class="mx-auto mb-3"></div><p class="text-xs text-red-500 mb-2">⚠️ Only send USDT on ${network} network!</p><button id="copy" class="text-blue-500 text-xs mb-3">📋 Copy Address</button><div class="border-t pt-3 mt-2"><input type="text" id="txHash" placeholder="Transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2"/><button id="confirm" class="w-full bg-green-600 text-white py-2 rounded text-sm mb-2">✅ I've Paid</button></div><button id="close" class="w-full bg-gray-200 py-2 rounded text-sm">Cancel</button></div>`);
        generateQR(recipient, id);
        m.querySelector('#copy').onclick = () => { navigator.clipboard.writeText(recipient); m.querySelector('#copy').textContent = '✅ Copied!'; setTimeout(() => m.querySelector('#copy').textContent = '📋 Copy Address', 2000); };
        m.querySelector('#confirm').onclick = () => { const tx = m.querySelector('#txHash').value.trim(); if (!tx && !confirm('No hash entered. Continue?')) return; m.remove(); const pattern = network === 'BSC' ? /^0x[a-fA-F0-9]{64}$/ : /^[a-fA-F0-9]{64}$/; resolve(tx && pattern.test(tx) ? { success: true, manual: true, txHash: tx, explorerUrl: `${CONFIG[network].EXPLORER}${tx}` } : { success: false, manual: true, pending: true }); };
        m.querySelector('#close').onclick = () => { m.remove(); resolve({ success: false, cancelled: true }); };
    });
}

function updateStatus(m, t) { const el = m.querySelector('#statusText'); if (el) el.textContent = t; }
function successStatus(m, tx, url) { updateStatus(m, '✅ Payment confirmed'); m.querySelector('.loading-spinner')?.remove(); const l = m.querySelector('#txLink'); if (l) { l.querySelector('a').href = url; l.classList.remove('hidden'); } setTimeout(() => m.remove(), 5000); }
function errorStatus(m, e) { updateStatus(m, `❌ ${e.message || 'Failed'}`); m.querySelector('.loading-spinner')?.remove(); m.querySelector('#closeModal')?.classList.remove('hidden'); }

// ======================================================
// 🚀  MAIN ENTRY POINTS
// ======================================================

async function initiateCryptoPayment(participantId, voteCount, amount, email = null) {
    let modal = null;
    try {
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        // Update vote.js overlay if available (step 2: network selection)
        if (window.updateOverlayStep) window.updateOverlayStep(2);
        if (window.updateOverlayMessage) window.updateOverlayMessage('Choose payment network...', 'Select BSC, TRON, or Card');
        
        const preferred = await detectNetwork();
        const method = await showNetworkModal(preferred);
        if (!method) return { success: false, cancelled: true };
        
        // Paystack card payment
        if (method === 'CARD') {
            const userEmail = email || prompt('Enter your email for payment receipt:');
            if (!userEmail) return { success: false, cancelled: true };
            return initiatePaystackPayment(userEmail, amount, participantId, voteCount);
        }
        
        const recipient = CONFIG[method].WALLET_ADDRESS;
        
        // BSC Payment Flow
        if (method === 'BSC') {
            const choice = await showWalletOptionsModal(method);
            if (choice === 'back') return initiateCryptoPayment(participantId, voteCount, amount, email);
            if (choice === 'qr') {
                const result = await showManualPaymentModal(method, recipient, amount);
                if (result.success && result.txHash) { 
                    try { await finalizePayment(result.txHash, method); } catch {} 
                }
                trackEvent('payment_completed', { participantId, network: method, manual: true });
                return result;
            }
            if (choice === 'walletconnect') {
                modal = showPaymentStatusModal(method, amount);
                updateStatus(modal, isMobile() ? 'Opening wallet...' : 'Scan QR with wallet...');
                
                // Update vote.js overlay (step 3: confirming)
                if (window.updateOverlayStep) window.updateOverlayStep(3);
                
                try {
                    const provider = await connectWalletConnect();
                    updateStatus(modal, 'Confirm transaction...');
                    const result = await executeBSCTransfer(provider, recipient, amount);
                    updateStatus(modal, 'Finalizing...');
                    await finalizePayment(result.txHash, method);
                    successStatus(modal, result.txHash, result.explorerUrl);
                    trackEvent('payment_completed', { participantId, network: method, method: 'walletconnect' });
                    return { success: true, ...result };
                } catch (e) {
                    errorStatus(modal, e);
                    if (confirm('Connection failed. Try QR payment?')) {
                        modal.remove();
                        return showManualPaymentModal(method, recipient, amount);
                    }
                    return { success: false, error: e.message };
                }
            }
        }
        
        // TRON Payment Flow
        if (method === 'TRON') {
            // Check if TronLink is available
            const hasTronLink = window.tronLink || window.tronWeb;
            
            if (!hasTronLink) {
                // No TronLink - show manual QR payment
                const result = await showManualPaymentModal(method, recipient, amount);
                if (result.success && result.txHash) { 
                    try { await finalizePayment(result.txHash, method); } catch {} 
                }
                trackEvent('payment_completed', { participantId, network: method, manual: true });
                return result;
            }
            
            // Try to connect TronLink
            try {
                await connectTronLink();
            } catch (e) {
                console.warn('[Payment] TronLink connection failed:', e.message);
                // Offer manual payment as fallback
                if (confirm(`${e.message}\n\nWould you like to pay manually via QR code instead?`)) {
                    const result = await showManualPaymentModal(method, recipient, amount);
                    if (result.success && result.txHash) { 
                        try { await finalizePayment(result.txHash, method); } catch {} 
                    }
                    return result;
                }
                return { success: false, error: e.message };
            }
            
            // TronLink is ready - proceed with transaction
            modal = showPaymentStatusModal(method, amount);
            updateStatus(modal, 'Confirm in TronLink...');
            
            // Update vote.js overlay (step 3: confirming)
            if (window.updateOverlayStep) window.updateOverlayStep(3);
            
            try {
                const result = await executeTronTransfer(recipient, amount);
                updateStatus(modal, 'Finalizing...');
                await finalizePayment(result.txHash, method);
                successStatus(modal, result.txHash, result.explorerUrl);
                trackEvent('payment_completed', { participantId, network: method, method: 'tronlink' });
                return { success: true, ...result };
            } catch (e) {
                errorStatus(modal, e);
                
                // Offer QR fallback on error
                if (confirm(`${e.message}\n\nWould you like to try manual QR payment instead?`)) {
                    modal.remove();
                    const result = await showManualPaymentModal(method, recipient, amount);
                    if (result.success && result.txHash) { 
                        try { await finalizePayment(result.txHash, method); } catch {} 
                    }
                    return result;
                }
                
                return { success: false, error: e.message };
            }
        }
        
        return { success: false, error: 'Invalid method' };
    } catch (error) {
        console.error('[Payment] Error:', error);
        if (modal) errorStatus(modal, error); 
        else if (window.showOverlayError) window.showOverlayError(error.message || 'Payment failed');
        else alert(error.message || 'Payment failed');
        trackEvent('payment_error', { error: error.message, participantId });
        return { success: false, error: error.message };
    }
}

async function processCryptoPayment() {
    const pid = window.currentParticipant?.id, votes = window.selectedVoteAmount, amt = window.selectedPaymentAmount || votes * 0.5;
    if (!pid || !votes) return { success: false, error: 'Missing details' };
    return initiateCryptoPayment(pid, votes, amt);
}

// ======================================================
// 🏁  INITIALIZATION
// ======================================================

async function initialize() {
    if (isInitialized) return true;
    if (initializationPromise) return initializationPromise;
    
    initializationPromise = (async () => {
        try {
            await loadEthers();
            
            // Initialize TronLink early (as recommended by TronLink)
            // This is done in background - don't block on it
            initTronLink().catch(e => 
                console.log('[Init] TronLink not available:', e.message)
            );
            
            // Pre-load WalletConnect in background - don't block
            loadWalletConnectWithRetry(2, 1000).catch(e => 
                console.warn('[Init] WalletConnect preload skipped:', e.message)
            );
            
            isInitialized = true;
            resolveReady(true);
            console.log('🔒 Crypto Payments Ready');
            return true;
        } catch (e) {
            console.error('[Init] Failed:', e);
            rejectReady(e);
            throw e;
        }
    })();
    
    return initializationPromise;
}

function isReady() { return isInitialized; }
async function whenReady(timeout = 15000) {
    if (isInitialized) return true;
    return Promise.race([readyPromise, new Promise((_, r) => setTimeout(() => r(new Error('Init timeout')), timeout))]);
}

// Auto-initialize
setTimeout(() => initialize().catch(console.error), 50);

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.processCryptoPayment = processCryptoPayment;
window.initiatePaystackPayment = initiatePaystackPayment;
window.cryptoPaymentReady = readyPromise;

// Shared loader for vote.js to use
window.loadWalletConnectShared = loadWalletConnectWithRetry;

window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    process: processCryptoPayment,
    paystack: initiatePaystackPayment,
    loadWalletConnect: loadWalletConnectWithRetry,
    connectWallet: connectWalletConnect,
    connectTronLink: connectTronLink,
    initTronLink: initTronLink,
    isReady, whenReady, initialize,
    showManualPaymentModal,
    CONFIG, ERROR_CODES
};

console.log('✅ Crypto Payments module loaded');