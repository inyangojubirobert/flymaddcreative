// ======================================================
// 🏗️  INITIALIZATION & CONFIGURATION
// ======================================================

if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

// ✅ Inject required CSS
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
    ETHERS: { SRC: "https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js" },
    PAYSTACK: {
        PUBLIC_KEY: scriptTag?.dataset?.paystackKey || window.PAYSTACK_PUBLIC_KEY || "",
        SRC: "https://js.paystack.co/v1/inline.js"
    },
    LIMITS: { MAX_RETRIES: 5, ATTEMPT_TIMEOUT: 5 * 60 * 1000 }
};

const ERROR_CODES = {
    INVALID_INPUT: 'INVALID_INPUT', RATE_LIMIT: 'RATE_LIMIT', NETWORK_ERROR: 'NETWORK_ERROR',
    WALLET_ERROR: 'WALLET_ERROR', TRANSACTION_ERROR: 'TRANSACTION_ERROR', PROVIDER_ERROR: 'PROVIDER_ERROR',
    DEPENDENCY_ERROR: 'DEPENDENCY_ERROR'
};

// ======================================================
// 🔄  STATE
// ======================================================

let walletConnectLoaded = false;
let walletConnectProvider = null;
let tronLinkInitialized = false;

// ======================================================
// 🛡️  ERROR CLASS
// ======================================================

class PaymentError extends Error {
    constructor(message, code) { super(message); this.code = code; this.name = 'PaymentError'; }
}

// ======================================================
// 🔌  SCRIPT LOADING
// ======================================================

async function loadScript(src, checkFn, name, timeout = 20000) {
    if (checkFn()) return true;
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const script = document.createElement('script');
        script.src = src; script.async = true;
        script.onload = () => {
            const check = setInterval(() => {
                if (checkFn()) { clearInterval(check); resolve(true); }
                else if (Date.now() - start > timeout) { clearInterval(check); reject(new PaymentError(`${name} timeout`, ERROR_CODES.DEPENDENCY_ERROR)); }
            }, 100);
        };
        script.onerror = () => reject(new PaymentError(`Failed to load ${name}`, ERROR_CODES.DEPENDENCY_ERROR));
        document.head.appendChild(script);
    });
}

async function loadEthers() { return loadScript(CONFIG.ETHERS.SRC, () => typeof ethers !== 'undefined', 'Ethers'); }
async function loadPaystack() { return loadScript(CONFIG.PAYSTACK.SRC, () => typeof PaystackPop !== 'undefined', 'Paystack'); }

function getEthereumProviderClass() {
    return window.EthereumProvider || window.WalletConnectEthereumProvider || window['@walletconnect/ethereum-provider']?.EthereumProvider;
}

async function loadWalletConnect() {
    if (walletConnectLoaded && getEthereumProviderClass()) return getEthereumProviderClass();
    await loadScript(CONFIG.WALLETCONNECT.SRC, () => !!getEthereumProviderClass(), 'WalletConnect', 30000);
    walletConnectLoaded = true;
    return getEthereumProviderClass();
}

// ======================================================
// 🔷  TRONLINK
// ======================================================

async function initTronLink() {
    if (tronLinkInitialized) return window.tronWeb?.ready || false;
    try {
        if (window.tronLink) {
            const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
            if (res.code === 200) { tronLinkInitialized = true; return true; }
        } else if (window.tronWeb?.ready) { tronLinkInitialized = true; return true; }
    } catch (e) { console.warn('[TronLink]', e.message); }
    return false;
}

async function connectTronLink() {
    if (!tronLinkInitialized) await initTronLink();
    if (window.tronWeb?.ready) return true;
    if (window.tronLink) {
        const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
        if (res.code === 200) return true;
        throw new PaymentError('Unlock TronLink wallet', ERROR_CODES.WALLET_ERROR);
    }
    throw new PaymentError('TronLink not detected', ERROR_CODES.PROVIDER_ERROR);
}

// ======================================================
// 🌐  WALLET CONNECTION
// ======================================================

async function connectWallet() {
    // Try injected wallet first
    if (window.ethereum) {
        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            const target = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
            if (chainId !== target) {
                try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] }); }
                catch (e) {
                    if (e.code === 4902) {
                        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: target, chainName: 'BSC', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: [CONFIG.BSC.RPC_URL], blockExplorerUrls: ['https://bscscan.com'] }] });
                    } else throw e;
                }
            }
            return window.ethereum;
        } catch (e) { if (e.code === 4001) throw new PaymentError('Connection rejected', ERROR_CODES.WALLET_ERROR); }
    }

    // Fallback to WalletConnect
    const Provider = await loadWalletConnect();
    if (!Provider) throw new PaymentError('No wallet available', ERROR_CODES.PROVIDER_ERROR);
    
    const provider = await Provider.init({
        projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
        chains: [CONFIG.BSC.CHAIN_ID],
        showQrModal: true,
        rpcMap: { 56: CONFIG.BSC.RPC_URL }
    });
    
    await provider.connect();
    walletConnectProvider = provider;
    return provider;
}

// ======================================================
// 🏦  TRANSFERS
// ======================================================

async function executeBSCTransfer(provider, recipient, amount) {
    await loadEthers();
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!accounts[0]) throw new PaymentError('No account', ERROR_CODES.WALLET_ERROR);
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const iface = new ethers.utils.Interface(["function transfer(address,uint256) returns (bool)"]);
    const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
    const txHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: CONFIG.BSC.USDT_ADDRESS, data }] });
    return { txHash, network: 'BSC', explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` };
}

async function executeTronTransfer(recipient, amount) {
    await connectTronLink();
    if (!window.tronWeb?.ready) throw new PaymentError('TronLink not ready', ERROR_CODES.PROVIDER_ERROR);
    const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
    const tx = await contract.transfer(recipient, Math.floor(amount * 1e6)).send({ feeLimit: 100_000_000 });
    const txHash = typeof tx === 'string' ? tx : tx?.transaction?.txID || tx?.txid;
    if (!txHash) throw new PaymentError('No tx hash', ERROR_CODES.TRANSACTION_ERROR);
    return { txHash, network: 'TRON', explorerUrl: `${CONFIG.TRON.EXPLORER}${txHash}` };
}

async function finalizePayment(txHash, network) {
    const res = await fetch('/api/onedream/finalize-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_hash: txHash, network: network.toLowerCase() }) });
    return res.json();
}

// ======================================================
// 🧩  UI COMPONENTS
// ======================================================

function createModal(content) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] p-4 crypto-modal-fade-in';
    m.innerHTML = content;
    document.body.appendChild(m);
    return m;
}

function generateQR(text, elementId) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(text)}" class="mx-auto rounded" alt="QR"/>`;
}

function showNetworkModal(preferred) {
    return new Promise(resolve => {
        const m = createModal(`
            <div class="bg-white p-6 rounded-2xl w-full max-w-sm text-center">
                <h3 class="font-bold text-xl mb-4">Select Payment Method</h3>
                <button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 font-bold py-4 rounded-xl mb-3">🟡 BSC (USDT BEP-20)${preferred === 'BSC' ? ' ✓' : ''}</button>
                <button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl mb-3">🔴 TRON (USDT TRC-20)${preferred === 'TRON' ? ' ✓' : ''}</button>
                <button id="manual" class="w-full bg-gray-100 hover:bg-gray-200 font-semibold py-3 rounded-xl mb-4">📋 Manual Transfer / QR</button>
                <button id="cancel" class="text-gray-400 text-sm">Cancel</button>
            </div>
        `);
        m.querySelector('#bsc').onclick = () => { m.remove(); resolve('BSC'); };
        m.querySelector('#tron').onclick = () => { m.remove(); resolve('TRON'); };
        m.querySelector('#manual').onclick = () => { m.remove(); resolve('MANUAL'); };
        m.querySelector('#cancel').onclick = () => { m.remove(); resolve(null); };
    });
}

function showManualModal(amount) {
    return new Promise(resolve => {
        const m = createModal(`
            <div class="bg-white p-6 rounded-2xl w-full max-w-sm text-center">
                <h3 class="font-bold text-lg mb-4">Manual Payment</h3>
                <div class="flex gap-2 mb-4">
                    <button id="m-bsc" class="flex-1 py-2 rounded-lg bg-yellow-400 font-bold text-sm">BSC</button>
                    <button id="m-tron" class="flex-1 py-2 rounded-lg bg-gray-100 font-bold text-sm">TRON</button>
                </div>
                <div id="qr-target" class="mb-4 bg-gray-50 p-3 rounded-lg min-h-[200px]"></div>
                <div class="text-left mb-4">
                    <p class="text-xs text-gray-400 uppercase font-bold mb-1">Address</p>
                    <div class="bg-gray-100 p-2 rounded text-xs font-mono break-all" id="addr-txt"></div>
                </div>
                <p class="text-sm mb-4">Send exactly <b>${amount} USDT</b></p>
                <input type="text" id="tx-input" placeholder="Paste tx hash (optional)" class="w-full p-3 border rounded-lg text-sm mb-3"/>
                <button id="done-btn" class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold mb-2">✅ I've Sent It</button>
                <button id="cancel-btn" class="text-gray-400 text-sm">Cancel</button>
            </div>
        `);

        let net = 'BSC';
        const update = (n) => {
            net = n;
            const addr = n === 'BSC' ? CONFIG.BSC.WALLET_ADDRESS : CONFIG.TRON.WALLET_ADDRESS;
            m.querySelector('#addr-txt').textContent = addr;
            generateQR(addr, 'qr-target');
            m.querySelector('#m-bsc').className = `flex-1 py-2 rounded-lg font-bold text-sm ${n === 'BSC' ? 'bg-yellow-400' : 'bg-gray-100'}`;
            m.querySelector('#m-tron').className = `flex-1 py-2 rounded-lg font-bold text-sm ${n === 'TRON' ? 'bg-red-600 text-white' : 'bg-gray-100'}`;
        };

        m.querySelector('#m-bsc').onclick = () => update('BSC');
        m.querySelector('#m-tron').onclick = () => update('TRON');
        m.querySelector('#done-btn').onclick = () => {
            const tx = m.querySelector('#tx-input').value.trim();
            m.remove();
            resolve({ success: true, manual: true, network: net, txHash: tx || null });
        };
        m.querySelector('#cancel-btn').onclick = () => { m.remove(); resolve({ success: false, cancelled: true }); };
        update('BSC');
    });
}

function showStatusModal() {
    return createModal(`
        <div class="bg-white p-8 rounded-2xl w-full max-w-xs text-center">
            <div class="loading-spinner mx-auto mb-4"></div>
            <h3 id="status-h" class="font-bold text-lg mb-1">Connecting...</h3>
            <p id="status-p" class="text-gray-500 text-sm mb-4">Confirm in your wallet</p>
            <div id="status-actions" class="hidden">
                <a id="explorer-l" href="#" target="_blank" class="text-blue-500 text-sm underline block mb-4">View Transaction</a>
                <button id="status-close" class="w-full bg-gray-100 py-2 rounded-lg">Close</button>
            </div>
        </div>
    `);
}

// ======================================================
// 🚀  MAIN CONTROLLER
// ======================================================

const CryptoPayments = {
    CONFIG,
    
    async start(amount, participantId, voteCount) {
        try {
            const pref = window.tronWeb?.ready ? 'TRON' : (window.ethereum ? 'BSC' : null);
            const choice = await showNetworkModal(pref);
            if (!choice) return { success: false, cancelled: true };

            if (choice === 'MANUAL') {
                const result = await showManualModal(amount);
                if (result.success && result.txHash) {
                    try { await finalizePayment(result.txHash, result.network); } catch {}
                }
                return result;
            }

            const modal = showStatusModal();
            const h = modal.querySelector('#status-h');
            const p = modal.querySelector('#status-p');

            try {
                let result;
                if (choice === 'BSC') {
                    const provider = await connectWallet();
                    h.textContent = 'Sign Transaction';
                    result = await executeBSCTransfer(provider, CONFIG.BSC.WALLET_ADDRESS, amount);
                } else {
                    result = await executeTronTransfer(CONFIG.TRON.WALLET_ADDRESS, amount);
                }

                h.textContent = 'Success!';
                h.className = 'font-bold text-lg mb-1 text-green-600';
                p.textContent = 'Payment submitted';
                modal.querySelector('.loading-spinner')?.remove();
                modal.querySelector('#status-actions').classList.remove('hidden');
                modal.querySelector('#explorer-l').href = result.explorerUrl;
                modal.querySelector('#status-close').onclick = () => modal.remove();

                await finalizePayment(result.txHash, result.network);
                return { success: true, ...result };

            } catch (err) {
                h.textContent = 'Failed';
                h.className = 'font-bold text-lg mb-1 text-red-600';
                p.textContent = err.message || 'Request rejected';
                modal.querySelector('.loading-spinner')?.remove();
                modal.querySelector('#status-actions').classList.remove('hidden');
                modal.querySelector('#status-close').onclick = () => modal.remove();
                return { success: false, error: err.message };
            }

        } catch (err) {
            console.error('[CryptoPayments]', err);
            alert('Payment error. Try manual transfer.');
            return { success: false, error: err.message };
        }
    },

    // Compatibility aliases
    async initiate(participantId, voteCount, amount) { return this.start(amount, participantId, voteCount); },
    async process() {
        const pid = window.currentParticipant?.id;
        const votes = window.selectedVoteAmount;
        const amt = window.selectedPaymentAmount || votes * 0.5;
        if (!pid || !votes) return { success: false, error: 'Missing details' };
        return this.start(amt, pid, votes);
    }
};

// ======================================================
// 🌍  EXPORTS
// ======================================================

window.CryptoPayments = CryptoPayments;
window.processCryptoPayment = () => CryptoPayments.process();
window.initiateCryptoPayment = (pid, votes, amt) => CryptoPayments.initiate(pid, votes, amt);

console.log('✅ Crypto Payments module loaded');