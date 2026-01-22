console.log('📦 Crypto Payments Module Loading (WalletConnect v2 Multi-Platform)...');

/* ======================================================
   🔍 WALLET CONFLICT DETECTION (NON-FATAL)
====================================================== */
(function detectInjectedWalletConflicts() {
    try {
        const found = new Set();

        if (window.ethereum) {
            if (Array.isArray(window.ethereum.providers)) {
                window.ethereum.providers.forEach(p => {
                    if (p?.isMetaMask) found.add('MetaMask');
                    else if (p?.isCoinbaseWallet) found.add('Coinbase');
                    else found.add('Injected EVM');
                });
            } else {
                if (window.ethereum.isMetaMask) found.add('MetaMask');
                else found.add('Injected EVM');
            }
        }

        if (window.tronWeb) found.add('TronWeb');
        if (window.WalletConnectProvider || window.walletconnect) found.add('WalletConnect');

        if (found.size > 1) {
            console.warn('⚠️ Multiple wallets detected:', [...found].join(', '));
        }
    } catch {}
})();

/* ======================================================
   🧩 SAFE POLYFILLS (NO EVAL, CSP SAFE)
====================================================== */
async function loadScriptOnce(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
    });
}

async function ensureBrowserLibraries() {
    if (!window.Buffer) {
        try {
            await loadScriptOnce('https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js');
            window.Buffer = window.buffer?.Buffer || window.Buffer;
        } catch {
            console.warn('Buffer polyfill failed');
        }
    }

    if (!window.ethers) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js');
    }

    if (!window.TronWeb) {
        await loadScriptOnce('https://cdn.jsdelivr.net/npm/tronweb/dist/TronWeb.js');
    }

    if (!window.process) window.process = { env: {} };
    if (!window.global) window.global = window;
}

/* ======================================================
   🔌 WALLETCONNECT (UMD ONLY)
====================================================== */
async function loadWalletConnect() {
    if (window.EthereumProvider) return window.EthereumProvider;

    await ensureBrowserLibraries();

    await loadScriptOnce(
        'https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js'
    );

    window.EthereumProvider =
        window.EthereumProvider ||
        window.WalletConnectEthereumProvider ||
        window.WalletConnectProvider;

    if (!window.EthereumProvider) {
        throw new Error('WalletConnect failed to load');
    }

    return window.EthereumProvider;
}

/* ======================================================
   🔐 BACKEND INIT
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network })
    });

    if (!res.ok) throw new Error('Backend init failed');
    return res.json();
}

/* ======================================================
   🆕 MAIN ENTRY
====================================================== */
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Missing participant or vote amount');
        return;
    }

    const network = await showNetworkSelectionModal();
if (!network) return { success: false }; // always return an object

const paymentInit = await initializeCryptoPayment(participantId, voteCount, network);

if (network === 'bsc') return processUSDTPaymentBSC(paymentInit);
if (network === 'tron') return processUSDTPaymentTron(paymentInit);

return { success: false }; // fallback, should never reach here

}

/* ======================================================
   🟡 BSC USDT
====================================================== */
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    if (window.ethereum && isMobile) {
        return processBSCWithInjectedWallet(paymentInit);
    }

    return processBSCWithWalletConnect(paymentInit);
}

async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);

    try {
        const EthereumProvider = await loadWalletConnect();

        const provider = await EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56],
            optionalChains: [56],
            showQrModal: true
        });

        updateModalStatus(modal, '📱 Connect wallet...', 'waiting');
        await provider.connect();

        const ethersLib = window.ethers;
        const web3Provider = new ethersLib.providers.Web3Provider(provider, 'any');
        const signer = web3Provider.getSigner();

        const usdt = new ethersLib.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        updateModalStatus(modal, '💸 Sending USDT...', 'loading');

        const tx = await usdt.transfer(
            paymentInit.recipient_address,
            ethersLib.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        await tx.wait(1);

        updateModalStatus(modal, '✅ Payment successful', 'success');
        setTimeout(() => modal.remove(), 2000);

        return { success: true, txHash: tx.hash };
    } catch (e) {
        updateModalStatus(modal, e.message, 'error');
        return { success: false };
    }
}

/* ======================================================
   🟡 BSC – INJECTED WALLET (Trust / MetaMask)
====================================================== */
async function processBSCWithInjectedWallet(paymentInit) {
    await ensureBrowserLibraries();

    const ethersLib = window.ethers;
    const provider = new ethersLib.providers.Web3Provider(window.ethereum);
    await provider.send('eth_requestAccounts', []);

    const signer = provider.getSigner();

    const usdt = new ethersLib.Contract(
        '0x55d398326f99059fF775485246999027B3197955',
        ['function transfer(address,uint256) returns (bool)'],
        signer
    );

    const tx = await usdt.transfer(
        paymentInit.recipient_address,
        ethersLib.utils.parseUnits(paymentInit.amount.toString(), 18)
    );

    return { success: true, txHash: tx.hash };
}

/* ======================================================
   🔴 TRON
====================================================== */
async function processUSDTPaymentTron(paymentInit) {
    if (window.tronWeb?.ready) {
        const contract = await tronWeb.contract().at(
            'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
        );
        const amount = Math.floor(paymentInit.amount * 1e6);
        const tx = await contract.transfer(paymentInit.recipient_address, amount).send();
        return { success: true, txHash: tx };
    }

    return processTronWithQRCode(paymentInit);
}

/* ======================================================
   🖼️ UI HELPERS (UNCHANGED)
====================================================== */
function showEnhancedPaymentModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    m.innerHTML = `
      <div class="bg-white p-6 rounded-xl text-center">
        <h3 class="font-bold mb-2">${network}</h3>
        <p class="mb-4">${amount} USDT</p>
        <div id="modalStatus">Connecting...</div>
      </div>`;
    document.body.appendChild(m);
    return m;
}

function updateModalStatus(m, text) {
    if (m) m.querySelector('#modalStatus').textContent = text;
}

async function showNetworkSelectionModal() {
    return new Promise(res => {
        const m = document.createElement('div');
        m.className = 'fixed inset-0 bg-black/60 flex items-center justify-center';
        m.innerHTML = `
          <div class="bg-white p-6 rounded-xl">
            <button id="bsc">BSC</button>
            <button id="tron">TRON</button>
          </div>`;
        document.body.appendChild(m);
        m.querySelector('#bsc').onclick = () => { m.remove(); res('bsc'); };
        m.querySelector('#tron').onclick = () => { m.remove(); res('tron'); };
    });
}

/* ======================================================
   🌍 EXPORTS
====================================================== */
window.processCryptoPayment = processCryptoPayment;
window.processBSCWithInjectedWallet = processBSCWithInjectedWallet;
window.loadWalletConnect = loadWalletConnect;
