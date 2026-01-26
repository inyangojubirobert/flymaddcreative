console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   🔒 CONFIGURATION & ADDRESSES
====================================================== */
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BEP-20
const TRON_USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";          // TRC-20
const BSC_RPC_URL = "https://bsc-dataseed.binance.org/";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 300000; // 5 minutes

/* ======================================================
   🛡️ ERROR CODES & UTILITIES
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
const ATTEMPT_TIMEOUT = 5 * 60 * 1000; // 5 min

function validateInputs(participantId, voteCount) {
    if (!participantId || typeof participantId !== 'string') throw { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid participant ID' };
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) throw { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid vote count' };
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = paymentAttempts.get(participantId) || [];
    const recentAttempts = attempts.filter(t => now - t < ATTEMPT_TIMEOUT);
    if (recentAttempts.length >= MAX_RETRIES) throw { code: ERROR_CODES.RATE_LIMIT, message: 'Too many payment attempts. Try later.' };
    paymentAttempts.set(participantId, [...recentAttempts, now]);
}

function getErrorMessage(error) {
    if (error.code === 4001) return 'User rejected the request';
    if (error.code === -32002) return 'Request already pending';
    if (error.code in ERROR_CODES) return error.message;
    return error.message || 'Unknown error';
}

function trackEvent(name, metadata = {}) {
    if (window.analytics) window.analytics.track(name, metadata);
    console.log(`[Analytics] ${name}`, metadata);
}

/* ======================================================
   🔌 NETWORK DETECTION & WALLETCONNECT
====================================================== */
async function detectPreferredNetwork() {
    if (window.tronWeb && window.tronWeb.ready) return 'tron';
    if (window.ethereum) {
        try { const chainId = await window.ethereum.request({ method: 'eth_chainId' }); if (chainId === '0x38') return 'bsc'; } catch {}
    }
    return null;
}

async function loadWalletConnect() {
    if (window.EthereumProvider) return window.EthereumProvider;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js';
        script.onload = () => { console.log('✅ WalletConnect SDK loaded'); resolve(window.EthereumProvider); };
        script.onerror = () => reject(new Error('WalletConnect failed to load'));
        document.head.appendChild(script);
    });
}

/* ======================================================
   🏦 BACKEND INTEGRATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    trackEvent('payment_initiated', { participantId, voteCount, network });
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network })
    });
    if (!res.ok) throw { code: ERROR_CODES.NETWORK_ERROR, message: 'Backend init failed' };
    return res.json();
}

async function finalizePayment(txHash, network) {
    trackEvent('payment_completed', { txHash, network });
    return { success: true, payment_method: 'crypto', payment_reference: txHash, network };
}

/* ======================================================
   🟡 BSC – USDT TRANSFER (Desktop + Mobile)
====================================================== */
async function processBSC(init) {
    if (typeof ethers === 'undefined') {
        alert("Ethers.js failed to load. Refresh the page.");
        return { success: false };
    }

    if (window.ethereum) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await ensureBSCNetwork(provider);
            const signer = await provider.getSigner();
            return await executeBSCTransfer(signer, init, false);
        } catch (err) { return { success: false, error: err.message }; }
    }

    try {
        await loadWalletConnect();
        const wcProvider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56],
            showQrModal: true,
            qrModalOptions: { themeMode: 'dark' },
            metadata: { name: "OneDream Voting", url: window.location.origin }
        });
        await wcProvider.connect();
        const provider = new ethers.BrowserProvider(wcProvider);
        const signer = await provider.getSigner();
        return await executeBSCTransfer(signer, init, true);
    } catch (err) { return { success: false, error: err.message }; }
}

async function executeBSCTransfer(signer, init, mobile = false) {
    const modal = showPaymentStatusModal(mobile ? 'BSC (Mobile)' : 'BSC', init.amount);
    try {
        const usdt = new ethers.Contract(BSC_USDT_ADDRESS, ['function transfer(address,uint256) returns (bool)'], signer);
        updateStatus(modal, 'Confirming USDT transfer…');
        const tx = await usdt.transfer(init.recipient_address, ethers.parseUnits(init.amount.toString(), 18));
        updateStatus(modal, 'Waiting for network confirmation…');
        await tx.wait();
        successStatus(modal, tx.hash, 'bsc');
        return await finalizePayment(tx.hash, 'bsc');
    } catch (err) {
        if (err.code === 4001) errorStatus(modal, "User rejected the transaction");
        else if (err.message.includes('insufficient')) errorStatus(modal, "Insufficient BNB for gas");
        else errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

async function ensureBSCNetwork(provider) {
    const { chainId } = await provider.getNetwork();
    if (chainId !== 56n) {
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
        } catch (err) {
            if (err.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x38', chainName: 'Binance Smart Chain',
                        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                        rpcUrls: [BSC_RPC_URL], blockExplorerUrls: ['https://bscscan.com/']
                    }]
                });
            } else throw err;
        }
    }
}

/* ======================================================
   🔴 TRON – USDT TRANSFER
====================================================== */
async function processTron(init) {
    const modal = showPaymentStatusModal('TRON', init.amount);
    try {
        if (window.tronWeb && window.tronWeb.ready) {
            updateStatus(modal, 'Preparing TRC-20…');
            const contract = await window.tronWeb.contract().at(TRON_USDT_ADDRESS);
            const amountSun = Math.floor(init.amount * 1_000_000);
            updateStatus(modal, 'Sign transaction in TronLink…');
            const tx = await contract.transfer(init.recipient_address, amountSun).send();
            successStatus(modal, tx.transaction.txID, 'tron');
            return finalizePayment(tx.transaction.txID, 'tron');
        }
        modal.remove();
        return showTronManualModal(init);
    } catch (err) {
        errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

function showTronManualModal(init) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80">
            <h3 class="font-bold mb-3">TRON USDT</h3>
            <div id="tronQR"></div>
            <div class="mt-2 p-2 bg-gray-100 rounded text-xs break-all select-all">${init.recipient_address}</div>
            <button onclick="navigator.clipboard.writeText('${init.recipient_address}'); alert('Copied!')" class="text-blue-500 mt-2 text-xs">Copy Address</button>
            <p class="text-sm mt-2">Send exactly <b>${init.amount} USDT</b></p>
            <button id="closeTron" class="mt-4 text-gray-500">Cancel</button>
        </div>
    `;
    document.body.appendChild(modal);
    generateQR(init.recipient_address, 'tronQR');
    modal.querySelector('#closeTron').onclick = () => modal.remove();
    return { success: false, cancelled: true };
}

/* ======================================================
   🧩 UI HELPERS
====================================================== */
function showPaymentStatusModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    m.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]">
            <h3 class="font-bold mb-2">${network} Payment</h3>
            <p class="text-xl font-bold mb-4">${amount} USDT</p>
            <div id="statusText">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
            <div id="txLink" class="mt-4 text-sm hidden"><a href="#" target="_blank" rel="noopener noreferrer" class="text-blue-500">View on explorer</a></div>
        </div>
    `;
    document.body.appendChild(m);
    return m;
}

function updateStatus(modal, text) { modal.querySelector('#statusText').textContent = text; }

function successStatus(modal, txHash, network) {
    updateStatus(modal, '✅ Payment confirmed');
    modal.querySelector('.loading-spinner')?.remove();
    if (txHash) {
        const link = modal.querySelector('#txLink a');
        if (link) link.href = network === 'bsc' ? `https://bscscan.com/tx/${txHash}` : `https://tronscan.org/#/transaction/${txHash}`;
        modal.querySelector('#txLink')?.classList.remove('hidden');
    }
    setTimeout(() => modal.remove(), 5000);
}

function errorStatus(modal, msg) { updateStatus(modal, '❌ ' + msg); modal.querySelector('.loading-spinner')?.remove(); }

function generateQR(text, id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}" />`;
}

async function showNetworkSelectionModal() {
    const preferred = await detectPreferredNetwork();
    return new Promise(resolve => {
        const m = document.createElement('div');
        m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
        m.innerHTML = `
            <div class="bg-white p-6 rounded-xl w-80 text-center">
                <h3 class="font-bold mb-4">Choose Network</h3>
                <button id="bsc" class="w-full bg-yellow-400 py-3 rounded mb-3">🟡 BSC ${preferred==='bsc'? '(Detected)':''}</button>
                <button id="tron" class="w-full bg-red-600 text-white py-3 rounded">🔴 TRON ${preferred==='tron'? '(Detected)':''}</button>
                <button id="cancel" class="mt-4 text-gray-500 text-sm">Cancel</button>
            </div>
        `;
        document.body.appendChild(m);
        m.querySelector('#bsc').onclick = () => { m.remove(); resolve('bsc'); };
        m.querySelector('#tron').onclick = () => { m.remove(); resolve('tron'); };
        m.querySelector('#cancel').onclick = () => { m.remove(); resolve(null); };
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
        if (!network) { trackEvent('payment_cancelled', { stage: 'network_selection' }); return { success: false, cancelled: true }; }

        const init = await initializeCryptoPayment(participantId, voteCount, network);
        let result;
        if (network === 'bsc') result = await processBSC(init);
        else if (network === 'tron') result = await processTron(init);
        else throw { code: ERROR_CODES.NETWORK_ERROR, message: 'Unsupported network' };

        return result.success ? result : { success: false, error: 'Payment failed' };
    } catch (err) {
        console.error('❌ Crypto Payment Error:', err);
        trackEvent('payment_failed', { error: err.message, code: err.code || ERROR_CODES.TRANSACTION_ERROR });
        return { success: false, error: getErrorMessage(err), code: err.code || ERROR_CODES.TRANSACTION_ERROR, cancelled: err.code === 4001 };
    }
}

/* ======================================================
   🔑 EXPORT
====================================================== */
window.processCryptoPayment = processCryptoPayment;
