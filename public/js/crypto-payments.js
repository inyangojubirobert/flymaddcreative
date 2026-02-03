// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

// Check if we're in a browser environment
if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// ✅ FIXED: Use inline config (env vars are build-time in Next.js, not runtime)
// These should be injected by your HTML template or Next.js at build time
const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        RPC_URL: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: 56,
        EXPLORER: "https://bscscan.com/tx/",
        // ✅ FIXED: Hardcode or inject via script tag data attributes
        WALLET_ADDRESS: document.querySelector('script[data-bsc-wallet]')?.dataset.bscWallet 
            || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/",
        // ✅ FIXED: No API key in frontend - use server-side proxy
        WALLET_ADDRESS: document.querySelector('script[data-tron-wallet]')?.dataset.tronWallet 
            || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: "61d9b98f81731dffa9988c0422676fc5"
    },
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000,
        ATTEMPT_TIMEOUT: 5 * 60 * 1000
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
        
        // Maintain proper stack trace
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
    const recentAttempts = attempts.filter(t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT);
    
    if (recentAttempts.length >= CONFIG.LIMITS.MAX_RETRIES) {
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
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Wait for wallet provider to be injected (mobile apps inject after page load)
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

// Request wallet connection (required for mobile wallets)
async function requestWalletConnection() {
    if (!window.ethereum) {
        return false;
    }
    
    try {
        const accounts = await window.ethereum.request({ 
            method: 'eth_requestAccounts' 
        });
        return accounts && accounts.length > 0;
    } catch (error) {
        console.warn('[Wallet] Connection request failed:', error.message);
        return false;
    }
}

// Deep link to wallet app on mobile
function openWalletApp(walletType = 'metamask') {
    const currentUrl = encodeURIComponent(window.location.href);
    
    const deepLinks = {
        metamask: `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`,
        trustwallet: `https://link.trustwallet.com/open_url?coin_id=60&url=${currentUrl}`,
        tokenpocket: `tpoutside://open?params=${currentUrl}`,
    };
    
    return deepLinks[walletType] || deepLinks.metamask;
}

// ======================================================
// 🌐  NETWORK & WALLET MANAGEMENT (FIXED)
// ======================================================

async function detectPreferredNetwork() {
    try {
        // Check for TRON first
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const tronNetwork = await window.tronWeb.trx.getNodeInfo();
                if (tronNetwork && tronNetwork.net) return 'TRON';
            } catch (e) {
                console.debug('TRON detection error:', e);
            }
        }
        
        // Then check for BSC
        if (window.ethereum) {
            try {
                const chainId = await window.ethereum.request({ method: 'eth_chainId' });
                if (chainId === '0x38') return 'BSC'; // BSC mainnet
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
                icons: [`${window.location.origin}/images/logo.png`]
            }
        });
        
        console.debug('[WalletConnect] Connecting...');
        await provider.connect();
        
        // ✅ FIXED: Use EIP-1193 method directly, not ethers wrapper
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

// ✅ FIXED: Desktop only - never call on mobile
async function ensureBSCNetworkDesktop(provider) {
    if (isMobileDevice()) {
        console.debug('[Network] Skipping network switch on mobile');
        return;
    }
    
    try {
        const network = await provider.getNetwork();
        const chainId = network.chainId;
        
        if (chainId !== CONFIG.BSC.CHAIN_ID) {
            await provider.provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}` }]
            });
        }
    } catch (switchError) {
        if (switchError.code === 4902) {
            await provider.provider.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`,
                    chainName: 'Binance Smart Chain',
                    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                    rpcUrls: [CONFIG.BSC.RPC_URL],
                    blockExplorerUrls: ['https://bscscan.com/']
                }]
            });
        } else {
            throw new PaymentError(
                'Failed to switch to BSC network',
                ERROR_CODES.NETWORK_ERROR,
                { originalError: switchError }
            );
        }
    }
}

// ======================================================
// 🏦  PAYMENT PROCESSING (FIXED)
// ======================================================

async function initializeCryptoPayment(participantId, voteCount, network) {
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

// ✅ NEW: Mobile-safe BSC transfer using raw eth_sendTransaction
async function executeBSCTransferMobile(provider, recipient, amount) {
    try {
        console.debug('[Mobile BSC] Executing transfer via eth_sendTransaction');
        
        // Get account using EIP-1193
        const accounts = await provider.request({ method: 'eth_accounts' });
        const from = accounts[0];
        
        if (!from) {
            throw new PaymentError('No wallet account connected', ERROR_CODES.WALLET_ERROR);
        }
        
        // Encode transfer function data manually
        const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
        const iface = new ethers.utils.Interface([
            "function transfer(address to, uint256 amount) returns (bool)"
        ]);
        const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
        
        // ✅ Use raw eth_sendTransaction - works on ALL mobile wallets
        const txHash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{
                from: from,
                to: CONFIG.BSC.USDT_ADDRESS,
                data: data,
                // Let wallet estimate gas
            }]
        });
        
        console.debug('[Mobile BSC] Transaction sent:', txHash);
        
        return {
            txHash: txHash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}`
        };
    } catch (error) {
        // Handle user rejection
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
            throw new PaymentError('Transaction rejected by user', ERROR_CODES.WALLET_ERROR, { originalError: error });
        }
        throw new PaymentError(
            error.message || 'Mobile BSC transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

// ✅ FIXED: Desktop transfer using ethers.Contract (safe on desktop)
async function executeBSCTransferDesktop(signer, recipient, amount) {
    try {
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new PaymentError('Transaction timeout', ERROR_CODES.TIMEOUT)), 
            CONFIG.LIMITS.TIMEOUT_MS)
        );

        const usdtContract = new ethers.Contract(
            CONFIG.BSC.USDT_ADDRESS,
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
        const tx = await usdtContract.transfer(recipient, amountWei);
        
        const receipt = await Promise.race([
            tx.wait(),
            timeoutPromise
        ]);

        if (!receipt) {
            throw new PaymentError('Transaction receipt not found', ERROR_CODES.TRANSACTION_ERROR);
        }

        return {
            txHash: tx.hash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${tx.hash}`
        };
    } catch (error) {
        throw new PaymentError(
            error.message || 'Desktop BSC transfer failed',
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
        const amountSun = Math.floor(amount * 1_000_000);
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
// 🧩  UI COMPONENTS (FIXED QR)
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
                <span class="text-xs bg-gray-100 px-2 py-1 rounded">${
                    network === 'BSC' ? 'BEP-20' : 'TRC-20'
                }</span>
            </div>
            <div class="text-2xl font-bold mb-4">${amount} USDT</div>
            <div id="statusText" class="min-h-6 mb-4">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden">
                <a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500">
                    View on explorer
                </a>
            </div>
            <button id="closeModal" class="mt-4 text-gray-500 text-sm">Close</button>
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
                modal.querySelector(`#${preferredNetwork.toLowerCase()}`)
                    .classList.add('ring-2', 'ring-blue-500');
            }, 100);
        }
    });
}

function showNoWalletDetectedModal() {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
                <h3 class="font-bold mb-3 text-lg">📱 Connect Your Wallet</h3>
                <p class="text-sm text-gray-600 mb-4">
                    Choose how you'd like to complete your payment:
                </p>
                <button id="useWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>🔗</span> Connect via WalletConnect
                </button>
                <button id="useQR" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2 flex items-center justify-center gap-2">
                    <span>📱</span> Pay via QR Code
                </button>
                <button id="goBack" class="w-full bg-gray-200 hover:bg-gray-300 py-2 rounded mt-2">
                    ← Back
                </button>
            </div>
        `);

        modal.querySelector('#useWalletConnect').onclick = () => {
            modal.remove();
            resolve('walletconnect');
        };

        modal.querySelector('#useQR').onclick = () => {
            modal.remove();
            resolve('qr');
        };

        modal.querySelector('#goBack').onclick = () => {
            modal.remove();
            resolve('back');
        };
    });
}

// ✅ FIXED: Simple address QR - not ERC-20 URI (more compatible)
function showBSCManualModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80">
                <h3 class="font-bold mb-3">BSC USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (BEP-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="bscQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-gray-500 mb-2">Network: BSC (BNB Smart Chain)</p>
                <p class="text-xs text-red-500 mb-3">⚠️ Send only USDT BEP-20</p>
                <button id="copyAddress" class="mt-2 text-blue-500 text-xs">📋 Copy Address</button>
                <button id="closeBSC" class="mt-4 px-4 py-2 bg-gray-200 rounded block w-full">Done</button>
            </div>
        `);

        // ✅ FIXED: Simple address QR - wallets handle it better
        generateQR(recipient, 'bscQR');

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    modal.querySelector('#copyAddress').textContent = '✅ Copied!';
                    setTimeout(() => {
                        modal.querySelector('#copyAddress').textContent = '📋 Copy Address';
                    }, 2000);
                })
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#closeBSC').onclick = () => {
            modal.remove();
            resolve({ success: false, manual: true });
        };
    });
}

// ✅ FIXED: Simple address QR for TRON
function showTronManualModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80">
                <h3 class="font-bold mb-3">TRON USDT Payment</h3>
                <p class="text-sm mb-2">Send <strong>${amount} USDT</strong> (TRC-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div>
                <div id="tronQR" class="mx-auto mb-3"></div>
                <p class="text-xs text-gray-500 mb-2">Network: TRON</p>
                <p class="text-xs text-red-500 mb-3">⚠️ Send only USDT TRC-20</p>
                <button id="copyAddress" class="mt-2 text-blue-500 text-xs">📋 Copy Address</button>
                <button id="closeTron" class="mt-4 px-4 py-2 bg-gray-200 rounded block w-full">Done</button>
            </div>
        `);

        // ✅ FIXED: Simple address QR
        generateQR(recipient, 'tronQR');

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => {
                    modal.querySelector('#copyAddress').textContent = '✅ Copied!';
                    setTimeout(() => {
                        modal.querySelector('#copyAddress').textContent = '📋 Copy Address';
                    }, 2000);
                })
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#closeTron').onclick = () => {
            modal.remove();
            resolve({ success: false, manual: true });
        };
    });
}

function updateStatus(modal, text) {
    const element = modal.querySelector('#statusText');
    if (element) element.textContent = text;
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
    let message = error.message || 'Payment failed';
    
    // Special handling for ethers.js errors
    if (error.message && error.message.includes('ethers.BrowserProvider')) {
        message = 'Wallet connection error - please refresh and try again';
    }
    
    updateStatus(modal, `❌ ${message}`);
    modal.querySelector('.loading-spinner')?.remove();
    
    const closeBtn = modal.querySelector('#closeModal');
    if (closeBtn) closeBtn.classList.remove('hidden');
}

function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}" 
                 alt="QR Code" 
                 class="mx-auto" />
        `;
    }
}

// ======================================================
// 📱 MOBILE PAYMENT FUNCTIONS (FIXED)
// ======================================================

// Get wallet deep links for mobile
function getMobileWalletLinks(network = 'bsc') {
    const currentUrl = window.location.href;
    const encodedUrl = encodeURIComponent(currentUrl);
    const host = window.location.host;
    const path = window.location.pathname;
    
    const wallets = {
        bsc: [
            { key: 'metamask', name: 'MetaMask', icon: '🦊', color: 'bg-orange-500', link: `https://metamask.app.link/dapp/${host}${path}` },
            { key: 'trustwallet', name: 'Trust Wallet', icon: '🛡️', color: 'bg-blue-500', link: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodedUrl}` },
            { key: 'tokenpocket', name: 'TokenPocket', icon: '💼', color: 'bg-indigo-500', link: `tpoutside://open?params={"url":"${currentUrl}"}` },
            { key: 'binance', name: 'Binance', icon: '🟡', color: 'bg-yellow-500', link: `bnc://app.binance.com/dapp/${host}${path}` },
            { key: 'safepal', name: 'SafePal', icon: '🔐', color: 'bg-purple-500', link: `safepalwallet://dapp?url=${encodedUrl}` }
        ],
        tron: [
            { key: 'tronlink', name: 'TronLink', icon: '⚡', color: 'bg-red-500', link: `tronlink://dapp?url=${encodedUrl}` },
            { key: 'trustwallet', name: 'Trust Wallet', icon: '🛡️', color: 'bg-blue-500', link: `https://link.trustwallet.com/open_url?coin_id=195&url=${encodedUrl}` },
            { key: 'tokenpocket', name: 'TokenPocket', icon: '💼', color: 'bg-indigo-500', link: `tpoutside://open?params={"url":"${currentUrl}"}` },
            { key: 'klever', name: 'Klever', icon: '🔷', color: 'bg-cyan-500', link: `klever://browser?url=${encodedUrl}` }
        ]
    };
    
    return wallets[network.toLowerCase()] || wallets.bsc;
}

// Mobile wallet selection modal with deep links
function showMobileWalletModal(network) {
    return new Promise((resolve) => {
        const wallets = getMobileWalletLinks(network);
        
        const walletButtonsHtml = wallets.map(w => `
            <button data-wallet="${w.key}" data-link="${w.link}" 
                class="wallet-btn w-full ${w.color} hover:opacity-90 text-white py-3 rounded-lg mb-2 flex items-center justify-center gap-2 transition-all active:scale-95">
                <span class="text-xl">${w.icon}</span>
                <span class="font-medium">${w.name}</span>
            </button>
        `).join('');
        
        const modal = createModal(`
            <div class="bg-white p-6 rounded-2xl text-center w-[340px] max-w-[95vw] max-h-[85vh] overflow-y-auto">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="font-bold text-lg">🔗 Connect Wallet</h3>
                    <span class="text-xs bg-gray-100 px-2 py-1 rounded">${network}</span>
                </div>
                
                <p class="text-sm text-gray-600 mb-4">Tap a wallet to open and connect:</p>
                
                <div class="space-y-2 mb-4">
                    ${walletButtonsHtml}
                </div>
                
                <div class="relative my-4">
                    <div class="absolute inset-0 flex items-center">
                        <div class="w-full border-t border-gray-200"></div>
                    </div>
                    <div class="relative flex justify-center text-sm">
                        <span class="px-2 bg-white text-gray-500">or</span>
                    </div>
                </div>
                
                <button id="mobileWalletConnect" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg mb-2 flex items-center justify-center gap-2">
                    <span>🔗</span> WalletConnect
                </button>
                
                <button id="mobileQR" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded-lg mb-2 flex items-center justify-center gap-2">
                    <span>📱</span> Pay via QR Code
                </button>
                
                <button id="mobileBack" class="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg mt-3">
                    ← Back
                </button>
                
                <p class="text-xs text-gray-400 mt-4">
                    Don't have a wallet? Download one from your app store.
                </p>
            </div>
        `);

        // Handle wallet deep link clicks
        modal.querySelectorAll('.wallet-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const walletKey = btn.dataset.wallet;
                const link = btn.dataset.link;
                
                console.debug(`[Mobile] Opening ${walletKey}:`, link);
                trackEvent('mobile_wallet_deeplink', { wallet: walletKey, network });
                
                window.location.href = link;
                
                setTimeout(() => {
                    modal.remove();
                    resolve({ method: 'deeplink', wallet: walletKey });
                }, 300);
            });
        });

        modal.querySelector('#mobileWalletConnect').onclick = () => {
            modal.remove();
            resolve({ method: 'walletconnect' });
        };

        modal.querySelector('#mobileQR').onclick = () => {
            modal.remove();
            resolve({ method: 'qr' });
        };

        modal.querySelector('#mobileBack').onclick = () => {
            modal.remove();
            resolve({ method: 'back' });
        };
    });
}

// ✅ FIXED: Mobile BSC payment - no network switching, use raw tx
async function processMobileBSCPayment(init) {
    try {
        console.debug('[Mobile BSC] Starting payment');
        
        // Store pending state for iOS resume handling
        pendingPaymentState = {
            participantId: window.currentParticipant?.id,
            network: 'BSC',
            amount: init.amount,
            recipient: init.recipient_address
        };
        
        // Check if already inside wallet app browser
        if (window.ethereum) {
            try {
                console.debug('[Mobile BSC] Injected wallet found, requesting accounts...');
                
                // Request accounts (triggers wallet popup)
                await window.ethereum.request({ method: 'eth_requestAccounts' });
                
                // ✅ FIXED: Use mobile-safe transfer
                const result = await executeBSCTransferMobile(
                    window.ethereum, 
                    init.recipient_address, 
                    init.amount
                );
                
                pendingPaymentState = null;
                return result;
            } catch (error) {
                console.warn('[Mobile BSC] Injected wallet failed:', error.message);
                // Fall through to show wallet modal
            }
        }
        
        // Show mobile wallet selection modal
        const choice = await showMobileWalletModal('BSC');
        
        if (choice.method === 'deeplink') {
            // User tapped wallet deep link - they'll be redirected
            // Show QR as fallback when they return
            console.debug('[Mobile BSC] Deep link opened, showing manual fallback');
            return await showBSCManualModal(init.recipient_address, init.amount);
        }
        
        if (choice.method === 'walletconnect') {
            try {
                const wcProvider = await connectWalletMobile();
                // ✅ FIXED: Use mobile-safe transfer with WC provider
                const result = await executeBSCTransferMobile(
                    wcProvider, 
                    init.recipient_address, 
                    init.amount
                );
                pendingPaymentState = null;
                return result;
            } catch (error) {
                console.warn('[Mobile BSC] WalletConnect failed:', error.message);
                return await showBSCManualModal(init.recipient_address, init.amount);
            }
        }
        
        if (choice.method === 'qr') {
            return await showBSCManualModal(init.recipient_address, init.amount);
        }
        
        pendingPaymentState = null;
        return { success: false, cancelled: true };
        
    } catch (error) {
        console.error('[Mobile BSC] Error:', error.message);
        pendingPaymentState = null;
        throw error;
    }
}

// ✅ FIXED: Mobile TRON payment
async function processMobileTronPayment(init) {
    try {
        console.debug('[Mobile TRON] Starting payment');
        
        pendingPaymentState = {
            participantId: window.currentParticipant?.id,
            network: 'TRON',
            amount: init.amount,
            recipient: init.recipient_address
        };
        
        // Check if already inside TronLink app browser
        if (window.tronWeb && window.tronWeb.ready) {
            try {
                const result = await executeTronTransfer(init.recipient_address, init.amount);
                pendingPaymentState = null;
                return result;
            } catch (error) {
                console.warn('[Mobile TRON] TronLink failed:', error.message);
            }
        }
        
        // Show mobile wallet selection modal
        const choice = await showMobileWalletModal('TRON');
        
        if (choice.method === 'deeplink') {
            return await showTronManualModal(init.recipient_address, init.amount);
        }
        
        if (choice.method === 'walletconnect') {
            alert('WalletConnect is not available for TRON. Please use a TRON wallet or QR code.');
            return await showTronManualModal(init.recipient_address, init.amount);
        }
        
        if (choice.method === 'qr') {
            return await showTronManualModal(init.recipient_address, init.amount);
        }
        
        pendingPaymentState = null;
        return { success: false, cancelled: true };
        
    } catch (error) {
        console.error('[Mobile TRON] Error:', error.message);
        pendingPaymentState = null;
        return await showTronManualModal(init.recipient_address, init.amount);
    }
}

// ======================================================
// 🖥️ DESKTOP PAYMENT FUNCTIONS (FIXED)
// ======================================================

// ✅ FIXED: Desktop BSC - can use ethers.Contract safely
async function processDesktopBSCPayment(init) {
    try {
        console.debug('[Desktop BSC] Starting payment');
        
        const userChoice = await showNoWalletDetectedModal();
        
        if (userChoice === 'walletconnect') {
            try {
                console.debug('[Desktop BSC] User selected WalletConnect');
                const wcProvider = await connectWalletMobile();
                const provider = new ethers.providers.Web3Provider(wcProvider);
                
                // ✅ Desktop only: safe to switch networks
                await ensureBSCNetworkDesktop(provider);
                
                const signer = provider.getSigner();
                return await executeBSCTransferDesktop(signer, init.recipient_address, init.amount);
            } catch (error) {
                console.warn('[Desktop BSC] WalletConnect failed:', error.message);
                return await showBSCManualModal(init.recipient_address, init.amount);
            }
        } else if (userChoice === 'qr') {
            console.debug('[Desktop BSC] User selected QR code');
            return await showBSCManualModal(init.recipient_address, init.amount);
        }
        
        return { success: false, cancelled: true };
        
    } catch (error) {
        console.error('[Desktop BSC] Error:', error.message);
        throw error;
    }
}

// ...existing processDesktopTronPayment...

// ======================================================
// 🚀  PAYMENT ROUTING (Mobile vs Desktop)
// ======================================================

async function processBSCPayment(init) {
    if (isMobileDevice()) {
        return await processMobileBSCPayment(init);
    } else {
        return await processDesktopBSCPayment(init);
    }
}

async function processTronPayment(init) {
    if (isMobileDevice()) {
        return await processMobileTronPayment(init);
    } else {
        return await processDesktopTronPayment(init);
    }
}

// ======================================================
// 🎯  MAIN PAYMENT FUNCTION
// ======================================================

async function processCryptoPayment() {
    try {
        // Verify all required components are initialized
        if (!CONFIG || !ERROR_CODES || !paymentAttempts) {
            throw new PaymentError(
                'System not properly initialized', 
                ERROR_CODES.INITIALIZATION_ERROR,
                { config: !!CONFIG, errorCodes: !!ERROR_CODES, attempts: !!paymentAttempts }
            );
        }

        console.debug('[Payment] Starting process with participant:', window.currentParticipant?.id);
        
        const participantId = window.currentParticipant?.id;
        const voteCount = window.selectedVoteAmount;

        // Validate inputs
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);

        // Network selection
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
                updateStatus(modal, 'Connecting wallet...');
                result = await processBSCPayment(init);
            } else if (network === 'TRON') {
                console.debug('[Payment] Processing TRON payment...');
                updateStatus(modal, 'Processing TRON payment...');
                result = await processTronPayment(init);
            } else {
                throw new PaymentError('Unsupported network', ERROR_CODES.NETWORK_ERROR, { network });
            }

            // Check if it's a manual/QR payment
            if (result.manual === true) {
                console.debug('[Payment] Manual payment mode - user scanned QR');
                updateStatus(modal, 'Waiting for transaction confirmation...');
                trackEvent('payment_manual_qr', { network });
                return result;
            }

            if (result.success !== false && result.txHash) {
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
        // Enhanced error logging
        console.error('❌ Crypto Payment Error:', {
            message: error.message,
            code: error.code,
            stack: error.stack,
            metadata: error.metadata
        });
        
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
            cancelled: error.code === 4001 || error.code === 'ACTION_REJECTED',
            details: error.metadata
        };
    }
}

// ======================================================
// 🔌  DEPENDENCY LOADING
// ======================================================

async function loadDependencies() {
    try {
        // Load ethers.js if not already available
        if (typeof ethers === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.ethers.io/lib/ethers-5.7.2.min.js';
                script.onload = () => {
                    if (!ethers || !ethers.providers) {
                        reject(new Error('Ethers.js not properly loaded'));
                        return;
                    }
                    console.log('✅ Ethers.js v5 loaded');
                    resolve();
                };
                script.onerror = () => {
                    reject(new Error('Failed to load ethers.js'));
                };
                document.head.appendChild(script);
            });
        }
    } catch (error) {
        throw new PaymentError(
            'Failed to load required dependencies',
            ERROR_CODES.DEPENDENCY_ERROR,
            { originalError: error }
        );
    }
}

// ======================================================
// 🏁  INITIALIZATION & EXPORT
// ======================================================

async function initializePaymentSystem() {
    try {
        await loadDependencies();
        
        // Verify all required components are available
        if (typeof ethers === 'undefined' || !ethers.providers) {
            throw new PaymentError(
                'Ethers.js not properly loaded',
                ERROR_CODES.DEPENDENCY_ERROR
            );
        }

        // Export the main payment function
        window.processCryptoPayment = processCryptoPayment;
        console.log('🔒 Crypto Payments Module Ready');
    } catch (error) {
        console.error('Initialization failed:', error);
        // Provide a fallback function
        window.processCryptoPayment = () => Promise.resolve({
            success: false,
            error: 'Payment system initialization failed',
            code: ERROR_CODES.INITIALIZATION_ERROR,
            details: { error: error.message }
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePaymentSystem);
} else {
    initializePaymentSystem();
}
