// ======================================================
// 🏗️ INITIALIZATION & CONFIGURATION
// ======================================================

if (typeof window === 'undefined') {
    throw new Error('This script is designed to run in a browser environment');
}

const CONFIG = {
    BSC: {
        USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        RPC_URL: window.env?.NEXT_PUBLIC_BSC_RPC_URL || "https://bsc-dataseed.binance.org/",
        CHAIN_ID: parseInt(window.env?.NEXT_PUBLIC_CRYPTO_CHAIN_ID, 10) || 56,
        EXPLORER: "https://bscscan.com/tx/",
        WALLET_ADDRESS: window.env?.NEXT_PUBLIC_CRYPTO_WALLET_ADDRESS_BSC || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
    },
    TRON: {
        USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        EXPLORER: "https://tronscan.org/#/transaction/",
        GRID_API: window.env?.NEXT_PUBLIC_TRON_GRID_API || "https://api.trongrid.io",
        API_KEY: window.env?.NEXT_PUBLIC_TRON_PRO_API_KEY || "72ea8cc8-c0fb-44b6-8d07-f41bb5edc04c",
        WALLET_ADDRESS: window.env?.NEXT_PUBLIC_CRYPTO_WALLET_ADDRESS_TRON || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
    },
    WALLETCONNECT: {
        SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
        PROJECT_ID: window.WALLETCONNECT_PROJECT_ID || "9722384918e775168018e692257007f3" // Fallback project ID
    },
    LIMITS: {
        MAX_RETRIES: 3,
        TIMEOUT_MS: 300000, 
        ATTEMPT_TIMEOUT: 5 * 60 * 1000 
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

const paymentAttempts = new Map();

// ======================================================
// 🛡️ ERROR HANDLING & STYLES
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

// Inject Required CSS
(function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .payment-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 9999; font-family: sans-serif; }
        .payment-modal-card { background: white; padding: 24px; border-radius: 16px; width: 340px; max-width: 90vw; text-align: center; color: #1a1a1a; box-shadow: 0 10px 25px rgba(0,0,0,0.2); }
        .loading-spinner { border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 15px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .btn-pay { width: 100%; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; border: none; margin-bottom: 10px; transition: opacity 0.2s; }
        .btn-bsc { background: #F3BA2F; color: black; }
        .btn-tron { background: #FF0013; color: white; }
        .qr-container { background: #f9f9f9; padding: 10px; border-radius: 8px; margin: 15px 0; }
        .text-xs { font-size: 12px; word-break: break-all; color: #666; }
    `;
    document.head.appendChild(style);
})();

// ======================================================
// 🔌 UTILITY FUNCTIONS
// ======================================================

function validateInputs(participantId, voteCount) {
    if (!participantId) throw new PaymentError('Invalid participant ID', ERROR_CODES.INVALID_INPUT);
    if (!voteCount || isNaN(voteCount) || voteCount <= 0) throw new PaymentError('Invalid vote count', ERROR_CODES.INVALID_INPUT);
}

function checkRateLimit(participantId) {
    const now = Date.now();
    const attempts = paymentAttempts.get(participantId) || [];
    const recentAttempts = attempts.filter(t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT);
    if (recentAttempts.length >= CONFIG.LIMITS.MAX_RETRIES) {
        throw new PaymentError('Too many attempts. Please wait 5 minutes.', ERROR_CODES.RATE_LIMIT);
    }
    paymentAttempts.set(participantId, [...recentAttempts, now]);
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function trackEvent(name, metadata = {}) {
    if (window.analytics) window.analytics.track(name, metadata);
    console.log(`[Analytics] ${name}`, metadata);
}

// ======================================================
// 🌐 NETWORK & WALLET MANAGEMENT
// ======================================================

async function detectPreferredNetwork() {
    try {
        if (window.tronWeb && window.tronWeb.ready) return 'TRON';
        if (window.ethereum) {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            if (chainId === '0x38') return 'BSC';
        }
    } catch (e) { console.warn('Detection error', e); }
    return null;
}

async function loadWalletConnect() {
    if (window.WalletConnectProvider) return window.WalletConnectProvider;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CONFIG.WALLETCONNECT.SRC;
        script.onload = () => resolve(window.EthereumProvider);
        script.onerror = () => reject(new PaymentError('WC Load Failed', ERROR_CODES.DEPENDENCY_ERROR));
        document.head.appendChild(script);
    });
}

async function ensureBSCNetwork(provider) {
    const chainIdHex = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        });
    } catch (err) {
        if (err.code === 4902) {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: chainIdHex,
                    chainName: 'Binance Smart Chain',
                    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                    rpcUrls: [CONFIG.BSC.RPC_URL],
                    blockExplorerUrls: ['https://bscscan.com/']
                }]
            });
        } else throw err;
    }
}

// ======================================================
// 🏦 PAYMENT LOGIC
// ======================================================

async function executeBSCTransfer(signer, recipient, amount) {
    const usdtContract = new ethers.Contract(
        CONFIG.BSC.USDT_ADDRESS,
        ['function transfer(address,uint256) returns (bool)'],
        signer
    );
    const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
    const tx = await usdtContract.transfer(recipient, amountWei);
    const receipt = await tx.wait();
    return { txHash: tx.hash, network: 'BSC', explorerUrl: `${CONFIG.BSC.EXPLORER}${tx.hash}` };
}

async function executeTronTransfer(recipient, amount) {
    const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
    const amountSun = Math.floor(amount * 1_000_000);
    const txID = await contract.transfer(recipient, amountSun).send();
    if (!txID) throw new Error('TRON Transaction failed');
    return { txHash: txID, network: 'TRON', explorerUrl: `${CONFIG.TRON.EXPLORER}${txID}` };
}

// ======================================================
// 🧩 UI COMPONENTS
// ======================================================

function createModal(content) {
    const overlay = document.createElement('div');
    overlay.className = 'payment-modal-overlay';
    overlay.innerHTML = `<div class="payment-modal-card">${content}</div>`;
    document.body.appendChild(overlay);
    return overlay;
}

async function showNetworkSelectionModal(preferredNetwork) {
    return new Promise((resolve) => {
        const modal = createModal(`
            <h3 style="margin-top:0">Select Payment Network</h3>
            <p style="font-size:14px; color: #666">USDT is accepted on both networks</p>
            <button id="btnBSC" class="btn-pay btn-bsc">🟡 BSC (BEP-20) ${preferredNetwork === 'BSC' ? '✓' : ''}</button>
            <button id="btnTron" class="btn-pay btn-tron">🔴 TRON (TRC-20) ${preferredNetwork === 'TRON' ? '✓' : ''}</button>
            <button id="btnCancel" style="background:none; border:none; color:#999; cursor:pointer">Cancel</button>
        `);
        modal.querySelector('#btnBSC').onclick = () => { modal.remove(); resolve('BSC'); };
        modal.querySelector('#btnTron').onclick = () => { modal.remove(); resolve('TRON'); };
        modal.querySelector('#btnCancel').onclick = () => { modal.remove(); resolve(null); };
    });
}

async function showManualModal(network, recipient, amount) {
    return new Promise((resolve) => {
        const qrData = network === 'BSC' 
            ? `ethereum:${CONFIG.BSC.USDT_ADDRESS}/transfer?address=${recipient}&uint256=${amount}e18`
            : recipient; // Standard Tron Address for simple wallets

        const modal = createModal(`
            <h3>Send ${amount} USDT</h3>
            <p style="font-size:12px">${network === 'BSC' ? 'Binance Smart Chain (BEP20)' : 'TRON Network (TRC20)'}</p>
            <div class="qr-container" id="qrTarget"></div>
            <div class="text-xs">${recipient}</div>
            <button id="copyAddr" class="btn-pay" style="background:#eee; margin-top:10px">Copy Address</button>
            <button id="btnSent" class="btn-pay" style="background:#2ecc71; color:white">I have sent the payment</button>
            <button id="btnBack" style="background:none; border:none; color:#999; cursor:pointer">Cancel</button>
        `);

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}`;
        modal.querySelector('#qrTarget').innerHTML = `<img src="${qrUrl}" alt="QR" style="width:180px" />`;
        
        modal.querySelector('#copyAddr').onclick = () => {
            navigator.clipboard.writeText(recipient);
            modal.querySelector('#copyAddr').textContent = 'Copied!';
        };
        
        modal.querySelector('#btnSent').onclick = () => {
            modal.remove();
            resolve({ manual: true, success: true });
        };
        
        modal.querySelector('#btnBack').onclick = () => { modal.remove(); resolve({ success: false }); };
    });
}

// ======================================================
// 🚀 MAIN PROCESS
// ======================================================

async function processCryptoPayment() {
    let statusModal = null;
    try {
        const pId = window.currentParticipant?.id;
        const vCount = window.selectedVoteAmount;

        validateInputs(pId, vCount);
        checkRateLimit(pId);

        const pref = await detectPreferredNetwork();
        const network = await showNetworkSelectionModal(pref);
        if (!network) return { success: false, cancelled: true };

        // 1. Backend Init
        trackEvent('payment_start', { network });
        const initResp = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ participant_id: pId, vote_count: vCount, network: network.toLowerCase() })
        });
        const initData = await initResp.json();
        if (!initResp.ok) throw new Error(initData.message || 'Server error');

        statusModal = createModal(`
            <h3>Processing...</h3>
            <div class="loading-spinner"></div>
            <p id="statusMsg">Connecting to wallet</p>
        `);

        let txResult;

        if (network === 'BSC') {
            if (window.ethereum && !isMobileDevice()) {
                const provider = new ethers.providers.Web3Provider(window.ethereum);
                await ensureBSCNetwork(provider);
                await provider.send("eth_requestAccounts", []);
                txResult = await executeBSCTransfer(provider.getSigner(), initData.recipient_address, initData.amount);
            } else if (isMobileDevice()) {
                const EthereumProvider = await loadWalletConnect();
                const wcProvider = await EthereumProvider.init({
                    projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
                    chains: [CONFIG.BSC.CHAIN_ID],
                    showQrModal: true
                });
                await wcProvider.connect();
                const provider = new ethers.providers.Web3Provider(wcProvider);
                txResult = await executeBSCTransfer(provider.getSigner(), initData.recipient_address, initData.amount);
            } else {
                statusModal.remove();
                txResult = await showManualModal('BSC', initData.recipient_address, initData.amount);
            }
        } else {
            if (window.tronWeb && window.tronWeb.ready) {
                txResult = await executeTronTransfer(initData.recipient_address, initData.amount);
            } else {
                statusModal.remove();
                txResult = await showManualModal('TRON', initData.recipient_address, initData.amount);
            }
        }

        // 2. Finalize
        if (txResult.success !== false) {
            if (statusModal) statusModal.querySelector('#statusMsg').textContent = "Verifying on blockchain...";
            
            const finalResp = await fetch('/api/onedream/finalize-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    transaction_hash: txResult.txHash || 'MANUAL_PENDING', 
                    network: network.toLowerCase() 
                })
            });

            if (statusModal) {
                statusModal.innerHTML = `<h3>✅ Success!</h3><p>Your votes are being processed.</p>`;
                setTimeout(() => statusModal.remove(), 4000);
            }
            return await finalResp.json();
        }

    } catch (err) {
        console.error('Payment Flow Error:', err);
        if (statusModal) {
            statusModal.innerHTML = `<h3 style="color:red">❌ Error</h3><p style="font-size:14px">${err.message}</p>
            <button onclick="this.parentElement.parentElement.remove()" class="btn-pay">Close</button>`;
        }
        return { success: false, error: err.message };
    }
}

// ======================================================
// 🏁 STARTUP
// ======================================================

async function initSystem() {
    if (typeof ethers === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdn.ethers.io/lib/ethers-5.7.2.min.js';
        document.head.appendChild(s);
    }
    window.processCryptoPayment = processCryptoPayment;
    console.log("🚀 Payment System Loaded");
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSystem);
} else {
    initSystem();
}