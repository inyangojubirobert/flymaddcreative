// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

// Check if we're in a browser environment
if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// ✅ Inject required CSS for loading spinner
(function injectStyles() {
    if (document.getElementById('crypto-payments-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'crypto-payments-styles';
    style.textContent = `
        .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid #e5e7eb;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: crypto-spin 0.8s linear infinite;
        }
        @keyframes crypto-spin {
            to { transform: rotate(360deg); }
        }
        .crypto-modal-fade-in {
            animation: crypto-fade-in 0.2s ease-out;
        }
        @keyframes crypto-fade-in {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
})();

// ✅ Config with multiple fallback sources
const scriptTag = document.currentScript || document.querySelector('script[src*="crypto-payments"]');

const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        // Multiple RPC URLs for fallback
        RPC_URLS: [
            window.env?.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed1.binance.org/",
            "https://bsc-dataseed2.binance.org/",
            "https://bsc-dataseed3.binance.org/",
            "https://bsc-dataseed4.binance.org/",
            "https://bsc.publicnode.com",
            "https://binance.llamarpc.com"
        ],
        RPC_URL: window.env?.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed1.binance.org/",
        CHAIN_ID: parseInt(window.env?.NEXT_PUBLIC_CRYPTO_CHAIN_ID, 10) || 56,
        EXPLORER: "https://bscscan.com/tx/",
        WALLET_ADDRESS: window.env?.NEXT_PUBLIC_CRYPTO_WALLET_ADDRESS_BSC 
            || scriptTag?.dataset?.bscWallet 
            || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/",
        GRID_API: window.env?.NEXT_PUBLIC_TRON_GRID_API || "https://api.trongrid.io",
        API_KEY: window.env?.NEXT_PUBLIC_TRON_PRO_API_KEY || "",
        WALLET_ADDRESS: window.env?.NEXT_PUBLIC_CRYPTO_WALLET_ADDRESS_TRON 
            || scriptTag?.dataset?.tronWallet 
            || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: window.WALLETCONNECT_PROJECT_ID 
            || scriptTag?.dataset?.wcProjectId 
            || "61d9b98f81731dffa9988c0422676fc5"
    },
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000,
        ATTEMPT_TIMEOUT: 5 * 60 * 1000
    },
    POLLING: {
        INTERVAL_MS: 10000,
        TIMEOUT_MS: 10 * 60 * 1000
    }
};

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

// Track initialization state
let isInitialized = false;
let initializationPromise = null;
let initializationError = null;
let walletConnectLoaded = false;
let walletConnectLoadPromise = null;

// Ready promise that external code can await
let resolveReady;
let rejectReady;
const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
});

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
// 🔌  DEPENDENCY LOADING
// ======================================================

async function loadEthersJS() {
    if (typeof ethers !== 'undefined' && ethers.providers) {
        console.log('✅ Ethers.js already loaded');
        return true;
    }
    
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.ethers.io/lib/ethers-5.7.2.min.js';
        script.onload = () => {
            if (typeof ethers === 'undefined' || !ethers.providers) {
                reject(new PaymentError('Ethers.js not properly loaded', ERROR_CODES.DEPENDENCY_ERROR));
                return;
            }
            console.log('✅ Ethers.js v5 loaded');
            resolve(true);
        };
        script.onerror = () => reject(new PaymentError('Failed to load ethers.js', ERROR_CODES.DEPENDENCY_ERROR));
        document.head.appendChild(script);
    });
}

async function loadWalletConnect() {
    // Prevent duplicate loading
    if (walletConnectLoaded && window.EthereumProvider) {
        console.log('✅ WalletConnect already loaded');
        return window.EthereumProvider;
    }
    
    // If already loading, wait for it
    if (walletConnectLoadPromise) {
        console.log('[WalletConnect] Waiting for existing load...');
        return walletConnectLoadPromise;
    }
    
    walletConnectLoadPromise = new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.EthereumProvider) {
            walletConnectLoaded = true;
            console.log('✅ WalletConnect already available');
            resolve(window.EthereumProvider);
            return;
        }
        
        // Check if script already exists
        const existingScript = document.querySelector(`script[src*="walletconnect"]`);
        if (existingScript) {
            console.log('[WalletConnect] Script already in DOM, waiting...');
            // Wait for it to load
            const checkInterval = setInterval(() => {
                if (window.EthereumProvider) {
                    clearInterval(checkInterval);
                    walletConnectLoaded = true;
                    resolve(window.EthereumProvider);
                }
            }, 100);
            
            setTimeout(() => {
                clearInterval(checkInterval);
                if (!window.EthereumProvider) {
                    reject(new PaymentError('WalletConnect load timeout', ERROR_CODES.PROVIDER_ERROR));
                }
            }, 10000);
            return;
        }
        
        const script = document.createElement('script');
        script.src = CONFIG.WALLETCONNECT.SRC;
        script.async = true;
        
        script.onload = () => {
            // Wait a bit for the provider to initialize
            setTimeout(() => {
                if (!window.EthereumProvider) {
                    reject(new PaymentError('WalletConnect not properly loaded', ERROR_CODES.PROVIDER_ERROR));
                    return;
                }
                walletConnectLoaded = true;
                console.log('✅ WalletConnect SDK loaded');
                resolve(window.EthereumProvider);
            }, 100);
        };
        
        script.onerror = (e) => {
            console.error('[WalletConnect] Script load error:', e);
            reject(new PaymentError('Failed to load WalletConnect', ERROR_CODES.PROVIDER_ERROR));
        };
        
        document.head.appendChild(script);
    });
    
    return walletConnectLoadPromise;
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

function getAttempts(participantId) {
    try {
        return JSON.parse(sessionStorage.getItem(`crypto_pay_attempts_${participantId}`) || '[]');
    } catch {
        return [];
    }
}

function setAttempts(participantId, attempts) {
    try {
        sessionStorage.setItem(`crypto_pay_attempts_${participantId}`, JSON.stringify(attempts));
    } catch (e) {
        console.warn('[RateLimit] Failed to persist attempts:', e);
    }
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = getAttempts(participantId).filter(t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT);
    
    if (attempts.length >= CONFIG.LIMITS.MAX_RETRIES) {
        throw new PaymentError('Too many payment attempts. Please try again later.', ERROR_CODES.RATE_LIMIT, { attempts: attempts.length });
    }
    
    attempts.push(now);
    setAttempts(participantId, attempts);
}

function trackEvent(name, metadata = {}) {
    try {
        if (window.analytics) window.analytics.track(name, metadata);
        console.log(`[Analytics] ${name}`, metadata);
    } catch (e) {
        console.error('Tracking error:', e);
    }
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function waitForWalletProvider(timeout = 3000) {
    return new Promise((resolve) => {
        if (window.ethereum) { resolve(true); return; }
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.ethereum) { clearInterval(checkInterval); resolve(true); }
            else if (Date.now() - startTime > timeout) { clearInterval(checkInterval); resolve(false); }
        }, 100);
    });
}

async function requestWalletConnection() {
    if (!window.ethereum) return false;
    try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        return accounts && accounts.length > 0;
    } catch (error) {
        console.warn('[Wallet] Connection request failed:', error.message);
        return false;
    }
}

function generateQRCanvas(text, size = 200) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('QR Loading...', size/2, size/2 - 10);
    ctx.fillText('Copy address below', size/2, size/2 + 10);
    return canvas.toDataURL();
}

function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const img = document.createElement('img');
    img.className = 'mx-auto rounded-lg';
    img.alt = 'QR Code';
    img.style.cssText = 'width:200px;height:200px;';
    
    const urls = [
        `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}`,
        `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=200`,
        generateQRCanvas(text)
    ];
    
    let attempts = 0;
    img.onerror = () => { if (++attempts < urls.length) img.src = urls[attempts]; };
    img.src = urls[0];
    element.innerHTML = '';
    element.appendChild(img);
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb?.ready) {
            try {
                const tronNetwork = await window.tronWeb.trx.getNodeInfo();
                if (tronNetwork?.net) return 'TRON';
            } catch (e) { console.debug('TRON detection error:', e); }
        }
        if (window.ethereum) {
            try {
                const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                if (chainId === '0x38') return 'BSC';
            } catch (e) { console.debug('BSC detection error:', e); }
        }
    } catch (error) { console.warn('Network detection error:', error); }
    return null;
}

async function connectWithWalletConnect() {
    try {
        console.log('[WalletConnect] Starting connection...');
        
        // Ensure WalletConnect is loaded properly
        const EthereumProvider = await loadWalletConnect();
        
        if (!EthereumProvider) {
            throw new PaymentError('WalletConnect provider not available', ERROR_CODES.PROVIDER_ERROR);
        }
        
        // Check if there's an existing session we need to clean up
        try {
            // Clear any stale sessions
            if (window.localStorage) {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith('wc@') || key.startsWith('walletconnect')) {
                        try {
                            localStorage.removeItem(key);
                        } catch (e) {
                            console.debug('[WalletConnect] Could not clear session key:', key);
                        }
                    }
                });
            }
        } catch (e) {
            console.debug('[WalletConnect] LocalStorage not available:', e);
        }
        
        const provider = await EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [CONFIG.BSC.CHAIN_ID],
            showQrModal: true,
            qrModalOptions: { 
                themeMode: 'dark', 
                enableExplorer: true,
                explorerRecommendedWalletIds: [
                    'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', // MetaMask
                    '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
                    '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // SafePal
                ]
            },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment for Voting",
                url: window.location.origin,
                icons: [`${window.location.origin}/images/logo.png`, `${window.location.origin}/favicon.ico`].filter(Boolean)
            }
        });
        
        // Enable session persistence
        provider.on('display_uri', (uri) => {
            console.log('[WalletConnect] Display URI:', uri);
            // On mobile, this will trigger the wallet app
            if (isMobileDevice()) {
                // The QR modal will show a deep link for mobile
                console.log('[WalletConnect] Mobile device detected, wallet app should open');
            }
        });
        
        await provider.connect();
        console.log('[WalletConnect] Connected successfully');
        
        // Ensure correct chain
        const chainId = await provider.request({ method: 'eth_chainId' });
        const targetChainId = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
        
        if (chainId !== targetChainId) {
            console.log('[WalletConnect] Switching to BSC network...');
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetChainId }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: targetChainId,
                            chainName: 'Binance Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: [CONFIG.BSC.RPC_URL],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw new PaymentError('Please switch to BSC network in your wallet', ERROR_CODES.NETWORK_ERROR);
                }
            }
        }
        
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts?.length) throw new Error('No accounts returned from WalletConnect');
        
        console.log('[WalletConnect] Account:', accounts[0]);
        return provider;
    } catch (error) {
        console.error('[WalletConnect] Connection error:', error);
        
        // Reset load state on error to allow retry
        if (error.message?.includes('already been used')) {
            console.log('[WalletConnect] Detected duplicate registration, attempting recovery...');
            walletConnectLoaded = true; // Mark as loaded since components exist
            
            // Try to use existing provider
            if (window.EthereumProvider) {
                return connectWithWalletConnect(); // Retry
            }
        }
        
        throw new PaymentError(error.message || 'Failed to connect via WalletConnect', ERROR_CODES.WALLET_ERROR, { originalError: error });
    }
}

// Keep the old function name for compatibility
async function connectWalletMobile() {
    return connectWithWalletConnect();
}

// ======================================================
// 🏦  PAYMENT PROCESSING
// ======================================================

async function initializeCryptoPaymentBackend(participantId, voteCount, network) {
    trackEvent('payment_initiated', { participantId, voteCount, network });
    
    const response = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network: network.toLowerCase() })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PaymentError(errorData.message || 'Backend initialization failed', ERROR_CODES.NETWORK_ERROR, { status: response.status });
    }
    return response.json();
}

async function executeBSCTransfer(eip1193Provider, recipient, amount) {
    const accounts = await eip1193Provider.request({ method: 'eth_accounts' });
    const from = accounts[0];
    if (!from) throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
    
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const iface = new ethers.utils.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
    const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
    
    const txHash = await eip1193Provider.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: CONFIG.BSC.USDT_ADDRESS, data }]
    });
    
    return { txHash, network: 'BSC', explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` };
}

async function executeTronTransfer(recipient, amount) {
    if (!window.tronWeb?.ready) throw new PaymentError('TronWeb not available', ERROR_CODES.PROVIDER_ERROR);
    
    const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
    const amountSun = Math.floor(amount * 1_000_000);
    const tx = await contract.transfer(recipient, amountSun).send();
    
    if (!tx?.transaction?.txID) throw new PaymentError('TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
    return { txHash: tx.transaction.txID, network: 'TRON', explorerUrl: `${CONFIG.TRON.EXPLORER}${tx.transaction.txID}` };
}

async function finalizePayment(txHash, network) {
    const response = await fetch('/api/onedream/finalize-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_hash: txHash, network: network.toLowerCase() })
    });
    
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PaymentError(errorData.message || 'Payment finalization failed', ERROR_CODES.NETWORK_ERROR);
    }
    return response.json();
}

// ======================================================
// 🔄  AUTO-POLLING FOR MANUAL PAYMENTS
// ======================================================

let currentRpcIndex = 0;

function getNextRpcUrl() {
    const urls = CONFIG.BSC.RPC_URLS;
    currentRpcIndex = (currentRpcIndex + 1) % urls.length;
    return urls[currentRpcIndex];
}

async function pollForBSCPayment(recipient, expectedAmount, onStatusUpdate) {
    if (typeof ethers === 'undefined') return null;
    
    const startTime = Date.now();
    const expectedWei = ethers.utils.parseUnits(expectedAmount.toString(), 18);
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 3;
    
    while (Date.now() - startTime < CONFIG.POLLING.TIMEOUT_MS) {
        try {
            // Use rotating RPC URLs to avoid rate limits
            const rpcUrl = CONFIG.BSC.RPC_URLS[currentRpcIndex];
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
            
            const currentBlock = await provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 50); // Reduced block range to avoid rate limits
            
            const usdtContract = new ethers.Contract(
                CONFIG.BSC.USDT_ADDRESS,
                ['event Transfer(address indexed from, address indexed to, uint256 value)'],
                provider
            );
            
            const events = await usdtContract.queryFilter(usdtContract.filters.Transfer(null, recipient), fromBlock, currentBlock);
            
            consecutiveErrors = 0; // Reset on success
            
            for (const event of events.reverse()) {
                if (event.args.value.gte(expectedWei.mul(99).div(100))) {
                    return event.transactionHash;
                }
            }
            
            if (onStatusUpdate) onStatusUpdate(`Scanning for payment... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
            
        } catch (e) {
            console.warn('[Polling] BSC scan error, switching RPC:', e.message);
            consecutiveErrors++;
            
            // Switch to next RPC on error
            getNextRpcUrl();
            
            // If too many errors, increase wait time
            if (consecutiveErrors >= maxConsecutiveErrors) {
                console.warn('[Polling] Multiple RPC errors, waiting longer...');
                await new Promise(r => setTimeout(r, CONFIG.POLLING.INTERVAL_MS * 2));
                consecutiveErrors = 0;
            }
        }
        
        await new Promise(r => setTimeout(r, CONFIG.POLLING.INTERVAL_MS));
    }
    return null;
}

async function pollForTronPayment(recipient, expectedAmount, onStatusUpdate) {
    const startTime = Date.now();
    const expectedSun = Math.floor(expectedAmount * 1_000_000);
    
    while (Date.now() - startTime < CONFIG.POLLING.TIMEOUT_MS) {
        try {
            const headers = CONFIG.TRON.API_KEY ? { 'TRON-PRO-API-KEY': CONFIG.TRON.API_KEY } : {};
            const response = await fetch(
                `${CONFIG.TRON.GRID_API}/v1/accounts/${recipient}/transactions/trc20?limit=20&contract_address=${CONFIG.TRON.USDT_ADDRESS}`,
                { headers }
            );
            
            if (response.ok) {
                const data = await response.json();
                for (const tx of (data.data || [])) {
                    if (tx.to === recipient && parseInt(tx.value || '0') >= expectedSun * 0.99) {
                        return tx.transaction_id;
                    }
                }
            }
            
            if (onStatusUpdate) onStatusUpdate(`Scanning for payment... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
        } catch (e) { console.warn('[Polling] TRON scan error:', e.message); }
        
        await new Promise(r => setTimeout(r, CONFIG.POLLING.INTERVAL_MS));
    }
    return null;
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
            <button id="closeModal" class="mt-4 text-gray-500 text-sm hidden">Close</button>
        </div>
    `);
}

function showNetworkSelectionModal(preferredNetwork) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl w-80 text-center">
                <h3 class="font-bold mb-4">Choose Network</h3>
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-3 flex items-center justify-center gap-2">
                    🟡 BSC (BEP-20) ${preferredNetwork === 'BSC' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded flex items-center justify-center gap-2">
                    🔴 TRON (TRC-20) ${preferredNetwork === 'TRON' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="cancel" class="mt-4 text-gray-500 text-sm">Cancel</button>
            </div>
        `);
        modal.querySelector('#bsc').onclick = () => { modal.remove(); resolve('BSC'); };
        modal.querySelector('#tron').onclick = () => { modal.remove(); resolve('TRON'); };
        modal.querySelector('#cancel').onclick = () => { modal.remove(); resolve(null); };
    });
}

function showBSCPaymentOptionsModal() {
    return new Promise((resolve) => {
        const isMobile = isMobileDevice();
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
                <h3 class="font-bold mb-3 text-lg">💳 BSC Payment</h3>
                <p class="text-sm text-gray-600 mb-4">
                    ${isMobile 
                        ? 'Connect your mobile wallet to complete the payment:' 
                        : 'Choose how you\'d like to complete your payment:'}
                </p>
                <button id="useWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>🔗</span> ${isMobile ? 'Connect Wallet App' : 'Connect via WalletConnect'}
                </button>
                <button id="useQR" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>📱</span> Pay via QR Code
                </button>
                <p class="text-xs text-gray-500 mt-3 mb-2">
                    ${isMobile 
                        ? 'Supported wallets: MetaMask, Trust Wallet, SafePal, etc.' 
                        : 'Scan QR code with your mobile wallet'}
                </p>
                <button id="goBack" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded mt-2">← Back</button>
            </div>
        `);
        
        modal.querySelector('#useWalletConnect').onclick = () => { modal.remove(); resolve('walletconnect'); };
        modal.querySelector('#useQR').onclick = () => { modal.remove(); resolve('qr'); };
        modal.querySelector('#goBack').onclick = () => { modal.remove(); resolve('back'); };
    });
}

function showDesktopWalletModal() {
    // Redirect to the new unified modal
    return showBSCPaymentOptionsModal();
}

function showManualPaymentModal(network, recipient, amount) {
    return new Promise((resolve) => {
        let pollingStopped = false;
        const qrId = `${network.toLowerCase()}QR`;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw]">
                <h3 class="font-bold mb-3">${network} USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (${network === 'BSC' ? 'BEP-20' : 'TRC-20'}) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="${qrId}" class="mx-auto mb-3"></div>
                <p class="text-xs text-red-500 mb-2">⚠️ Send only USDT on ${network} network</p>
                <button id="copyAddress" class="text-blue-500 text-xs mb-3">📋 Copy Address</button>
                <div id="pollingStatus" class="text-xs text-gray-500 mb-2">
                    <div class="loading-spinner mx-auto mb-2" style="width:20px;height:20px;border-width:2px;"></div>
                    <span id="pollingText">Waiting for payment...</span>
                </div>
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2">✅ I've Paid</button>
                </div>
                <button id="closeManual" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm">Cancel</button>
            </div>
        `);

        generateQR(recipient, qrId);

        // Start auto-polling
        const pollingTextEl = modal.querySelector('#pollingText');
        const pollFn = network === 'BSC' ? pollForBSCPayment : pollForTronPayment;
        
        pollFn(recipient, amount, (status) => {
            if (pollingTextEl && !pollingStopped) pollingTextEl.textContent = status;
        }).then((txHash) => {
            if (txHash && !pollingStopped) {
                pollingStopped = true;
                modal.remove();
                resolve({ success: true, manual: true, txHash, explorerUrl: `${network === 'BSC' ? CONFIG.BSC.EXPLORER : CONFIG.TRON.EXPLORER}${txHash}`, autoDetected: true });
            }
        }).catch(console.warn);

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    modal.querySelector('#copyAddress').textContent = '✅ Copied!';
                    setTimeout(() => modal.querySelector('#copyAddress').textContent = '📋 Copy Address', 2000);
                })
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            if (!txHash && !confirm('No transaction hash entered. Are you sure you have already sent the payment?')) return;
            
            pollingStopped = true;
            modal.remove();
            
            const hashPattern = network === 'BSC' ? /^0x[a-fA-F0-9]{64}$/ : /^[a-fA-F0-9]{64}$/;
            if (txHash && hashPattern.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${network === 'BSC' ? CONFIG.BSC.EXPLORER : CONFIG.TRON.EXPLORER}${txHash}` });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeManual').onclick = () => { 
            pollingStopped = true;
            modal.remove(); 
            resolve({ success: false, cancelled: true }); 
        };
    });
}

function updateStatus(modal, text) {
    const el = modal.querySelector('#statusText');
    if (el) el.textContent = text;
}

function successStatus(modal, txHash, explorerUrl) {
    updateStatus(modal, '✅ Payment confirmed');
    modal.querySelector('.loading-spinner')?.remove();
    const txLink = modal.querySelector('#txLink');
    if (txLink) {
        const link = txLink.querySelector('a');
        if (link) link.href = explorerUrl;
        txLink.classList.remove('hidden');
    }
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, error) {
    updateStatus(modal, `❌ ${error.message || 'Payment failed'}`);
    modal.querySelector('.loading-spinner')?.remove();
    modal.querySelector('#closeModal')?.classList.remove('hidden');
}

// ======================================================
// 🚀  MAIN ENTRY POINTS
// ======================================================

async function initiateCryptoPayment(participantId, voteCount, amount) {
    // Ensure initialized
    if (!isInitialized) await ensureInitialized();
    
    let modal = null;
    
    try {
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        const preferredNetwork = await detectPreferredNetwork();
        const selectedNetwork = await showNetworkSelectionModal(preferredNetwork);
        if (!selectedNetwork) return { success: false, cancelled: true };
        
        const recipient = selectedNetwork === 'BSC' ? CONFIG.BSC.WALLET_ADDRESS : CONFIG.TRON.WALLET_ADDRESS;
        
        if (selectedNetwork === 'BSC') {
            // BSC: Always use WalletConnect or QR code for both mobile and desktop
            const choice = await showBSCPaymentOptionsModal();
            
            if (choice === 'back') return initiateCryptoPayment(participantId, voteCount, amount);
            
            if (choice === 'qr') {
                const result = await showManualPaymentModal(selectedNetwork, recipient, amount);
                if (result.success && result.txHash) {
                    try { await finalizePayment(result.txHash, selectedNetwork); } catch (e) { console.warn('[Payment] Finalization error:', e); }
                    trackEvent('payment_completed', { participantId, network: selectedNetwork, manual: true, autoDetected: result.autoDetected || false });
                }
                return result;
            }
            
            if (choice === 'walletconnect') {
                modal = showPaymentStatusModal(selectedNetwork, amount);
                
                if (isMobileDevice()) {
                    updateStatus(modal, 'Opening wallet app...');
                } else {
                    updateStatus(modal, 'Scan QR code with your wallet...');
                }
                
                try {
                    const provider = await connectWithWalletConnect();
                    updateStatus(modal, 'Connected! Sending transaction...');
                    
                    const result = await executeBSCTransfer(provider, recipient, amount);
                    updateStatus(modal, 'Confirming transaction...');
                    
                    await finalizePayment(result.txHash, selectedNetwork);
                    successStatus(modal, result.txHash, result.explorerUrl);
                    trackEvent('payment_completed', { 
                        participantId, 
                        network: selectedNetwork, 
                        method: 'walletconnect',
                        isMobile: isMobileDevice()
                    });
                    return { success: true, ...result };
                } catch (wcError) {
                    console.error('[WalletConnect] Payment failed:', wcError);
                    errorStatus(modal, wcError);
                    
                    // Offer fallback to QR code
                    if (confirm('Wallet connection failed. Would you like to pay via QR code instead?')) {
                        modal.remove();
                        const result = await showManualPaymentModal(selectedNetwork, recipient, amount);
                        if (result.success && result.txHash) {
                            try { await finalizePayment(result.txHash, selectedNetwork); } catch (e) { console.warn('[Payment] Finalization error:', e); }
                            trackEvent('payment_completed', { participantId, network: selectedNetwork, manual: true, fallback: true });
                        }
                        return result;
                    }
                    return { success: false, error: wcError.message };
                }
            }
            
            return { success: false, cancelled: true };
            
        } else if (selectedNetwork === 'TRON') {
            // TRON: Check for TronLink wallet, otherwise show manual payment
            const hasWallet = window.tronWeb?.ready;
            
            if (!hasWallet) {
                const result = await showManualPaymentModal(selectedNetwork, recipient, amount);
                if (result.success && result.txHash) {
                    try { await finalizePayment(result.txHash, selectedNetwork); } catch (e) { console.warn('[Payment] Finalization error:', e); }
                    trackEvent('payment_completed', { participantId, network: selectedNetwork, manual: true, autoDetected: result.autoDetected || false });
                }
                return result;
            }
            
            modal = showPaymentStatusModal(selectedNetwork, amount);
            updateStatus(modal, 'Confirm in TronLink...');
            const result = await executeTronTransfer(recipient, amount);
            updateStatus(modal, 'Finalizing...');
            await finalizePayment(result.txHash, selectedNetwork);
            successStatus(modal, result.txHash, result.explorerUrl);
            trackEvent('payment_completed', { participantId, network: selectedNetwork, method: 'tronlink' });
            return { success: true, ...result };
        }
        
        return { success: false, error: 'Invalid network selected' };
        
    } catch (error) {
        console.error('[CryptoPayment] Error:', error);
        if (modal) errorStatus(modal, error);
        else alert(error.message || 'Payment failed. Please try again.');
        trackEvent('payment_error', { error: error.message, code: error.code, participantId, isMobile: isMobileDevice() });
        return { success: false, error: error.message };
    }
}

// Legacy compatibility function
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;
    const amount = window.selectedPaymentAmount || voteCount * 0.5; // Fallback calculation
    
    if (!participantId || !voteCount) {
        console.error('[Payment] Missing participant or vote count');
        return { success: false, error: 'Missing payment details' };
    }
    
    return initiateCryptoPayment(participantId, voteCount, amount);
}

// ======================================================
// 🏁  INITIALIZATION
// ======================================================

async function ensureInitialized() {
    if (isInitialized) return true;
    if (initializationError) throw initializationError;
    if (initializationPromise) return initializationPromise;
    
    initializationPromise = (async () => {
        try {
            await loadEthersJS();
            isInitialized = true;
            initializationError = null;
            console.log('🔒 Crypto Payments Module Ready');
            resolveReady(true);
            return true;
        } catch (error) {
            console.error('Initialization failed:', error);
            isInitialized = false;
            initializationError = error;
            rejectReady(error);
            throw error;
        }
    })();
    
    return initializationPromise;
}

// Check if module is ready (synchronous check)
function isReady() {
    return isInitialized && !initializationError;
}

// Wait for module to be ready (async)
async function whenReady(timeout = 10000) {
    if (isInitialized) return true;
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Crypto module initialization timeout')), timeout)
    );
    
    try {
        await Promise.race([readyPromise, timeoutPromise]);
        return true;
    } catch (error) {
        console.error('❌ Crypto module failed to initialize:', error);
        throw error;
    }
}

// Auto-initialize on load
(async function autoInit() {
    try {
        await ensureInitialized();
    } catch (error) {
        console.error('❌ Auto-initialization failed:', error);
        // Don't throw - let the page handle this gracefully
    }
})();

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.processCryptoPayment = processCryptoPayment;
window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    process: processCryptoPayment,
    showManualPaymentModal,
    showNetworkSelectionModal,
    ensureInitialized,
    whenReady,
    isReady,
    ready: readyPromise,
    CONFIG,
    ERROR_CODES
};

// Legacy support - some pages check for this
window.cryptoPaymentReady = readyPromise;

console.log('✅ Crypto Payments module loaded (initializing...)');