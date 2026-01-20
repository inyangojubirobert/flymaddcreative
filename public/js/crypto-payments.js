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
// 🆕 PROCESS CRYPTO PAYMENT (ENTRY)
// ========================================
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const selectedVoteAmount = window.selectedVoteAmount;

    if (!participantId || !selectedVoteAmount) {
        alert('Missing participant or vote count');
        return;
    }

    const network = await showNetworkSelectionModal();
    if (!network) return;

    const paymentInit = await initializeCryptoPayment(
        participantId,
        selectedVoteAmount,
        network
    );

    if (network === 'bsc') return processUSDTPaymentBSC(paymentInit);
    if (network === 'tron') return processUSDTPaymentTron(paymentInit);

    throw new Error('Unsupported network');
}

// ========================================
// 🔒 BSC USDT PAYMENT (SAFE FLOW)
// ========================================
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    // 📱 MOBILE → Trust Wallet deep link (NO providers)
    if (isMobile) {
        return processBSCViaDeepLink(paymentInit);
    }

    // 🖥️ DESKTOP → Injected wallet only
    if (window.ethereum) {
        return processBSCInjected(paymentInit);
    }

    alert('Please install MetaMask or Binance Wallet');
    throw new Error('No injected wallet found');
}

// ========================================
// 🖥️ DESKTOP INJECTED WALLET
// ========================================
async function processBSCInjected(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);

        const network = await provider.getNetwork();
        if (network.chainId !== 56) {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }]
            });
        }

        updateModalStatus(modal, 'Preparing USDT transfer...', 'loading');

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

        updateModalStatus(modal, '⏳ Waiting for confirmation...', 'pending');
        await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Confirmed!', 'success');
        setTimeout(() => modal.remove(), 2000);

        return successResult(tx.hash, 'bsc');

    } catch (err) {
        updateModalStatus(modal, `❌ ${err.message}`, 'error');
        setTimeout(() => modal.remove(), 3000);
        throw err;
    }
}

// ========================================
// 📱 MOBILE TRUST WALLET (DEEP LINK)
// ========================================
function processBSCViaDeepLink(paymentInit) {
    const to = paymentInit.recipient_address;
    const amount = paymentInit.amount;

    const trustLink =
        `https://link.trustwallet.com/send?coin=20000714&address=${to}&amount=${amount}`;

    window.open(trustLink, '_blank');

    return manualConfirmation('bsc');
}

// ========================================
// 🔒 TRON USDT PAYMENT
// ========================================
async function processUSDTPaymentTron(paymentInit) {
    if (window.tronWeb && window.tronWeb.ready) {
        return processTronWithTronLink(paymentInit);
    }
    return processTronWithQRCode(paymentInit);
}

async function processTronWithTronLink(paymentInit) {
    const tronWeb = window.tronWeb;
    const contract = await tronWeb.contract()
        .at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');

    const amount = Math.floor(paymentInit.amount * 1e6);
    const tx = await contract
        .transfer(paymentInit.recipient_address, amount)
        .send();

    return successResult(tx, 'tron');
}

// ========================================
// 🔴 TRON QR + DEEP LINK
// ========================================
function processTronWithQRCode(paymentInit) {
    const amount = paymentInit.amount * 1e6;
    const to = paymentInit.recipient_address;

    const link =
        `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${amount}&receiver=${to}`;

    window.open(link, '_blank');
    return manualConfirmation('tron');
}

// ========================================
// 🔁 MANUAL CONFIRMATION
// ========================================
function manualConfirmation(network) {
    return new Promise(resolve => {
        const txHash = prompt('Paste transaction hash after payment');
        resolve(successResult(txHash || null, network, true));
    });
}

// ========================================
// 🔹 HELPERS
// ========================================
function successResult(txHash, network, manual = false) {
    return {
        success: true,
        txHash,
        manual,
        network,
        explorer:
            network === 'bsc'
                ? `https://bscscan.com/tx/${txHash}`
                : `https://tronscan.org/#/transaction/${txHash}`
    };
}

// ========================================
// 🔹 UI HELPERS (UNCHANGED)
// ========================================
function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className =
        'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="glassmorphism rounded-2xl p-6 text-center">
        <h3 class="text-xl font-bold">${network} Payment</h3>
        <p class="mb-2">${amount} USDT</p>
        <div id="modalStatus">Connecting...</div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
}

function updateModalStatus(modal, msg) {
    modal.querySelector('#modalStatus').textContent = msg;
}

// ========================================
// EXPORTS
// ========================================
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;

console.log('✅ Crypto Payments Module Loaded');
