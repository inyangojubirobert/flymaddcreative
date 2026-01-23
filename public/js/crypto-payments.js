console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   🔒 WALLETCONNECT LOADER
====================================================== */
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
   🔒 BACKEND INITIALIZATION
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
        return { success: false };
    }

    const network = await showNetworkSelectionModal();
    if (!network) return { success: false, cancelled: true };

    try {
        const init = await initializeCryptoPayment(participantId, voteCount, network);

        if (network === 'bsc') return await processBSC(init);
        if (network === 'tron') return await processTron(init);

        throw new Error('Unsupported network');
    } catch (err) {
        console.error('❌ Crypto Payment Error:', err);
        return { success: false, error: err.message };
    }
}

/* ======================================================
   🟡 BSC – USDT (BEP-20)
====================================================== */
async function processBSC(init) {
    const isInjected = window.ethereum;

    if (isInjected) return processBSCInjected(init);
    return processBSCWalletConnect(init);
}

async function processBSCInjected(init) {
    const modal = showPaymentStatusModal('BSC', init.amount);

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = provider.getSigner();

        updateStatus(modal, 'Confirm USDT transfer…');

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
            showQrModal: true,
            methods: ['eth_sendTransaction'],
            qrModalOptions: { themeMode: 'dark' }
        });

        updateStatus(modal, 'Connect your wallet…');
        await provider.connect();

        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        updateStatus(modal, 'Confirm USDT transfer…');

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

/* ======================================================
   🔴 TRON – USDT (TRC-20)
====================================================== */
async function processTron(init) {
    const modal = showPaymentStatusModal('TRON', init.amount);

    try {
        if (!window.tronWeb || !window.tronWeb.ready) {
            modal.remove();
            return showTronQR(init);
        }

        const contract = await tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
        const amount = Math.floor(init.amount * 1e6);

        updateStatus(modal, 'Confirm in TronLink…');
        const tx = await contract.transfer(init.recipient_address, amount).send();

        successStatus(modal);
        return finalize(tx, 'tron');
    } catch (err) {
        errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

function showTronQR(init) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';

    modal.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80">
            <h3 class="font-bold mb-3">TRON USDT</h3>
            <div id="tronQR"></div>
            <p class="text-sm mt-2">${init.amount} USDT</p>
            <button id="closeTron" class="mt-4 text-gray-500">Cancel</button>
        </div>
    `;

    document.body.appendChild(modal);
    generateQR(init.recipient_address, 'tronQR');

    modal.querySelector('#closeTron').onclick = () => modal.remove();
    return { success: false };
}

/* ======================================================
   🧩 UI HELPERS
====================================================== */
function showPaymentStatusModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
    m.innerHTML = `
        <div class="bg-white p-6 rounded-xl text-center w-80">
            <h3 class="font-bold mb-2">${network} Payment</h3>
            <p class="text-xl font-bold mb-4">${amount} USDT</p>
            <div id="statusText">Initializing…</div>
            <div class="loading-spinner mx-auto mt-4"></div>
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
    setTimeout(() => modal.remove(), 2000);
}

function errorStatus(modal, msg) {
    modal.querySelector('#statusText').textContent = '❌ ' + msg;
    modal.querySelector('.loading-spinner')?.remove();
}

function finalize(txHash, network) {
    return {
        success: true,
        payment_method: 'crypto',
        payment_reference: txHash,
        network
    };
}

function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const m = document.createElement('div');
        m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
        m.innerHTML = `
            <div class="bg-white p-6 rounded-xl w-72 text-center">
                <h3 class="font-bold mb-4">Choose Network</h3>
                <button id="bsc" class="w-full bg-yellow-400 py-3 rounded mb-3">🟡 BSC</button>
                <button id="tron" class="w-full bg-red-600 text-white py-3 rounded">🔴 TRON</button>
            </div>
        `;
        document.body.appendChild(m);
        m.querySelector('#bsc').onclick = () => { m.remove(); resolve('bsc'); };
        m.querySelector('#tron').onclick = () => { m.remove(); resolve('tron'); };
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
