console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

/* ======================================================
   🔒 CONFIGURATION & ADDRESSES
====================================================== */
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"; // BEP-20
const TRON_USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";          // TRC-20 (Mainnet)

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
/* ======================================================
   🟡 BSC – USDT (BEP-20) – PRODUCTION READY
====================================================== */

async function processBSC(init) {
    if (typeof ethers === 'undefined') {
        alert("Payment library (ethers.js) failed to load. Please refresh.");
        return { success: false };
    }

    // Desktop wallet
    if (window.ethereum) {
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            await ensureBSCNetwork(provider);
            const signer = await provider.getSigner();
            return await executeBSCTransfer(signer, init);
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Mobile wallets (WalletConnect)
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
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Shared function to perform BSC USDT transfer
async function executeBSCTransfer(signer, init, mobile = false) {
    const modal = showPaymentStatusModal(mobile ? 'BSC (Mobile)' : 'BSC', init.amount);
    try {
        const usdt = new ethers.Contract(BSC_USDT_ADDRESS, ['function transfer(address,uint256) returns (bool)'], signer);
        updateStatus(modal, 'Confirming USDT transfer…');

        const tx = await usdt.transfer(init.recipient_address, ethers.parseUnits(init.amount.toString(), 18));
        updateStatus(modal, 'Waiting for network confirmation…');
        await tx.wait(); // waits for 1 confirmation by default

        successStatus(modal);
        return finalize(tx.hash, 'bsc');
    } catch (err) {
        if (err.code === 4001) errorStatus(modal, "User rejected the transaction");
        else if (err.message.includes('insufficient')) errorStatus(modal, "Insufficient BNB for gas fee");
        else errorStatus(modal, err.message);
        return { success: false, error: err.message };
    }
}

// Ensure the user is on Binance Smart Chain
async function ensureBSCNetwork(provider) {
    const { chainId } = await provider.getNetwork();
    if (chainId !== 56n) { // 56 = BSC
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }]
            });
        } catch (err) {
            // Add chain if missing
            if (err.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: '0x38',
                        chainName: 'Binance Smart Chain',
                        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                        rpcUrls: ['https://bsc-dataseed.binance.org/'],
                        blockExplorerUrls: ['https://bscscan.com/']
                    }]
                });
            } else {
                throw err; // rethrow other errors
            }
        }
    }
}

/* ======================================================
   🔴 TRON – USDT (TRC-20)
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

            successStatus(modal);
            return finalize(tx, 'tron');
        }

        // Fallback QR for users not in TronLink
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
    modal.querySelector('.loading-spinner')?.remove();
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
