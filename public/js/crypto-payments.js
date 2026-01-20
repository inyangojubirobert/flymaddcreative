console.log('📦 Crypto Payments Module Loading...');

// ========================================
// 🔒 SECURE CRYPTO PAYMENT INITIALIZATION
// ========================================
async function initializeCryptoPayment(participantId, voteCount, network) {
    const response = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: participantId,
            vote_count: voteCount,
            network
        })
    });

    if (!response.ok) throw new Error('Failed to initialize payment');
    return response.json();
}

// ========================================
// 🔐 VERIFY PAYMENT (Webhook Trigger)
// ========================================
async function verifyCryptoPayment(payload) {
    try {
        const res = await fetch('/api/onedream/verify-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        console.warn('Verification failed (will retry server-side)', e);
        return null;
    }
}

// ========================================
// 🔄 WALLETCONNECT RESET (ANTI-ACK BUG)
// ========================================
function resetWalletConnect() {
    if (window.__walletConnectProvider) {
        try { window.__walletConnectProvider.disconnect(); } catch {}
        window.__walletConnectProvider = null;
    }
}

// ========================================
// 🆕 PROCESS CRYPTO PAYMENT
// ========================================
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Missing participant or vote count');
        return;
    }

    const network = await showNetworkSelectionModal();
    if (!network) return;

    const paymentInit = await initializeCryptoPayment(
        participantId,
        voteCount,
        network
    );

    if (network === 'bsc') return processUSDTPaymentBSC(paymentInit);
    if (network === 'tron') return processUSDTPaymentTron(paymentInit);
}

// ========================================
// 🔒 BSC USDT PAYMENT
// ========================================
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isMobile) return processBSCWithWalletConnect(paymentInit);
    if (window.ethereum) return processBSCWithInjectedWallet(paymentInit);
    return processBSCWithWalletConnect(paymentInit);
}

// ========================================
// 🔒 BSC WalletConnect
// ========================================
async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);

    try {
        if (typeof window.loadWalletConnect === 'function') {
            await window.loadWalletConnect();
        }

        if (!window.__walletConnectProvider) {
            window.__walletConnectProvider = await window.EthereumProvider.init({
                projectId: window.WALLETCONNECT_PROJECT_ID,
                chains: [56],
                showQrModal: true,
                methods: ['eth_sendTransaction', 'eth_accounts', 'personal_sign'],
                metadata: {
                    name: 'One Dream Initiative',
                    description: 'USDT Voting Payment',
                    url: location.origin,
                    icons: [`${location.origin}/favicon.png`]
                }
            });
        }

        const provider = window.__walletConnectProvider;

        if (!provider.connected) {
            updateModalStatus(modal, '📱 Scan QR Code...', 'waiting');
            await provider.connect();
        }

        const [wallet] = provider.accounts;
        if (!wallet) throw new Error('No wallet connected');

        updateModalStatus(modal, `Connected: ${wallet.slice(0,6)}...`, 'connected');

        const chainId = Number(await provider.request({ method: 'eth_chainId' }));
        if (chainId !== 56) {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }]
            });
        }

        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        const usdt = new ethers.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        const tx = await usdt.transfer(
            paymentInit.recipient_address,
            ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        updateModalStatus(modal, '⏳ Confirming transaction...', 'pending');
        const receipt = await tx.wait(1);

        updateModalStatus(modal, '✅ Payment confirmed!', 'success');

        verifyCryptoPayment({
            tx_hash: tx.hash,
            network: 'bsc',
            payment_id: paymentInit.payment_id
        });

        setTimeout(() => modal.remove(), 2000);

        return { success: true, txHash: tx.hash };

    } catch (e) {
        resetWalletConnect();
        modal.innerHTML += `
            <button onclick="location.reload()"
                class="mt-4 bg-blue-600 px-4 py-2 rounded">
                Retry Connection
            </button>`;
        updateModalStatus(modal, `❌ ${e.message}`, 'error');
        return { success: false };
    }
}

// ========================================
// 🔒 BSC Injected Wallet
// ========================================
async function processBSCWithInjectedWallet(paymentInit) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const [wallet] = await provider.send('eth_requestAccounts', []);

    const network = await provider.getNetwork();
    if (network.chainId !== 56) {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }]
        });
    }

    const signer = provider.getSigner();
    const usdt = new ethers.Contract(
        '0x55d398326f99059fF775485246999027B3197955',
        ['function transfer(address,uint256) returns (bool)'],
        signer
    );

    const tx = await usdt.transfer(
        paymentInit.recipient_address,
        ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
    );

    await tx.wait(1);

    verifyCryptoPayment({
        tx_hash: tx.hash,
        network: 'bsc',
        payment_id: paymentInit.payment_id
    });

    return { success: true, txHash: tx.hash };
}

// ========================================
// 🔴 TRON USDT PAYMENT
// ========================================
async function processUSDTPaymentTron(paymentInit) {
    if (window.tronWeb?.ready) {
        return processTronWithTronLink(paymentInit);
    }
    return processTronWithQRCode(paymentInit);
}

// ========================================
// 🔴 TRON QR + UX IMPROVEMENTS
// ========================================
async function processTronWithQRCode(paymentInit) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 p-6 rounded-xl w-full max-w-md text-center">
            <h3 class="text-xl font-bold mb-2">TRON USDT Payment</h3>
            <div id="tronQR"></div>
            <input id="manualTx"
                placeholder="Paste Tx Hash (optional)"
                class="w-full mt-3 p-2 rounded bg-gray-800 text-white"/>
            <button id="confirmTron"
                class="w-full mt-3 bg-red-600 py-2 rounded">
                Confirm Payment
            </button>
        </div>
    `;
    document.body.appendChild(modal);

    generateEnhancedQRCode(
        paymentInit.recipient_address,
        'tronQR',
        'tron',
        paymentInit.amount
    );

    return new Promise(resolve => {
        document.getElementById('confirmTron').onclick = async () => {
            const txHash = document.getElementById('manualTx').value || null;
            modal.remove();

            verifyCryptoPayment({
                tx_hash: txHash,
                network: 'tron',
                payment_id: paymentInit.payment_id
            });

            resolve({ success: true, txHash });
        };
    });
}

// ========================================
// 🔹 UI HELPERS (UNCHANGED)
// ========================================

function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-900 p-6 rounded-xl text-center">
            <h3 class="text-xl font-bold">${network} Payment</h3>
            <p>${amount} USDT</p>
            <div id="modalStatus">Connecting...</div>
            <div class="loading-spinner"></div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

function updateModalStatus(modal, msg) {
    modal.querySelector('#modalStatus').innerHTML = msg;
}

function generateEnhancedQRCode(address, el, net, amt) {
    const qr = `https://chart.googleapis.com/chart?chs=256x256&cht=qr&chl=${encodeURIComponent(address)}`;
    document.getElementById(el).innerHTML = `<img src="${qr}" />`;
}

async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const m = document.createElement('div');
        m.innerHTML = `
            <button onclick="sel('bsc')">BSC</button>
            <button onclick="sel('tron')">TRON</button>`;
        document.body.appendChild(m);
        window.sel = n => { m.remove(); resolve(n); };
    });
}

// EXPORT
window.processCryptoPayment = processCryptoPayment;

console.log('✅ Crypto Payments Module Loaded');
