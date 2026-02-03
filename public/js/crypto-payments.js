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
let resolveReady, rejectReady;
const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

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

async function loadScript(src, checkFn, name) {
    if (checkFn()) { console.log(`✅ ${name} already loaded`); return true; }
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            const check = setInterval(() => { if (checkFn()) { clearInterval(check); resolve(true); } }, 100);
            setTimeout(() => { clearInterval(check); reject(new PaymentError(`${name} load timeout`, ERROR_CODES.DEPENDENCY_ERROR)); }, 10000);
            return;
        }
        const script = document.createElement('script'); script.src = src; script.async = true;
        script.onload = () => setTimeout(() => { if (checkFn()) { console.log(`✅ ${name} loaded`); resolve(true); } else reject(new PaymentError(`${name} not initialized`, ERROR_CODES.DEPENDENCY_ERROR)); }, 100);
        script.onerror = () => reject(new PaymentError(`Failed to load ${name}`, ERROR_CODES.DEPENDENCY_ERROR));
        document.head.appendChild(script);
    });
}

async function loadEthers() { return loadScript(CONFIG.ETHERS.SRC, () => typeof ethers !== 'undefined' && ethers.utils, 'Ethers.js'); }
async function loadWalletConnect() { await loadScript(CONFIG.WALLETCONNECT.SRC, () => !!window.EthereumProvider, 'WalletConnect'); return window.EthereumProvider; }
async function loadPaystack() { return loadScript(CONFIG.PAYSTACK.SRC, () => typeof PaystackPop !== 'undefined', 'Paystack'); }

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
        if (window.tronWeb?.ready) return 'TRON';
        if (window.ethereum) { const c = await window.ethereum.request({ method: 'eth_chainId' }); if (c === '0x38') return 'BSC'; }
    } catch {} return null;
}

async function connectWalletConnect() {
    const EthereumProvider = await loadWalletConnect();
    const provider = await EthereumProvider.init({
        projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
        chains: [CONFIG.BSC.CHAIN_ID],
        showQrModal: true,
        qrModalOptions: { themeMode: 'dark', enableExplorer: true, explorerRecommendedWalletIds: ['c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96', '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0'] },
        metadata: { name: "OneDream Voting", description: "Secure USDT Payment", url: window.location.origin, icons: [`${window.location.origin}/favicon.ico`] }
    });
    await provider.connect();
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (chainId !== `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`) {
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${CONFIG.BSC.CHAIN_ID.toString(16)}` }] }); }
        catch { throw new PaymentError('Please switch to BSC network', ERROR_CODES.NETWORK_ERROR); }
    }
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts?.length) throw new PaymentError('No wallet accounts', ERROR_CODES.WALLET_ERROR);
    return provider;
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
    if (!window.tronWeb?.ready) throw new PaymentError('TronLink not available', ERROR_CODES.PROVIDER_ERROR);
    const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
    const tx = await contract.transfer(recipient, Math.floor(amount * 1e6)).send();
    if (!tx?.transaction?.txID) throw new PaymentError('TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
    return { txHash: tx.transaction.txID, network: 'TRON', explorerUrl: `${CONFIG.TRON.EXPLORER}${tx.transaction.txID}` };
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
                if (result.success && result.txHash) { try { await finalizePayment(result.txHash, method); } catch {} }
                trackEvent('payment_completed', { participantId, network: method, manual: true });
                return result;
            }
            if (choice === 'walletconnect') {
                modal = showPaymentStatusModal(method, amount);
                updateStatus(modal, isMobile() ? 'Opening wallet...' : 'Scan QR with wallet...');
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
            if (!window.tronWeb?.ready) {
                const result = await showManualPaymentModal(method, recipient, amount);
                if (result.success && result.txHash) { try { await finalizePayment(result.txHash, method); } catch {} }
                trackEvent('payment_completed', { participantId, network: method, manual: true });
                return result;
            }
            modal = showPaymentStatusModal(method, amount);
            updateStatus(modal, 'Confirm in TronLink...');
            const result = await executeTronTransfer(recipient, amount);
            updateStatus(modal, 'Finalizing...');
            await finalizePayment(result.txHash, method);
            successStatus(modal, result.txHash, result.explorerUrl);
            trackEvent('payment_completed', { participantId, network: method, method: 'tronlink' });
            return { success: true, ...result };
        }
        
        return { success: false, error: 'Invalid method' };
    } catch (error) {
        console.error('[Payment] Error:', error);
        if (modal) errorStatus(modal, error); else alert(error.message || 'Payment failed');
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
            isInitialized = true;
            resolveReady(true);
            console.log('🔒 Crypto Payments Ready');
            return true;
        } catch (e) {
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
initialize().catch(console.error);

// ======================================================
// 🌍  GLOBAL EXPORTS
// ======================================================

window.initiateCryptoPayment = initiateCryptoPayment;
window.processCryptoPayment = processCryptoPayment;
window.initiatePaystackPayment = initiatePaystackPayment;
window.cryptoPaymentReady = readyPromise;
window.CryptoPayments = {
    initiate: initiateCryptoPayment,
    process: processCryptoPayment,
    paystack: initiatePaystackPayment,
    isReady, whenReady, initialize,
    showManualPaymentModal,
    CONFIG, ERROR_CODES
};

console.log('✅ Crypto Payments module loaded');