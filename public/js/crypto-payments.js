console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   🔒 CONFIGURATION & ADDRESSES
====================================================== */
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BEP-20
const TRON_USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // TRC-20 (Mainnet)
const BSC_RPC_URL = "https://bsc-dataseed.binance.org/";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 300000; // 5 minutes

/* ======================================================
   🛡️ SECURITY & UTILITIES
====================================================== */
const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT',
    RATE_LIMIT: 'RATE_LIMIT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR',
    TRANSACTION_ERROR: 'TRANSACTION_ERROR',
    TIMEOUT: 'TIMEOUT'
};

const paymentAttempts = new Map();
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function validateInputs(participantId, voteCount) {
    if (!participantId || typeof participantId !== 'string') {
        throw { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid participant ID' };
    }
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) {
        throw { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid vote count' };
    }
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = paymentAttempts.get(participantId) || [];
    const recentAttempts = attempts.filter(t => now - t < ATTEMPT_TIMEOUT);
    
    if (recentAttempts.length >= MAX_ATTEMPTS) {
        throw { 
            code: ERROR_CODES.RATE_LIMIT, 
            message: 'Too many payment attempts. Please try again later.' 
        };
    }
    
    paymentAttempts.set(participantId, [...recentAttempts, now]);
}

function getErrorMessage(error) {
    if (error.code === 4001) return 'User rejected the request';
    if (error.code === -32002) return 'Request already pending';
    if (error.code in ERROR_CODES) return error.message;
    return error.message || 'Unknown error occurred';
}

function trackEvent(eventName, metadata = {}) {
    if (window.analytics) {
        window.analytics.track(eventName, metadata);
    }
    console.log(`[Analytics] ${eventName}`, metadata);
}

/* ======================================================
   🔌 NETWORK DETECTION & WALLET CONNECTIVITY
====================================================== */
async function detectPreferredNetwork() {
    if (window.tronWeb && window.tronWeb.ready) return 'tron';
    if (window.ethereum) {
        try {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            if (chainId === '0x38') return 'bsc'; // BSC mainnet
        } catch (error) {
            console.warn('Chain ID detection failed:', error);
        }
    }
    return null;
}

async function loadWalletConnect() {
    if (window.EthereumProvider) return window.EthereumProvider;

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js';
        script.onload = () => {
            console.log('✅ WalletConnect SDK loaded');
            resolve(window.EthereumProvider);
        };
        script.onerror = () => reject(new Error('WalletConnect failed to load'));
        document.head.appendChild(script);
    });
}

/* ======================================================
   🏦 BACKEND COMMUNICATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    trackEvent('payment_initiated', { participantId, voteCount, network });
    
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network })
    });

    if (!res.ok) {
        const error = await res.text();
        throw { code: ERROR_CODES.NETWORK_ERROR, message: `Backend init failed: ${error}` };
    }
    
    return res.json();
}

async function finalizePayment(txHash, network) {
    trackEvent('payment_completed', { txHash, network });
    
    return {
        success: true,
        payment_method: 'crypto',
        payment_reference: txHash,
        network
    };
}

/* ======================================================
   🟡 BSC – USDT (BEP-20) PROCESSING
====================================================== */
async function processBSC(init) {
    if (window.ethereum) return processBSCInjected(init);
    return processBSCWalletConnect(init);
}

async function processBSCInjected(init) {
    const modal = showPaymentStatusModal('BSC', init.amount);
    let retries = 0;

    while (retries < MAX_RETRIES) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            
            updateStatus(modal, 'Estimating gas...');
            const usdt = new ethers.Contract(
                BSC_USDT_ADDRESS, 
                ['function transfer(address,uint256) returns (bool)'], 
                signer
            );
            
            const amountWei = ethers.parseUnits(init.amount.toString(), 18);
            updateStatus(modal, 'Confirm USDT transfer in wallet...');
            
            const tx = await usdt.transfer(init.recipient_address, amountWei);
            updateStatus(modal, 'Waiting for confirmation...');
            
            const receipt = await tx.wait();
            if (!receipt) throw new Error('Transaction receipt not found');
            
            successStatus(modal, tx.hash, 'bsc');
            return await finalizePayment(tx.hash, 'bsc');
            
        } catch (error) {
            retries++;
            if (retries >= MAX_RETRIES) {
                errorStatus(modal, getErrorMessage(error));
                throw { code: ERROR_CODES.TRANSACTION_ERROR, message: error.message };
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

async function processBSCWalletConnect(init) {
    const modal = showPaymentStatusModal('BSC (Mobile)', init.amount);

    try {
        await loadWalletConnect();
        updateStatus(modal, 'Initializing WalletConnect...');

        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56], // BSC
            showQrModal: true,
            qrModalOptions: { themeMode: 'dark' },
            metadata: {
                name: "OneDream Voting",
                description: "Secure USDT Payment",
                url: window.location.origin,
                icons: ["https://yoursite.com/icon.png"]
            }
        });

        updateStatus(modal, 'Connect your wallet...');
        await provider.connect();

        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();

        const usdt = new ethers.Contract(
            BSC_USDT_ADDRESS, 
            ['function transfer(address,uint256) returns (bool)'], 
            signer
        );

        updateStatus(modal, 'Confirm USDT transfer...');
        const tx = await usdt.transfer(
            init.recipient_address, 
            ethers.parseUnits(init.amount.toString(), 18)
        );

        updateStatus(modal, 'Processing transaction...');
        await tx.wait();

        successStatus(modal, tx.hash, 'bsc');
        return await finalizePayment(tx.hash, 'bsc');

    } catch (error) {
        errorStatus(modal, getErrorMessage(error));
        throw { code: ERROR_CODES.WALLET_ERROR, message: error.message };
    }
}

/* ======================================================
   🔴 TRON – USDT (TRC-20) PROCESSING
====================================================== */
async function processTron(init) {
    const modal = showPaymentStatusModal('TRON', init.amount);

    try {
        if (window.tronWeb && window.tronWeb.ready) {
            updateStatus(modal, 'Preparing TRC-20 transfer...');
            const contract = await window.tronWeb.contract().at(TRON_USDT_ADDRESS);
            const amountSun = Math.floor(init.amount * 1_000_000);

            updateStatus(modal, 'Confirm in TronLink...');
            const tx = await contract.transfer(init.recipient_address, amountSun).send();

            if (!tx.transaction) throw new Error('TRON transaction failed');
            
            successStatus(modal, tx.transaction.txID, 'tron');
            return await finalizePayment(tx.transaction.txID, 'tron');
        }

        modal.remove();
        return showTronManualModal(init);

    } catch (error) {
        errorStatus(modal, getErrorMessage(error));
        throw { code: ERROR_CODES.TRANSACTION_ERROR, message: error.message };
    }
}

function showTronManualModal(init) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80">
            <h3 class="font-bold mb-3">TRON USDT Payment</h3>
            <p class="text-sm mb-2">Send ${init.amount} USDT (TRC-20) to:</p>
            <div class="bg-gray-100 p-2 rounded break-all text-xs mb-3">${init.recipient_address}</div>
            <div id="tronQR" class="mx-auto mb-3"></div>
            <p class="text-sm text-gray-500">Scan with TRON wallet</p>
            <button id="closeTron" class="mt-4 px-4 py-2 bg-gray-200 rounded">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
    generateQR(`tron:${TRON_USDT_ADDRESS}?contractAddress=${TRON_USDT_ADDRESS}&recipient=${init.recipient_address}&amount=${init.amount}`, 'tronQR');

    modal.querySelector('#closeTron').onclick = () => modal.remove();
    return { success: false, cancelled: true };
}

/* ======================================================
   🧩 UI COMPONENTS & HELPERS
====================================================== */
function showPaymentStatusModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    m.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-lg">${network} Payment</h3>
                <span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'bsc' ? 'BEP-20' : 'TRC-20'}</span>
            </div>
            <div class="text-2xl font-bold mb-4">${amount} USDT</div>
            <div id="statusText" class="min-h-6 mb-4">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden">
                <a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500">View on explorer</a>
            </div>
            <button id="closeModal" class="mt-4 text-gray-500 text-sm">Close</button>
        </div>
    `;
    
    m.querySelector('#closeModal').onclick = () => m.remove();
    document.body.appendChild(m);
    return m;
}

function updateStatus(modal, text) {
    const statusElement = modal.querySelector('#statusText');
    if (statusElement) statusElement.textContent = text;
}

function successStatus(modal, txHash, network) {
    const explorerUrl = network === 'bsc' 
        ? `https://bscscan.com/tx/${txHash}`
        : `https://tronscan.org/#/transaction/${txHash}`;
    
    updateStatus(modal, '✅ Payment confirmed');
    modal.querySelector('.loading-spinner')?.remove();
    
    const txLink = modal.querySelector('#txLink');
    if (txLink) {
        txLink.classList.remove('hidden');
        const link = txLink.querySelector('a');
        if (link) link.href = explorerUrl;
    }
    
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, message) {
    updateStatus(modal, `❌ ${message}`);
    modal.querySelector('.loading-spinner')?.remove();
    
    const closeBtn = modal.querySelector('#closeModal');
    if (closeBtn) closeBtn.classList.remove('hidden');
}

async function showNetworkSelectionModal() {
    const preferredNetwork = await detectPreferredNetwork();
    
    return new Promise(resolve => {
        const m = document.createElement('div');
        m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
        m.innerHTML = `
            <div class="bg-white p-6 rounded-xl w-80 max-w-[90vw] text-center">
                <h3 class="font-bold mb-4">Choose Network</h3>
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-3 flex items-center justify-center gap-2 transition-colors">
                    <span>🟡</span> BSC (BEP-20)
                    ${preferredNetwork === 'bsc' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded flex items-center justify-center gap-2 transition-colors">
                    <span>🔴</span> TRON (TRC-20)
                    ${preferredNetwork === 'tron' ? '<span class="text-xs">(Detected)</span>' : ''}
                </button>
                <button id="cancel" class="mt-4 text-gray-500 text-sm">Cancel</button>
            </div>
        `;
        document.body.appendChild(m);
        
        if (preferredNetwork) {
            setTimeout(() => {
                const btn = m.querySelector(`#${preferredNetwork}`);
                if (btn) btn.classList.add('ring-2', 'ring-blue-500');
            }, 100);
        }
        
        m.querySelector('#bsc').onclick = () => { m.remove(); resolve('bsc'); };
        m.querySelector('#tron').onclick = () => { m.remove(); resolve('tron'); };
        m.querySelector('#cancel').onclick = () => { m.remove(); resolve(null); };
    });
}

function generateQR(text, id) {
    const element = document.getElementById(id);
    if (element) {
        element.innerHTML = `
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}" 
                 alt="QR Code" 
                 class="mx-auto" />
        `;
    }
}

/* ======================================================
   🔄 TRANSACTION MONITORING
====================================================== */
async function monitorTransaction(txHash, network) {
    const startTime = Date.now();
    
    return new Promise(async (resolve, reject) => {
        const checkInterval = setInterval(async () => {
            try {
                if (Date.now() - startTime > TIMEOUT_MS) {
                    clearInterval(checkInterval);
                    reject({ code: ERROR_CODES.TIMEOUT, message: 'Transaction monitoring timeout' });
                    return;
                }
                
                let receipt;
                if (network === 'bsc') {
                    const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);
                    receipt = await provider.getTransactionReceipt(txHash);
                } else if (network === 'tron') {
                    if (!window.tronWeb) {
                        throw new Error('TRON Web not available');
                    }
                    receipt = await window.tronWeb.trx.getTransactionInfo(txHash);
                }
                
                if (receipt && (receipt.status || receipt.receipt?.result === 'SUCCESS')) {
                    clearInterval(checkInterval);
                    resolve(receipt);
                }
            } catch (error) {
                clearInterval(checkInterval);
                reject(error);
            }
        }, 5000); // Check every 5 seconds
    });
}

/* ======================================================
   🚀 MAIN ENTRY POINT
====================================================== */
async function processCryptoPayment() {
    try {
        const participantId = window.currentParticipant?.id;
        const voteCount = window.selectedVoteAmount;

        validateInputs(participantId, voteCount);
        checkRateLimit(participantId);

        const network = await showNetworkSelectionModal();
        if (!network) {
            trackEvent('payment_cancelled', { stage: 'network_selection' });
            return { success: false, cancelled: true };
        }

        const init = await initializeCryptoPayment(participantId, voteCount, network);
        
        let result;
        if (network === 'bsc') {
            result = await processBSC(init);
        } else if (network === 'tron') {
            result = await processTron(init);
        } else {
            throw { code: ERROR_CODES.NETWORK_ERROR, message: 'Unsupported network' };
        }

        if (result.success) {
            await monitorTransaction(result.payment_reference, network);
            return result;
        }
        
        return result;
    } catch (error) {
        console.error('❌ Crypto Payment Error:', error);
        trackEvent('payment_failed', { 
            error: error.message,
            code: error.code || ERROR_CODES.TRANSACTION_ERROR
        });
        
        return { 
            success: false, 
            error: getErrorMessage(error),
            code: error.code || ERROR_CODES.TRANSACTION_ERROR,
            cancelled: error.code === 4001 // User cancelled
        };
    }
}

/* ======================================================
   🔑 EXPORT & INITIALIZATION
====================================================== */
window.processCryptoPayment = processCryptoPayment;

// Check compatibility on load
(function() {
    checkBrowserCompatibility();
    console.log('🔒 Crypto Payments Module Ready');
})();

function checkBrowserCompatibility() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|OperA Mini/i.test(navigator.userAgent);
    const isChrome = /Chrome/.test(navigator.userAgent);
    
    if (isMobile && !isChrome) {
        console.warn('Mobile browser may have limited wallet support');
    }
    
    if (!window.ethereum && !window.tronWeb) {
        console.warn('No crypto wallet detected');
    }
}