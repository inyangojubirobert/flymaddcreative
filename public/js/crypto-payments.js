console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   🔒 CONFIGURATION & CONSTANTS
====================================================== */
const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        RPC_URL: "https://bsc-dataseed.binance.org/",
        CHAIN_ID: 56,
        EXPLORER: "https://bscscan.com/tx/"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: window.WALLETCONNECT_PROJECT_ID || "default_project_id"
    },
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000, // 5 minutes
        ATTEMPT_TIMEOUT: 5 * 60 * 1000 // 5 min
    }
};

/* ======================================================
   🛡️ ERROR HANDLING & UTILITIES
====================================================== */
const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    TIMEOUT: 'TIMEOUT',
    PROVIDER_ERROR: 'PROVIDER_ERROR'
};

class PaymentError extends Error {
    constructor(message, code, metadata = {}) {
        super(message);
        this.code = code;
        this.metadata = metadata;
    }
}

const paymentAttempts = new Map();

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

/* ======================================================
   🔌 NETWORK & WALLET MANAGEMENT
====================================================== */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) return 'TRON';
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
    if (window.EthereumProvider) return window.EthereumProvider;
    
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new PaymentError('Window object not available', ERROR_CODES.PROVIDER_ERROR));
            return;
        }

        const script = document.createElement('script');
        script.src = CONFIG.WALLETCONNECT.SRC;
        script.onload = () => {
            console.log('✅ WalletConnect SDK loaded');
            resolve(window.EthereumProvider);
        };
        script.onerror = () => {
            reject(new PaymentError('Failed to load WalletConnect', ERROR_CODES.PROVIDER_ERROR));
        };
        document.head.appendChild(script);
    });
}

async function ensureBSCNetwork(provider) {
    try {
        const { chainId } = await provider.getNetwork();
        if (chainId !== BigInt(CONFIG.BSC.CHAIN_ID)) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}` }]
            });
        }
    } catch (switchError) {
        if (switchError.code === 4902) {
            await window.ethereum.request({
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

/* ======================================================
   🏦 PAYMENT PROCESSING
====================================================== */
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

async function executeBSCTransfer(signer, recipient, amount) {
    try {
        if (typeof ethers === 'undefined') {
            throw new PaymentError('Ethers.js not loaded', ERROR_CODES.PROVIDER_ERROR);
        }

        const usdtContract = new ethers.Contract(
            CONFIG.BSC.USDT_ADDRESS, // Uses hardcoded USDT address
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        const amountWei = ethers.parseUnits(amount.toString(), 18);
        const tx = await usdtContract.transfer(recipient, amountWei);
        const receipt = await tx.wait();

        if (!receipt) {
            throw new PaymentError('Transaction receipt not found', ERROR_CODES.TRANSACTION_ERROR);
        }

        return {
            txHash: tx.hash,
            network: 'BSC',
            explorerUrl: `${CONFIG.BSC.EXPLORER}${tx.hash}` // Uses hardcoded explorer URL
        };
    } catch (error) {
        throw new PaymentError(
            error.message || 'BSC transfer failed',
            ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

/* ======================================================
   🧩 UI COMPONENTS
====================================================== */
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
function showBSCManualModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80">
                <h3 class="font-bold mb-3">BSC USDT Payment</h3>
                <p class="text-sm mb-2">Send ${amount} USDT (BEP-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3">${recipient}</div>
                <div id="bscQR" class="mx-auto mb-3"></div>
                <p class="text-sm text-gray-500">Scan with your BSC wallet</p>
                <button id="copyAddress" class="mt-2 text-blue-500 text-xs">Copy Address</button>
                <button id="closeBSC" class="mt-4 px-4 py-2 bg-gray-200 rounded">Cancel</button>
            </div>
        `);

        generateQR(`ethereum:${recipient}?value=${amount}&contractAddress=${CONFIG.BSC.USDT_ADDRESS}`, 'bscQR');

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => alert('Address copied to clipboard!'))
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#closeBSC').onclick = () => {
            modal.remove();
            resolve({ success: false, cancelled: true });
        };
    });
}

function showTronManualModal(recipient, amount) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <div class="bg-white p-6 rounded-xl text-center w-80">
                <h3 class="font-bold mb-3">TRON USDT Payment</h3>
                <p class="text-sm mb-2">Send ${amount} USDT (TRC-20) to:</p>
                <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3">${recipient}</div>
                <div id="tronQR" class="mx-auto mb-3"></div>
                <p class="text-sm text-gray-500">Scan with TRON wallet</p>
                <button id="copyAddress" class="mt-2 text-blue-500 text-xs">Copy Address</button>
                <button id="closeTron" class="mt-4 px-4 py-2 bg-gray-200 rounded">Cancel</button>
            </div>
        `);

        generateQR(`tron:${CONFIG.TRON.USDT_ADDRESS}?contractAddress=${CONFIG.TRON.USDT_ADDRESS}&recipient=${recipient}&amount=${amount}`, 'tronQR');

        modal.querySelector('#copyAddress').onclick = () => {
            navigator.clipboard.writeText(recipient)
                .then(() => alert('Address copied to clipboard!'))
                .catch(() => alert('Failed to copy address'));
        };

        modal.querySelector('#closeTron').onclick = () => {
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
    modal.querySelector('.loading-spinner')?.remove();
    
    const txLink = modal.querySelector('#txLink');
    if (txLink) {
        const link = txLink.querySelector('a');
        if (link) link.href = explorerUrl;
        txLink.classList.remove('hidden');
    }
    
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, message) {
    updateStatus(modal, `❌ ${message}`);
    modal.querySelector('.loading-spinner')?.remove();
    
    const closeBtn = modal.querySelector('#closeModal');
    if (closeBtn) closeBtn.classList.remove('hidden');
}

function generateQR(text, elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}" 
                 alt="QR Code" 
                 class="mx-auto" />
        `;
    }
}

/* ======================================================
   🚀 MAIN PAYMENT FLOW
====================================================== */
async function processBSCPayment(init) {
    try {
        let provider;
        if (window.ethereum && !isMobileDevice()) {
            provider = new ethers.BrowserProvider(window.ethereum);
            await ensureBSCNetwork(provider);
        } else {
            // Fallback to manual payment for mobile devices
            return await showBSCManualModal(init.recipient_address, init.amount);
        }
        const signer = await provider.getSigner();
        return await executeBSCTransfer(signer, init.recipient_address, init.amount);
    } catch (error) {
        throw new PaymentError(
            error.message || 'BSC payment processing failed',
            error.code || ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function processTronPayment(init) {
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            return await executeTronTransfer(init.recipient_address, init.amount);
        }
        return await showTronManualModal(init.recipient_address, init.amount);
    } catch (error) {
        throw new PaymentError(
            error.message || 'TRON payment processing failed',
            error.code || ERROR_CODES.TRANSACTION_ERROR,
            { originalError: error }
        );
    }
}

async function processCryptoPayment() {
    try {
        const participantId = window.currentParticipant?.id;
        const voteCount = window.selectedVoteAmount;

        // Validate inputs
        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);

        // Network selection
        const preferredNetwork = await detectPreferredNetwork();
        const network = await showNetworkSelectionModal(preferredNetwork);
        
        if (!network) {
            trackEvent('payment_cancelled', { stage: 'network_selection' });
            return { success: false, cancelled: true };
        }

        // Initialize payment
        const init = await initializeCryptoPayment(participantId, voteCount, network);
        const modal = showPaymentStatusModal(network, init.amount);

        try {
            let result;
            if (network === 'BSC') {
                updateStatus(modal, 'Processing BSC payment...');
                result = await processBSCPayment(init);
            } else if (network === 'TRON') {
                updateStatus(modal, 'Processing TRON payment...');
                result = await processTronPayment(init);
            } else {
                throw new PaymentError('Unsupported network', ERROR_CODES.NETWORK_ERROR);
            }

            if (result.success !== false) {
                successStatus(modal, result.txHash, result.explorerUrl);
                trackEvent('payment_success', { network, amount: init.amount });
                return await finalizePayment(result.txHash, network);
            }

            return result;
        } catch (error) {
            errorStatus(modal, error.message);
            throw error;
        }
    } catch (error) {
        console.error('❌ Crypto Payment Error:', error);
        trackEvent('payment_failed', {
            error: error.message,
            code: error.code || ERROR_CODES.TRANSACTION_ERROR,
            ...(error.metadata || {})
        });

        return {
            success: false,
            error: error.message,
            code: error.code || ERROR_CODES.TRANSACTION_ERROR,
            cancelled: error.code === 4001
        };
    }
}

/* ======================================================
   🔑 EXPORT & INITIALIZATION
====================================================== */
if (typeof window !== 'undefined') {
    window.processCryptoPayment = processCryptoPayment;
    console.log('🔒 Crypto Payments Module Ready');
}