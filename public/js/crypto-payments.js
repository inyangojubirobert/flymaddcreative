console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   📱 UTILS & DETECTION
====================================================== */
const isMobile = () =>
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

/* ======================================================
   🔒 WALLETCONNECT + MODAL LOADER (REQUIRED FOR MOBILE)
====================================================== */
async function loadWalletConnect() {
    if (window.EthereumProvider && window.WalletConnectModal) return;

    await Promise.all([
        new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        }),
        new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/@walletconnect/modal@2.6.2/dist/index.umd.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        })
    ]);

    console.log('✅ WalletConnect v2 + Modal loaded');
}

/* ======================================================
   🔒 BACKEND INITIALIZATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network })
    });

    if (!res.ok) throw new Error('Backend failed to initialize transaction');
    return res.json();
}

/* ======================================================
   🆕 MAIN ENTRY
====================================================== */
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Please select a participant and vote amount first.');
        return { success: false };
    }

    const network = await showNetworkSelectionModal();
    if (!network) return { success: false, cancelled: true };

    try {
        const init = await initializeCryptoPayment(participantId, voteCount, network);
        if (network === 'bsc') return await processBSC(init);
        if (network === 'tron') return await processTron(init);
    } catch (err) {
        console.error('❌ Payment Error:', err);
        alert(err.message);
        return { success: false, error: err.message };
    }
}

/* ======================================================
   🟡 BSC – USDT (BEP-20)
====================================================== */
async function processBSC(init) {
    const shouldUseInjected = window.ethereum && !isMobile();
    return shouldUseInjected
        ? processBSCInjected(init)
        : processBSCWalletConnect(init);
}

async function processBSCInjected(init) {
    const modal = showPaymentStatusModal('BSC', init.amount);

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = provider.getSigner();

        updateStatus(modal, 'Confirming USDT transfer…');

        const usdt = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        const tx = await usdt.transfer(
            init.recipient_address,
            ethers.utils.parseUnits(init.amount.toString(), 18)
        );

        updateStatus(modal, 'Waiting for confirmation…');
        await tx.wait(1);

        successStatus(modal);
        return finalize(tx.hash, 'bsc');
    } catch (err) {
        errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

async function processBSCWalletConnect(init) {
    const modal = showPaymentStatusModal('BSC', init.amount);

    try {
        await loadWalletConnect();

        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,

            chains: [56],
            optionalChains: [1, 137],

            rpcMap: {
                56: 'https://bsc-dataseed.binance.org/'
            },

            methods: [
                'eth_sendTransaction',
                'eth_signTransaction',
                'eth_sign',
                'personal_sign'
            ],

            metadata: {
                name: 'OneDream Voting',
                description: 'Secure Crypto Payment',
                url: window.location.origin,
                icons: ['https://walletconnect.com/walletconnect-logo.png']
            },

            showQrModal: true,

            qrModalOptions: {
                themeMode: 'dark',
                explorerRecommendedWalletIds: [
                    'c57ca95b47569778a828d19178116bd0', // MetaMask
                    '4622a2b2d6af6a4d0c11f85a03c43b7e', // Trust Wallet
                    '38f5d18bd8522c244bdd70cb4a68e0f5'  // OKX
                ]
            }
        });

        updateStatus(modal, 'Connecting wallet…');
        await provider.connect();

        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        updateStatus(modal, 'Requesting USDT transfer…');

        const usdt = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        const tx = await usdt.transfer(
            init.recipient_address,
            ethers.utils.parseUnits(init.amount.toString(), 18)
        );

        updateStatus(modal, 'Confirming on-chain…');
        await tx.wait(1);

        successStatus(modal);
        return finalize(tx.hash, 'bsc');
    } catch (err) {
        errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

/* ======================================================
   🔴 TRON – USDT (TRC-20)
====================================================== */
async function processTron(init) {
    if (window.tronWeb && window.tronWeb.ready) {
        const modal = showPaymentStatusModal('TRON', init.amount);
        try {
            const contract = await tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
            const amount = Math.floor(init.amount * 1e6);

            updateStatus(modal, 'Confirm in TronLink…');
            const tx = await contract.transfer(init.recipient_address, amount).send();

            successStatus(modal);
            return finalize(tx, 'tron');
        } catch (err) {
            errorStatus(modal, err.message);
            return { success: false };
        }
    }
    return showTronManualModal(init);
}

function showTronManualModal(init) {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-white p-6 rounded-2xl text-center w-full max-w-sm">
                <h3 class="font-bold text-lg mb-1">TRON (TRC-20)</h3>
                <p class="text-sm mb-4">Send exactly <b>${init.amount} USDT</b></p>
                <div id="tronQR" class="flex justify-center mb-4"></div>
                <div class="bg-gray-100 p-3 rounded text-xs break-all mb-4">${init.recipient_address}</div>
                <button id="copyAddr" class="w-full bg-blue-600 text-white py-2 rounded mb-3">Copy Address</button>
                <button id="closeTron" class="w-full text-gray-500 py-2">Close</button>
            </div>
        `;
        document.body.appendChild(modal);
        generateQR(init.recipient_address, 'tronQR');

        modal.querySelector('#copyAddr').onclick = () => {
            navigator.clipboard.writeText(init.recipient_address);
            modal.querySelector('#copyAddr').textContent = '✅ Copied!';
        };

        modal.querySelector('#closeTron').onclick = () => {
            modal.remove();
            resolve({ success: false, manual: true });
        };
    });
}

/* ======================================================
   🧩 UI HELPERS
====================================================== */
function showPaymentStatusModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    m.innerHTML = `
        <div class="bg-white p-8 rounded-2xl text-center w-full max-w-xs">
            <div class="text-xs font-bold mb-4">${network} NETWORK</div>
            <div class="text-3xl font-black mb-2">${amount} USDT</div>
            <div id="statusText" class="mb-6">Initializing…</div>
            <div class="loading-spinner mx-auto border-4 border-blue-600 border-t-transparent rounded-full w-10 h-10 animate-spin"></div>
        </div>
    `;
    document.body.appendChild(m);
    return m;
}

function updateStatus(modal, text) {
    modal.querySelector('#statusText').textContent = text;
}

function successStatus(modal) {
    modal.querySelector('#statusText').textContent = '✅ Payment confirmed';
    modal.querySelector('.loading-spinner').remove();
    setTimeout(() => modal.remove(), 3000);
}

function errorStatus(modal, msg) {
    modal.querySelector('#statusText').textContent = `❌ ${msg}`;
    modal.querySelector('.loading-spinner')?.remove();
}

function finalize(txHash, network) {
    return { success: true, payment_method: 'crypto', payment_reference: txHash, network };
}

function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const m = document.createElement('div');
        m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4';
        m.innerHTML = `
            <div class="bg-white p-6 rounded-2xl w-full max-w-sm text-center">
                <h3 class="font-bold text-xl mb-6">Select Network</h3>
                <button id="bscBtn" class="w-full bg-yellow-400 p-4 rounded-xl mb-4 font-bold">🟡 BSC (BEP-20)</button>
                <button id="tronBtn" class="w-full bg-red-600 text-white p-4 rounded-xl font-bold">🔴 TRON (TRC-20)</button>
                <button id="cancelBtn" class="mt-4 text-gray-400 text-sm">Cancel</button>
            </div>
        `;
        document.body.appendChild(m);
        m.querySelector('#bscBtn').onclick = () => { m.remove(); resolve('bsc'); };
        m.querySelector('#tronBtn').onclick = () => { m.remove(); resolve('tron'); };
        m.querySelector('#cancelBtn').onclick = () => { m.remove(); resolve(null); };
    });
}

function generateQR(text, id) {
    document.getElementById(id).innerHTML =
        `<img src="https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(text)}" />`;
}

/* ======================================================
   🔑 EXPORT
====================================================== */
window.processCryptoPayment = processCryptoPayment;
