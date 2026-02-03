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

// ✅ Ensure Paystack fallback exists
if (typeof window.initiatePaystackPayment !== 'function') {
    window.initiatePaystackPayment = function() {
        console.warn('[Paystack] initiatePaystackPayment not defined - showing fallback');
        alert('Card payments are being set up. Please use crypto payment or QR code for now.');
        return false;
    };
}

// ✅ Config uses data attributes or hardcoded values
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

// Track payment attempts
// const paymentAttempts = new Map(); // REMOVED

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
    const attempts = getAttempts(participantId).filter(
        t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT
    );
    
    if (attempts.length >= CONFIG.LIMITS.MAX_RETRIES) {
        throw new PaymentError(
            'Too many payment attempts. Please try again later.',
            ERROR_CODES.RATE_LIMIT,
            { attempts: attempts.length }
        );
    }
    
    attempts.push(now);
    setAttempts(participantId, attempts);
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
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function waitForWalletProvider(timeout = 3000) {
    return new Promise((resolve) => {
        if (window.ethereum) {
            resolve(true);
            return;
        }
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.ethereum) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                resolve(false);
            }
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

function openWalletApp(walletType = 'metamask') {
    const currentUrl = encodeURIComponent(window.location.href);
    const deepLinks = {
        metamask: `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`,
        trustwallet: `https://link.trustwallet.com/open_url?coin_id=60&url=${currentUrl}`,
        tokenpocket: `tpoutside://open?params=${currentUrl}`,
    };
    return deepLinks[walletType] || deepLinks.metamask;
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
    img.style.width = '200px';
    img.style.height = '200px';
    
    const primaryUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}`;
    const secondaryUrl = `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=200`;
    const canvasUrl = generateQRCanvas(text);
    
    let attempts = 0;
    const urls = [primaryUrl, secondaryUrl, canvasUrl];
    
    img.onerror = () => {
        attempts++;
        if (attempts < urls.length) {
            console.warn(`[QR] Fallback ${attempts}: trying next source`);
            img.src = urls[attempts];
        }
    };
    
    img.src = urls[0];
    element.innerHTML = '';
    element.appendChild(img);
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const tronNetwork = await window.tronWeb.trx.getNodeInfo();
                if (tronNetwork && tronNetwork.net) return 'TRON';
            } catch (e) {
                console.debug('TRON detection error:', e);
            }
        }
        
        if (window.ethereum) {
            try {
                const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                if (chainId === '0x38') return 'BSC';
            } catch (e) {
                console.debug('BSC detection error:', e);
            }
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
            script.src = CONFIG.WALLETCONNECT.SRC;
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

function normalizeProvider(provider) {
    if (provider && typeof provider.request === 'function') {
        return provider;
    }
    if (provider && provider.provider && typeof provider.provider.request === 'function') {
        return provider.provider;
    }
    if (window.ethereum) {
        return window.ethereum;
    }
    throw new PaymentError('No valid provider found', ERROR_CODES.PROVIDER_ERROR);
}

function createEthersProvider(eip1193Provider) {
    if (typeof ethers === 'undefined') {
        throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
    }
    return new ethers.providers.Web3Provider(eip1193Provider);
}

async function connectWalletMobile() {
    try {
        console.debug('[WalletConnect] Loading SDK...');
        const EthereumProvider = await loadWalletConnect();
        
        console.debug('[WalletConnect] Initializing provider...');
        const provider = await EthereumProvider.init({
            projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
            chains: [CONFIG.BSC.CHAIN_ID],
            showQrModal: true,
            qrModalOptions: { 
                themeMode: 'dark',
                enableExplorer: true 
            },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment",
                url: window.location.origin,
                icons: [
                    `${window.location.origin}/images/logo.png`,
                    `${window.location.origin}/favicon.ico`
                ].filter(Boolean)
            }
        });
        
        console.debug('[WalletConnect] Connecting...');
        await provider.connect();
        
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (chainId !== `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`) {
            console.warn('[WalletConnect] Wrong chain detected:', chainId);
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}` }]
                });
            } catch (switchError) {
                throw new PaymentError(
                    'Please switch to BSC network in your wallet',
                    ERROR_CODES.NETWORK_ERROR,
                    { currentChain: chainId, requiredChain: '0x38' }
                );
            }
        }
        
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts returned from WalletConnect');
        }
        
        console.debug('[WalletConnect] Connected:', accounts[0]);
        return provider;
    } catch (error) {
        console.error('[WalletConnect] Error:', error);
        throw new PaymentError(
            error.message || 'Failed to connect via WalletConnect',
            ERROR_CODES.WALLET_ERROR,
            { originalError: error }
        );
    }
}

async function ensureBSCNetworkDesktop(eip1193Provider) {
    if (isMobileDevice()) {
        console.debug('[Network] Skipping network switch on mobile');
        return;
    }
    
    try {
        const chainId = await eip1193Provider.request({ method: 'eth_chainId' });
        const targetChainId = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
        
        if (chainId !== targetChainId) {
            try {
                await eip1193Provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetChainId }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await eip1193Provider.request({
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
                    throw switchError;
                }
            }
        }
    } catch (error) {
        console.warn('[Network] Switch failed:', error.message);
    }
}

// ======================================================
// 🏦  PAYMENT PROCESSING
// ======================================================

async function initializeCryptoPaymentBackend(participantId, voteCount, network) {
    try {
        trackEvent('payment_initiated', { participantId, voteCount, network });
        
        const response = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                network: network.toLowerCase()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new PaymentError(
                errorData.message || 'Backend initialization failed',
                ERROR_CODES.NETWORK_ERROR,
                { status: response.status, ...errorData }
            );
        }

        return await response.json();
    } catch (error) {
        throw new PaymentError(
            error.message || 'Payment initialization failed',
            ERROR_CODES.NETWORK_ERROR,
            { originalError: error }
        );
    }
}

async function executeBSCTransferUnified(eip1193Provider, recipient, amount) {
    try {
        console.debug('[BSC Transfer] Starting unified transfer');
        
        const accounts = await eip1193Provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        console.debug('[BSC Transfer] From:', from);
        
        if (typeof ethers === 'undefined') {
            throw new PaymentError('Ethers.js not loaded', ERROR_CODES.DEPENDENCY_ERROR);
        }
        
        const BSC_USDT_DECIMALS = 18;
        const amountWei = ethers.utils.parseUnits(amount.toString(), BSC_USDT_DECIMALS);
        
        const iface = new ethers.utils.Interface([
            "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
        
        console.debug('[BSC Transfer] Sending transaction...');
        
        const txHash = await eip1193Provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.BSC.USDT_ADDRESS,
                data: data
            }]
        });
        
        console.debug('[BSC Transfer] TX Hash:', txHash);
        
        return {
            txHash: txHash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}`
        };
    } catch (error) {
        console.error('[BSC Transfer] Error:', error);
        
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR);
        }
        
        throw new PaymentError(
            error.message || 'BSC transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function executeTronTransfer(recipient, amount) {
    try {
        if (!window.tronWeb || !window.tronWeb.ready) {
            throw new PaymentError('TronWeb not available', ERROR_CODES.PROVIDER_ERROR);
        }

        const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
        
        const TRON_USDT_DECIMALS = 6;
        const amountSun = Math.floor(amount * Math.pow(10, TRON_USDT_DECIMALS));
        
        const tx = await contract.transfer(recipient, amountSun).send();

        if (!tx || !tx.transaction || !tx.transaction.txID) {
            throw new PaymentError('TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
        }

        return {
            txHash: tx.transaction.txID,
            network: 'TRON',
            explorerUrl: `${CONFIG.TRON.EXPLORER}${tx.transaction.txID}`
        };
    } catch (error) {
        throw new PaymentError(
            error.message || 'TRON transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function finalizePayment(txHash, network) {
    try {
        const response = await fetch('/api/onedream/finalize-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transaction_hash: txHash,
                network: network.toLowerCase()
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new PaymentError(
                errorData.message || 'Payment finalization failed',
                ERROR_CODES.NETWORK_ERROR,
                { status: response.status, ...errorData }
            );
        }

        return await response.json();
    } catch (error) {
        throw new PaymentError(
            error.message || 'Payment finalization failed',
            ERROR_CODES.NETWORK_ERROR,
            { originalError: error }
        );
    }
}

// ======================================================
// 🔄  AUTO-POLLING FOR MANUAL PAYMENTS
// ======================================================

async function pollForBSCPayment(recipient, expectedAmount, onStatusUpdate) {
    const startTime = Date.now();
    
    if (typeof ethers === 'undefined') {
        console.warn('[Polling] Ethers.js not available, skipping auto-detection');
        return null;
    }
    
    const BSC_USDT_DECIMALS = 18;
    const expectedWei = ethers.utils.parseUnits(expectedAmount.toString(), BSC_USDT_DECIMALS);
    
    console.debug('[Polling] Starting BSC payment detection for', expectedAmount, 'USDT to', recipient);
    
    while (Date.now() - startTime < CONFIG.POLLING.TIMEOUT_MS) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(CONFIG.BSC.RPC_URL);
            
            // Get recent blocks to check for transfers
            const currentBlock = await provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 100); // Last ~100 blocks (~5 mins)
            
            // Create contract interface for USDT
            const usdtContract = new ethers.Contract(
                CONFIG.BSC.USDT_ADDRESS,
                ['event Transfer(address indexed from, address indexed to, uint256 value)'],
                provider
            );
            
            // Query transfer events to our wallet
            const filter = usdtContract.filters.Transfer(null, recipient);
            const events = await usdtContract.queryFilter(filter, fromBlock, currentBlock);
            
            for (const event of events.reverse()) {
                const transferAmount = event.args.value;
                // Check if amount matches (with small tolerance for fees)
                if (transferAmount.gte(expectedWei.mul(99).div(100))) {
                    console.debug('[Polling] Found matching BSC transaction:', event.transactionHash);
                    return event.transactionHash;
                }
            }
            
            if (onStatusUpdate) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                onStatusUpdate(`Scanning for payment... (${elapsed}s)`);
            }
            
        } catch (e) {
            console.warn('[Polling] BSC scan error:', e.message);
        }
        
        await new Promise(r => setTimeout(r, CONFIG.POLLING.INTERVAL_MS));
    }
    
    return null;
}

async function pollForTronPayment(recipient, expectedAmount, onStatusUpdate) {
    const startTime = Date.now();
    const TRON_USDT_DECIMALS = 6;
    const expectedSun = Math.floor(expectedAmount * Math.pow(10, TRON_USDT_DECIMALS));
    
    console.debug('[Polling] Starting TRON payment detection for', expectedAmount, 'USDT to', recipient);
    
    while (Date.now() - startTime < CONFIG.POLLING.TIMEOUT_MS) {
        try {
            // Use TronGrid API to check for transfers
            const response = await fetch(
                `https://api.trongrid.io/v1/accounts/${recipient}/transactions/trc20?limit=20&contract_address=${CONFIG.TRON.USDT_ADDRESS}`
            );
            
            if (response.ok) {
                const data = await response.json();
                const transactions = data.data || [];
                
                for (const tx of transactions) {
                    if (tx.to === recipient && tx.type === 'Transfer') {
                        const txAmount = parseInt(tx.value || '0');
                        // Check if amount matches (with small tolerance)
                        if (txAmount >= expectedSun * 0.99) {
                            console.debug('[Polling] Found matching TRON transaction:', tx.transaction_id);
                            return tx.transaction_id;
                        }
                    }
                }
            }
            
            if (onStatusUpdate) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                onStatusUpdate(`Scanning for payment... (${elapsed}s)`);
            }
            
        } catch (e) {
            console.warn('[Polling] TRON scan error:', e.message);
        }
        
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
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-3 flex items-center justify-center gap-2 transition-colors">
                    <span>🟡</span> BSC (BEP-20)
                    ${preferredNetwork === 'BSC' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded flex items-center justify-center gap-2 transition-colors">
                    <span>🔴</span> TRON (TRC-20)
                    ${preferredNetwork === 'TRON' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="cancel" class="mt-4 text-gray-500 text-sm">Cancel</button>
            </div>
        `);

        modal.querySelector('#bsc').onclick = () => { modal.remove(); resolve('BSC'); };
        modal.querySelector('#tron').onclick = () => { modal.remove(); resolve('TRON'); };
        modal.querySelector('#cancel').onclick = () => { modal.remove(); resolve(null); };

        if (preferredNetwork) {
            setTimeout(() => {
                const el = modal.querySelector(`#${preferredNetwork.toLowerCase()}`);
                if (el) el.classList.add('ring-2', 'ring-blue-500');
            }, 100);
        }
    });
}

function showDesktopWalletModal() {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
                <h3 class="font-bold mb-3 text-lg">📱 Connect Your Wallet</h3>
                <p class="text-sm text-gray-600 mb-4">Choose how you'd like to complete your payment:</p>
                <button id="useWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>🔗</span> Connect via WalletConnect
                </button>
                <button id="useQR" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>📱</span> Pay via QR Code
                </button>
                <button id="goBack" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded mt-2">← Back</button>
            </div>
        `);

        modal.querySelector('#useWalletConnect').onclick = () => { modal.remove(); resolve('walletconnect'); };
        modal.querySelector('#useQR').onclick = () => { modal.remove(); resolve('qr'); };
        modal.querySelector('#goBack').onclick = () => { modal.remove(); resolve('back'); };
    });
}

function showBSCManualModal(recipient, amount) {
    return new Promise((resolve) => {
        let isPolling = false;
        let pollingStopped = false;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw]">
                <h3 class="font-bold mb-3">BSC USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (BEP-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="bscQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-red-500 mb-2">⚠️ Send only USDT on BSC network</p>
                <button id="copyAddress" class="text-blue-500 text-xs mb-3">📋 Copy Address</button>
                <div id="pollingStatus" class="text-xs text-gray-500 mb-2 hidden">
                    <div class="loading-spinner mx-auto mb-2" style="width:20px;height:20px;border-width:2px;"></div>
                    <span id="pollingText">Waiting for payment...</span>
                </div>
                <div class="border-t pt-3 mt-3">
                    <p class="text-xs text-gray-500 mb-2">Already sent payment?</p>
                    <input type="text" id="txHashInput" placeholder="Paste transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2" />
                    <button id="confirmPayment" class="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-sm mb-2">✅ I've Paid</button>
                </div>
                <button id="closeBSC" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm">Cancel</button>
            </div>
        `);

        generateQR(recipient, 'bscQR');

        // Start auto-polling in background
        const pollingStatusEl = modal.querySelector('#pollingStatus');
        const pollingTextEl = modal.querySelector('#pollingText');
        
        if (typeof ethers !== 'undefined') {
            pollingStatusEl.classList.remove('hidden');
            isPolling = true;
            
            pollForBSCPayment(recipient, amount, (status) => {
                if (pollingTextEl && !pollingStopped) pollingTextEl.textContent = status;
            }).then((txHash) => {
                if (txHash && !pollingStopped) {
                    pollingStopped = true;
                    modal.remove();
                    resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}`, autoDetected: true });
                }
            }).catch(console.warn);
        }

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    modal.querySelector('#copyAddress').textContent = '✅ Copied!';
                    setTimeout(() => { modal.querySelector('#copyAddress').textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm('No transaction hash entered. Are you sure you have already sent the payment?')) {
                    return;
                }
            }
            
            pollingStopped = true;
            modal.remove();
            if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeBSC').onclick = () => { 
            pollingStopped = true;
            modal.remove(); 
            resolve({ success: false, cancelled: true }); 
        };
    });
}

function showTronManualModal(recipient, amount) {
    return new Promise((resolve) => {
        let pollingStopped = false;
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw]">
                <h3 class="font-bold mb-3">TRON USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (TRC-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="tronQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-red-500 mb-2">⚠️ Send only USDT on TRON network</p>
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
                <button id="closeTron" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded text-sm">Cancel</button>
            </div>
        `);

        generateQR(recipient, 'tronQR');

        // Start auto-polling in background
        const pollingTextEl = modal.querySelector('#pollingText');
        
        pollForTronPayment(recipient, amount, (status) => {
            if (pollingTextEl && !pollingStopped) pollingTextEl.textContent = status;
        }).then((txHash) => {
            if (txHash && !pollingStopped) {
                pollingStopped = true;
                modal.remove();
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}`, autoDetected: true });
            }
        }).catch(console.warn);

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    modal.querySelector('#copyAddress').textContent = '✅ Copied!';
                    setTimeout(() => { modal.querySelector('#copyAddress').textContent = '📋 Copy Address'; }, 2000);
                })
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#confirmPayment').onclick = () => {
            const txHash = modal.querySelector('#txHashInput').value.trim();
            
            if (!txHash) {
                if (!confirm('No transaction hash entered. Are you sure you have already sent the payment?')) {
                    return;
                }
            }
            
            pollingStopped = true;
            modal.remove();
            if (txHash && /^[a-fA-F0-9]{64}$/.test(txHash)) {
                resolve({ success: true, manual: true, txHash, explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` });
            } else {
                resolve({ success: false, manual: true, pendingConfirmation: true });
            }
        };

        modal.querySelector('#closeTron').onclick = () => { 
            pollingStopped = true;
            modal.remove(); 
            resolve({ success: false, cancelled: true }); 
        };
    });
}

function updateStatus(modal, text) {
    const element = modal.querySelector('#statusText');
    if (element) element.textContent = text;
}

function successStatus(modal, txHash, explorerUrl) {
    updateStatus(modal, '✅ Payment confirmed');
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
    
    const txLink = modal.querySelector('#txLink');
    if (txLink) {
        const link = txLink.querySelector('a');
        if (link) link.href = explorerUrl;
        txLink.classList.remove('hidden');
    }
    
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, error) {
    let message = error.message || 'Payment failed';
    if (error.message && error.message.includes('ethers.BrowserProvider')) {
        message = 'Wallet connection error - please refresh and try again';
    }
    updateStatus(modal, `❌ ${message}`);
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) spinner.remove();
    const closeBtn = modal.querySelector('#closeModal');
    if (closeBtn) closeBtn.classList.remove('hidden');
}

// ======================================================
// 🚀  MAIN ENTRY POINT
// ======================================================

async function initiateCryptoPayment(participantId, voteCount, amount) {
    let modal = null;
    
    try {
        // Validate inputs
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);
        
        // Detect preferred network
        const preferredNetwork = await detectPreferredNetwork();
        
        // Show network selection
        const selectedNetwork = await showNetworkSelectionModal(preferredNetwork);
        if (!selectedNetwork) {
            return { success: false, cancelled: true };
        }
        
        // Get wallet address based on network
        const recipient = selectedNetwork === 'BSC' 
            ? CONFIG.BSC.WALLET_ADDRESS 
            : CONFIG.TRON.WALLET_ADDRESS;
        
        // Check for wallet availability
        const hasWallet = selectedNetwork === 'BSC' 
            ? await waitForWalletProvider(2000)
            : (window.tronWeb && window.tronWeb.ready);
        
        if (!hasWallet) {
            // No wallet detected - show options
            const choice = await showDesktopWalletModal();
            
            if (choice === 'back') {
                return initiateCryptoPayment(participantId, voteCount, amount);
            }
            
            if (choice === 'qr') {
                // Show manual payment modal with auto-polling
                let result;
                if (selectedNetwork === 'BSC') {
                    result = await showBSCManualModal(recipient, amount);
                } else {
                    result = await showTronManualModal(recipient, amount);
                }
                
                // If payment was detected/confirmed, finalize it
                if (result.success && result.txHash) {
                    try {
                        await finalizePayment(result.txHash, selectedNetwork);
                        trackEvent('payment_completed', { 
                            participantId, 
                            network: selectedNetwork, 
                            manual: true,
                            autoDetected: result.autoDetected || false
                        });
                    } catch (e) {
                        console.warn('[Payment] Finalization error:', e);
                    }
                }
                
                return result;
            }
            
            if (choice === 'walletconnect' && selectedNetwork === 'BSC') {
                // Use WalletConnect
                modal = showPaymentStatusModal(selectedNetwork, amount);
                updateStatus(modal, 'Connecting wallet...');
                
                const provider = await connectWalletMobile();
                updateStatus(modal, 'Sending transaction...');
                
                const result = await executeBSCTransferUnified(provider, recipient, amount);
                
                updateStatus(modal, 'Finalizing...');
                await finalizePayment(result.txHash, selectedNetwork);
                
                successStatus(modal, result.txHash, result.explorerUrl);
                trackEvent('payment_completed', { participantId, network: selectedNetwork, method: 'walletconnect' });
                return { success: true, ...result };
            }
            
            return { success: false, cancelled: true };
        }
        
        // Wallet is available - proceed with transaction
        modal = showPaymentStatusModal(selectedNetwork, amount);
        
        if (selectedNetwork === 'BSC') {
            updateStatus(modal, 'Connecting wallet...');
            
            const connected = await requestWalletConnection();
            if (!connected) {
                throw new PaymentError('Failed to connect wallet', ERROR_CODES.WALLET_ERROR);
            }
            
            await ensureBSCNetworkDesktop(window.ethereum);
            
            updateStatus(modal, 'Confirm in wallet...');
            const result = await executeBSCTransferUnified(window.ethereum, recipient, amount);
            
            updateStatus(modal, 'Finalizing...');
            await finalizePayment(result.txHash, selectedNetwork);
            
            successStatus(modal, result.txHash, result.explorerUrl);
            trackEvent('payment_completed', { participantId, network: selectedNetwork, method: 'direct' });
            return { success: true, ...result };
            
        } else if (selectedNetwork === 'TRON') {
            updateStatus(modal, 'Confirm in wallet...');
            const result = await executeTronTransfer(recipient, amount);
            
            updateStatus(modal, 'Finalizing...');
            await finalizePayment(result.txHash, selectedNetwork);
            
            successStatus(modal, result.txHash, result.explorerUrl);
            trackEvent('payment_completed', { participantId, network: selectedNetwork, method: 'direct' });
            return { success: true, ...result };
        }
        
    } catch (error) {
        console.error('[CryptoPayment] Error:', error);
        
        if (modal) {
            errorStatus(modal, error);
        } else {
            alert(error.message || 'Payment failed. Please try again.');
        }
        
        trackEvent('payment_error', { 
            error: error.message, 
            code: error.code,
            participantId 
        });
        
        return { success: false, error: error.message };
    }
}

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    showBSCManualModal,
    showTronManualModal,
    showNetworkSelectionModal,
    CONFIG,
    ERROR_CODES
};

console.log('✅ Crypto Payments module loaded with auto-polling');