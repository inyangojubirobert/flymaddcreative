console.log('📦 Crypto Payments Module Loading (WalletConnect v2 Multi-Platform)...');

/* ======================================================
    🔒 SECURE CRYPTO PAYMENT INITIALIZATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: participantId,
            vote_count: voteCount,
            network: network
        })
    });
    if (!res.ok) throw new Error('Failed to initialize payment backend');
    return res.json();
}

/* ======================================================
    🆕 MAIN ENTRY POINT
====================================================== */
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Missing participant info or vote amount.');
        return { success: false, error: 'Missing metadata' };
    }

    const network = await showNetworkSelectionModal();
    if (!network) return { success: false, error: 'Cancelled' };

    try {
        const paymentInit = await initializeCryptoPayment(participantId, voteCount, network);
        
        if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
        if (network === 'tron') return await processUSDTPaymentTron(paymentInit);
    } catch (err) {
        console.error('Payment Flow Error:', err);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 BSC USDT (BEP-20) - SMART ROUTING
====================================================== */
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    
    // 1. If inside a mobile wallet browser (MetaMask/Trust Browser)
    if (window.ethereum && isMobile) {
        return await processBSCWithInjectedWallet(paymentInit);
    }

    // 2. Otherwise (Desktop OR Mobile Chrome/Safari), use WalletConnect
    return await processBSCWithWalletConnect(paymentInit);
}

async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    
    try {
        if (typeof window.loadWalletConnect === 'function') {
            await window.loadWalletConnect();
        }

        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5',
            chains: [56], 
            showQrModal: true, // AUTO-HANDLES: Desktop (QR) vs Mobile (Wallet List)
            methods: ["eth_sendTransaction", "personal_sign"],
            qrModalOptions: { themeMode: 'dark' }
        });

        updateModalStatus(modal, '📱 Connect your wallet...', 'waiting');
        await provider.connect();

        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        updateModalStatus(modal, '💸 Confirming USDT Transfer...', 'loading');

        const usdtContract = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(
            paymentInit.recipient_address,
            ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        updateModalStatus(modal, '⛓️ Verifying on Blockchain...', 'pending');
        await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Successful!', 'success');
        setTimeout(() => modal.remove(), 2500);
        return { success: true, txHash: tx.hash, network: 'bsc' };

    } catch (err) {
        updateModalStatus(modal, `❌ ${err.message}`, 'error');
        setTimeout(() => modal.remove(), 4000);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 TRON USDT (TRC-20)
====================================================== */
async function processUSDTPaymentTron(paymentInit) {
    // 1. Injected (TronLink Extension/Mobile App Browser)
    if (window.tronWeb && window.tronWeb.ready) {
        const modal = showEnhancedPaymentModal('TRON', paymentInit.amount);
        try {
            const contract = await window.tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
            const amount = Math.floor(paymentInit.amount * 1e6);
            const tx = await contract.transfer(paymentInit.recipient_address, amount).send();
            modal.remove();
            return { success: true, txHash: tx, network: 'tron' };
        } catch (err) {
            updateModalStatus(modal, `❌ ${err}`, 'error');
            return { success: false, error: err };
        }
    }

    // 2. Mobile Deep Link / QR for standard browsers
    return await processTronWithQRCode(paymentInit);
}

async function processTronWithQRCode(paymentInit) {
    const amountSun = Math.floor(paymentInit.amount * 1e6);
    const deepLink = `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${amountSun}&receiver=${paymentInit.recipient_address}`;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
            <h3 class="text-xl font-bold mb-4">🔴 TRON (TRC-20)</h3>
            <div id="tronQR" class="mb-4 bg-gray-100 p-2 rounded-lg"></div>
            <a href="${deepLink}" class="block w-full bg-red-600 text-white py-3 rounded-xl font-bold mb-2">Open Tron Wallet</a>
            <button id="closeTron" class="text-gray-400 text-sm">Cancel</button>
        </div>`;
    document.body.appendChild(modal);

    generateQR(paymentInit.recipient_address, 'tronQR');
    
    return new Promise(resolve => {
        modal.querySelector('#closeTron').onclick = () => { modal.remove(); resolve({success: false}); };
    });
}

/* ======================================================
    🔹 UI HELPERS
===================================================== */
function showEnhancedPaymentModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-6';
    m.innerHTML = `
        <div class="bg-white p-8 rounded-2xl text-center max-w-sm w-full shadow-2xl">
            <h3 class="text-xl font-bold text-gray-800 mb-2">${network} Payment</h3>
            <p class="text-blue-600 text-2xl font-bold mb-6">${amount} USDT</p>
            <div id="modalStatus" class="text-gray-500 mb-4">Connecting...</div>
            <div class="loading-spinner mx-auto"></div>
        </div>`;
    document.body.appendChild(m);
    return m;
}

function updateModalStatus(modal, text, status) {
    if (!modal) return;
    const s = modal.querySelector('#modalStatus');
    s.textContent = text;
    if (status === 'success' || status === 'error') modal.querySelector('.loading-spinner').style.display = 'none';
}

async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-xs w-full shadow-2xl">
                <h3 class="text-lg font-bold mb-4 text-center">Choose USDT Network</h3>
                <button id="selBsc" class="w-full bg-yellow-400 py-4 rounded-xl mb-3 font-bold">🟡 BSC (BEP-20)</button>
                <button id="selTron" class="w-full bg-red-600 text-white py-4 rounded-xl font-bold">🔴 TRON (TRC-20)</button>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#selBsc').onclick = () => { modal.remove(); resolve('bsc'); };
        modal.querySelector('#selTron').onclick = () => { modal.remove(); resolve('tron'); };
    });
}

function generateQR(text, id) {
    const url = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(text)}`;
    document.getElementById(id).innerHTML = `<img src="${url}" class="mx-auto" />`;
}

// EXPORTS
window.processCryptoPayment = processCryptoPayment;