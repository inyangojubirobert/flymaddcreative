// ========================================
// 🔒 SECURE CRYPTO PAYMENT INITIALIZATION
// ========================================
async function initializeCryptoPayment(participantId, voteCount, network) {
    try {
        const response = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                network: network
            })
        });

        if (!response.ok) throw new Error('Failed to initialize payment');
        return await response.json(); // { payment_id, recipient_address, amount, network }
    } catch (error) {
        console.error('Payment initialization error:', error);
        throw error;
    }
}

// ========================================
// 🆕 PROCESS CRYPTO PAYMENT
// ========================================
async function processCryptoPayment() {
    // Placeholder: get participant and vote info from your page
    const participantId = window.currentParticipant?.id || prompt('Enter participant ID');
    const selectedVoteAmount = window.selectedVoteAmount || prompt('Enter vote count');

    if (!participantId || !selectedVoteAmount) {
        alert('Missing participant ID or vote count');
        return { success: false, error: 'Missing info' };
    }

    // Step 1: Show network selection
    const network = await showNetworkSelectionModal();
    if (!network) return { success: false, error: 'User cancelled network selection' };

    // Step 2: Initialize payment backend
    let paymentInit;
    try {
        paymentInit = await initializeCryptoPayment(participantId, selectedVoteAmount, network);
    } catch (error) {
        alert('Failed to initialize payment');
        return { success: false, error: 'Backend init failed' };
    }

    // Step 3: Process network-specific payment
    if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
    if (network === 'tron') return await processUSDTPaymentTron(paymentInit);

    return { success: false, error: 'Unsupported network' };
}

// ========================================
// 🔒 BSC USDT PAYMENT (WalletConnect + MetaMask)
// ========================================
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

    if (isMobile && window.ethereum) {
        return await processBSCWithMobileWallet(paymentInit);
    } else {
        return await processBSCWithQRCode(paymentInit);
    }
}

// BSC QR (desktop fallback)
async function processBSCWithQRCode(paymentInit) {
    try {
        const modal = showEnhancedPaymentModal('bsc', paymentInit.amount);

        if (typeof EthereumProvider === 'undefined') {
            throw new Error('WalletConnect library not loaded');
        }

        const provider = await EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56],
            showQrModal: true,
            methods: ['eth_sendTransaction', 'eth_accounts', 'eth_requestAccounts', 'personal_sign'],
            events: ['chainChanged', 'accountsChanged'],
            metadata: {
                name: 'One Dream Initiative',
                description: 'USDT Payment for Voting',
                url: window.location.origin,
                icons: [`${window.location.origin}/logo.png`]
            }
        });

        updateModalStatus(modal, 'Scan QR Code with Your Wallet App', 'connected');

        await provider.connect();
        const accounts = await provider.request({ method: 'eth_accounts' });
        const walletAddress = accounts[0];
        updateModalStatus(modal, `✅ Wallet Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, 'connected');

        const chainId = await provider.request({ method: 'eth_chainId' });
        if (parseInt(chainId, 16) !== 56) {
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
        }

        updateModalStatus(modal, 'Preparing USDT Transfer...', 'loading');
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();

        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const recipientAddress = paymentInit.recipient_address;
        const amountInWei = ethers.parseUnits(paymentInit.amount.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(recipientAddress, amountInWei);
        updateModalStatus(modal, '⏳ Transaction Sent! Waiting for confirmation...', 'pending');
        await tx.wait(1);
        updateModalStatus(modal, '✅ Payment Confirmed!', 'success');
        setTimeout(() => modal.remove(), 2000);

        await provider.disconnect();

        return {
            success: true,
            payment_intent_id: tx.hash,
            txHash: tx.hash,
            network: 'bsc',
            explorer: `https://bscscan.com/tx/${tx.hash}`
        };

    } catch (error) {
        console.error('BSC QR payment error:', error);
        return { success: false, error: error.message || 'BSC payment failed' };
    }
}

// BSC mobile wallet (MetaMask / injected)
async function processBSCWithMobileWallet(paymentInit) {
    if (!window.ethereum) return { success: false, error: 'No wallet detected' };
    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        const walletAddress = accounts[0];

        const network = await provider.getNetwork();
        if (network.chainId !== 56) {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
        }

        const signer = await provider.getSigner();
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const amountInWei = ethers.parseUnits(paymentInit.amount.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(paymentInit.recipient_address, amountInWei);
        await tx.wait(1);

        return { success: true, payment_intent_id: tx.hash, txHash: tx.hash, network: 'bsc', explorer: `https://bscscan.com/tx/${tx.hash}` };

    } catch (error) {
        return { success: false, error: error.message || 'BSC payment failed' };
    }
}

// ========================================
// 🔒 TRON USDT PAYMENT
// ========================================
async function processUSDTPaymentTron(paymentInit) {
    if (window.tronWeb && window.tronWeb.ready) {
        return await processTronWithTronLink(paymentInit);
    } else {
        return await processTronWithQRCode(paymentInit);
    }
}

// TRON QR + deep link
async function processTronWithQRCode(paymentInit) {
    try {
        const recipientAddress = paymentInit.recipient_address;
        const amountUSD = paymentInit.amount;

        const tronDeepLink = `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${amountUSD*1000000}&receiver=${recipientAddress}`;

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-6 max-w-md w-full">
                <h3 class="text-xl font-bold mb-2">🔴 TRON USDT Payment</h3>
                <p class="mb-4">Amount: ${amountUSD} USDT (TRC-20)</p>
                <button onclick="window.open('${tronDeepLink}','_blank')" class="w-full bg-red-600 py-3 rounded-lg text-white font-bold mb-2">Open in TronLink/Wallet</button>
                <button onclick="this.closest('.fixed').remove()" class="w-full bg-gray-600 py-2 rounded-lg text-white font-semibold">Cancel</button>
                <p class="mt-2 text-xs text-white/70">Scan QR or use mobile wallet</p>
            </div>
        `;
        document.body.appendChild(modal);

        // Optional: generate QR
        setTimeout(() => generateEnhancedQRCode(recipientAddress, 'tronQRCode', 'tron', amountUSD), 100);

        return new Promise(resolve => {
            window.confirmTronPayment = async function(txHash) {
                modal.remove();
                if (txHash?.length === 64) {
                    resolve({ success: true, payment_intent_id: txHash, txHash, network: 'tron', explorer: `https://tronscan.org/#/transaction/${txHash}` });
                } else {
                    // Backend verification
                    resolve({ success: true, payment_intent_id: `manual_${Date.now()}`, txHash: null, network: 'tron', manual: true });
                }
            };
        });

    } catch (error) {
        console.error('TRON QR error:', error);
        return { success: false, error: error.message || 'TRON payment failed' };
    }
}

// TRON injected wallet (TronLink)
async function processTronWithTronLink(paymentInit) {
    try {
        const tronWeb = window.tronWeb;
        const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const amount = Math.floor(paymentInit.amount * 1000000);

        const contract = await tronWeb.contract().at(usdtContract);
        const txResult = await contract.transfer(paymentInit.recipient_address, amount).send();

        return { success: true, payment_intent_id: txResult, txHash: txResult, network: 'tron', explorer: `https://tronscan.org/#/transaction/${txResult}` };

    } catch (error) {
        return { success: false, error: error.message || 'TronLink payment failed' };
    }
}

// ========================================
// 🔹 UI / MODALS / QR HELPERS
// ========================================

function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            <h3 class="text-2xl font-bold mb-2">${network.toUpperCase()} Payment</h3>
            <p class="mb-4">Amount: ${amount} USDT</p>
            <div id="modalStatus">Connecting...</div>
            <div class="loading-spinner mx-auto mt-2"></div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function updateModalStatus(modal, message, status) {
    if (!modal) return;
    const statusDiv = modal.querySelector('#modalStatus');
    if (statusDiv) statusDiv.innerText = message;
}

// Network selection modal
async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-8 max-w-lg w-full">
                <h3 class="text-2xl font-bold mb-2">Select USDT Network</h3>
                <button onclick="selectCryptoNetwork('bsc')" class="w-full mb-2 bg-yellow-500 py-3 rounded-lg">BSC (BEP-20)</button>
                <button onclick="selectCryptoNetwork('tron')" class="w-full mb-2 bg-red-500 py-3 rounded-lg">TRON (TRC-20)</button>
                <button onclick="selectCryptoNetwork(null)" class="w-full py-2 bg-gray-600 rounded-lg">Cancel</button>
            </div>
        `;
        document.body.appendChild(modal);

        window.selectCryptoNetwork = function(network) {
            modal.remove();
            delete window.selectCryptoNetwork;
            resolve(network);
        };
    });
}

// QR code generator
function generateEnhancedQRCode(address, elementId, network='tron', amount=0) {
    const element = document.getElementById(elementId);
    if (!element) return;
    let qrData = address;
    if (network === 'tron') qrData = `tron:${address}?amount=${amount}&token=USDT`;
    if (network === 'bsc') qrData = `ethereum:${address}@56?value=${amount}`;
    const qrUrl = `https://chart.googleapis.com/chart?chs=192x192&cht=qr&chl=${encodeURIComponent(qrData)}&choe=UTF-8`;
    element.innerHTML = `<img src="${qrUrl}" class="mx-auto rounded-lg shadow-lg"/>`;
}

// Copy to clipboard helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
}
