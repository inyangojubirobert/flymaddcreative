console.log('📦 Crypto Payments Module Loading (WC v2 Stable Bundle)...');

/* ======================================================
    🛡️ PRE-FLIGHT: DEPENDENCY & BUFFER CHECK
====================================================== */
async function ensureDependencies() {
    // 1. Check for Buffer (Fixes low-level internal SDK crashes)
    if (typeof window.Buffer === 'undefined') {
        console.warn('⚠️ Buffer missing. Injecting polyfill...');
        await new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/buffer/6.0.3/buffer.min.js";
            script.onload = () => {
                window.Buffer = window.buffer.Buffer;
                console.log('✅ Buffer polyfilled');
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    // 2. Load WalletConnect via UMD (Fixes "Cannot read properties of null (reading bases)")
    if (!window.EthereumProvider) {
        if (typeof window.loadWalletConnect === 'function') {
            console.log('⏳ Awaiting WalletConnect UMD Bundle...');
            await window.loadWalletConnect();
        } else {
            throw new Error("Critical: loadWalletConnect helper not found.");
        }
    }
}

/* ======================================================
    🔒 BACKEND PAYMENT INITIALIZATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: participantId,
            vote_count: voteCount,
            network
        })
    });

    if (!res.ok) throw new Error('Failed to initialize backend payment record');
    return res.json();
}

/* ======================================================
    🌐 NETWORK SELECTION MODAL
====================================================== */
async function showNetworkSelectionModal() {
    const saved = localStorage.getItem('preferred_network');
    if (saved) return saved;

    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white w-full sm:max-w-md rounded-2xl p-6 shadow-2xl animate-slide-up">
                <h3 class="text-xl font-bold text-center text-gray-800 mb-6">Select Payment Network</h3>
                <button id="bscBtn" class="w-full bg-yellow-400 hover:bg-yellow-500 text-black py-4 rounded-xl mb-3 font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
                    <span>🟡</span> Binance Smart Chain (USDT)
                </button>
                <button id="tronBtn" class="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl mb-6 font-bold flex items-center justify-center gap-2 transition-all active:scale-95">
                    <span>🔴</span> TRON Network (USDT)
                </button>
                <button id="cancelBtn" class="w-full text-gray-400 hover:text-gray-600 py-2">Cancel</button>
            </div>`;

        document.body.appendChild(modal);

        modal.querySelector('#bscBtn').onclick = () => { modal.remove(); localStorage.setItem('preferred_network', 'bsc'); resolve('bsc'); };
        modal.querySelector('#tronBtn').onclick = () => { modal.remove(); localStorage.setItem('preferred_network', 'tron'); resolve('tron'); };
        modal.querySelector('#cancelBtn').onclick = () => { modal.remove(); resolve('bsc'); };
    });
}

/* ======================================================
    🆕 MAIN ENTRY POINT (Called by vote.js)
====================================================== */
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        return { success: false, error: 'Missing participant or vote count' };
    }

    try {
        const network = await showNetworkSelectionModal();
        const paymentInit = await initializeCryptoPayment(participantId, voteCount, network);

        if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
        if (network === 'tron') return await processUSDTPaymentTron(paymentInit);

        return { success: false, error: 'Unsupported network selected' };
    } catch (err) {
        console.error('Master Flow Error:', err);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 BSC LOGIC (USDT BEP-20)
====================================================== */
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    
    // If user is inside MetaMask/TrustWallet browser, use injected provider
    if (window.ethereum && isMobile) {
        return processBSCWithInjectedWallet(paymentInit);
    }
    // Otherwise, use WalletConnect v2
    return processBSCWithWalletConnect(paymentInit);
}

async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    try {
        await ensureDependencies();
        updateModalStatus(modal, '📱 Connecting to WalletConnect...', 'loading');

        const wcProvider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56], // BSC Mainnet
            showQrModal: true,
            methods: ["eth_sendTransaction", "personal_sign"],
            events: ["chainChanged", "accountsChanged"]
        });

        await wcProvider.connect();
        const ethersProvider = new ethers.providers.Web3Provider(wcProvider);
        const signer = ethersProvider.getSigner();

        updateModalStatus(modal, '⏳ Confirming Transaction in Wallet...', 'waiting');

        const usdtContract = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955', // Official USDT on BSC
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(
            paymentInit.recipient_address,
            ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        updateModalStatus(modal, '⛓️ Broadcasting to Blockchain...', 'pending');
        const receipt = await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Confirmed!', 'success');
        setTimeout(() => modal.remove(), 2500);

        return { success: true, txHash: receipt.transactionHash, network: 'bsc' };

    } catch (err) {
        console.error('WC v2 BSC error:', err);
        const msg = err.message.includes('rejected') ? 'User cancelled' : (err.message || 'Payment failed');
        updateModalStatus(modal, `❌ ${msg}`, 'error');
        setTimeout(() => modal.remove(), 4000);
        return { success: false, error: msg };
    }
}

async function processBSCWithInjectedWallet(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);

        const { chainId } = await provider.getNetwork();
        if (chainId !== 56) {
            updateModalStatus(modal, 'Please switch to BSC Network', 'loading');
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }]
            });
        }

        const signer = provider.getSigner();
        const usdt = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdt.transfer(
            paymentInit.recipient_address,
            ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        updateModalStatus(modal, 'Verifying...', 'pending');
        await tx.wait(1);
        modal.remove();
        return { success: true, txHash: tx.hash, network: 'bsc' };
    } catch (err) {
        updateModalStatus(modal, `❌ ${err.message}`, 'error');
        setTimeout(() => modal.remove(), 3000);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 TRON LOGIC (USDT TRC-20)
====================================================== */
async function processUSDTPaymentTron(paymentInit) {
    const modal = showEnhancedPaymentModal('TRON', paymentInit.amount);
    try {
        if (!window.tronWeb || !window.tronWeb.ready) {
            throw new Error("TronLink not found. Use a Tron-supported browser.");
        }

        updateModalStatus(modal, '⏳ Confirming on TronLink...', 'waiting');
        const usdt = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; 
        const amount = Math.floor(paymentInit.amount * 1e6); // 6 Decimals for TRC20
        
        const contract = await window.tronWeb.contract().at(usdt);
        const txHash = await contract.transfer(paymentInit.recipient_address, amount).send();
        
        updateModalStatus(modal, '✅ Tron Success!', 'success');
        setTimeout(() => modal.remove(), 2500);
        return { success: true, txHash: txHash, network: 'tron' };
    } catch (err) {
        updateModalStatus(modal, `❌ ${err.message || err}`, 'error');
        setTimeout(() => modal.remove(), 4000);
        return { success: false, error: err };
    }
}

/* ======================================================
    🔹 UI HELPERS
====================================================== */
function showEnhancedPaymentModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-6';
    m.innerHTML = `
        <div class="bg-white p-8 rounded-2xl text-center max-w-sm w-full shadow-2xl border-t-4 ${network === 'BSC' ? 'border-yellow-400' : 'border-red-600'}">
            <h3 class="text-xl font-bold text-gray-800 mb-2">${network} USDT Payment</h3>
            <p class="text-blue-600 text-2xl font-mono font-bold mb-6">${amount} <span class="text-sm">USDT</span></p>
            <div id="modalStatus" class="text-gray-500 text-sm font-medium">Connecting...</div>
            <div class="loading-spinner mx-auto mt-6"></div>
        </div>`;
    document.body.appendChild(m);
    return m;
}

function updateModalStatus(modal, text, status) {
    if (!modal) return;
    const statusEl = modal.querySelector('#modalStatus');
    statusEl.textContent = text;
    if (status === 'error') statusEl.className = 'text-red-500 text-sm font-bold';
    if (status === 'success') statusEl.className = 'text-green-600 text-sm font-bold';
    
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) spinner.style.display = (status === 'success' || status === 'error') ? 'none' : 'block';
}

/* ======================================================
    🔹 FULL GLOBAL EXPORTS
====================================================== */
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;
window.processUSDTPaymentBSC = processUSDTPaymentBSC;
window.processUSDTPaymentTron = processUSDTPaymentTron;
window.processBSCWithWalletConnect = processBSCWithWalletConnect;
window.processBSCWithInjectedWallet = processBSCWithInjectedWallet;
window.showNetworkSelectionModal = showNetworkSelectionModal;
window.showEnhancedPaymentModal = showEnhancedPaymentModal;
window.updateModalStatus = updateModalStatus;

console.log('✅ Crypto Payments Module Fully Loaded & Exported.');