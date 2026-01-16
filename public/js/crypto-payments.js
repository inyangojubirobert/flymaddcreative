console.log('📦 Crypto Payments Module Loading...');

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
// 🆕 PROCESS CRYPTO PAYMENT (Main Entry Point)
// ========================================
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const selectedVoteAmount = window.selectedVoteAmount;

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
    const hasMetaMask = typeof window.ethereum !== 'undefined';

    if (isMobile && hasMetaMask) {
        return await processBSCWithMobileWallet(paymentInit);
    } else {
        return await processBSCWithWalletConnect(paymentInit);
    }
}

// BSC WalletConnect (QR Code for desktop + mobile wallets)
async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    
    try {
        // ✅ Load WalletConnect if not already loaded (lazy loading)
        if (typeof window.loadWalletConnect === 'function') {
            updateModalStatus(modal, 'Loading WalletConnect library...', 'loading');
            try {
                await window.loadWalletConnect();
            } catch (error) {
                console.error('WalletConnect loader failed (original):', error);
                modal?.remove();
                throw new Error('Failed to load WalletConnect. Please refresh and try again.');
            }
        }

        // ✅ Check if EthereumProvider is available
        if (!window.EthereumProvider) {
            modal?.remove();
            throw new Error('WalletConnect library not loaded. Please refresh the page.');
        }

        updateModalStatus(modal, 'Initializing WalletConnect...', 'loading');

        // Initialize WalletConnect Provider
        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5',
            chains: [56], // BSC Mainnet
            showQrModal: true,
            methods: ['eth_sendTransaction', 'eth_accounts', 'eth_requestAccounts', 'personal_sign'],
            events: ['chainChanged', 'accountsChanged'],
            metadata: {
                name: 'One Dream Initiative',
                description: 'USDT Payment for Voting',
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.png`]
            },
            qrModalOptions: {
                themeMode: 'dark',
                themeVariables: {
                    '--wcm-z-index': '99999',
                    '--wcm-accent-color': '#3b82f6'
                }
            }
        });

        updateModalStatus(modal, '📱 Scan QR Code with Your Wallet App', 'waiting');

        // Connect wallet (this will show the QR code modal)
        await provider.connect();

        const accounts = await provider.request({ method: 'eth_accounts' });
        const walletAddress = accounts[0];

        updateModalStatus(modal, `✅ Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, 'connected');

        // Check if on correct network (BSC)
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (parseInt(chainId, 16) !== 56) {
            updateModalStatus(modal, 'Switching to BSC network...', 'loading');
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }] // BSC Mainnet
                });
            } catch (switchError) {
                // If network doesn't exist in wallet, add it
                if (switchError.code === 4902) {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x38',
                            chainName: 'BNB Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: ['https://bsc-dataseed.binance.org/'],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw switchError;
                }
            }
        }

        updateModalStatus(modal, 'Preparing USDT transfer...', 'loading');

        // Create ethers provider (use ethers v5 from CDN)
        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        // BSC USDT Contract Address
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const recipientAddress = paymentInit.recipient_address;
        const amountInWei = ethers.utils.parseUnits(paymentInit.amount.toString(), 18);

        // Create USDT contract instance
        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        updateModalStatus(modal, `💸 Sending ${paymentInit.amount} USDT...`, 'loading');

        // Execute transfer
        const tx = await usdtContract.transfer(recipientAddress, amountInWei);

        updateModalStatus(modal, '⏳ Waiting for confirmation...', 'pending');

        // Wait for transaction confirmation
        const receipt = await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Confirmed!', 'success');

        setTimeout(() => modal?.remove(), 2000);

        // Disconnect WalletConnect
        await provider.disconnect();

        return {
            success: true,
            payment_intent_id: tx.hash,
            txHash: tx.hash,
            network: 'bsc',
            explorer: `https://bscscan.com/tx/${tx.hash}`,
            receipt: receipt
        };

    } catch (error) {
        console.error('BSC WalletConnect payment error:', error);
        updateModalStatus(modal, `❌ Error: ${error.message}`, 'error');
        setTimeout(() => modal?.remove(), 3000);
        return {
            success: false,
            error: error.message || 'BSC payment failed'
        };
    }
}

// BSC mobile wallet (MetaMask / injected)
async function processBSCWithMobileWallet(paymentInit) {
    if (!window.ethereum) return { success: false, error: 'No wallet detected' };
    
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        const walletAddress = accounts[0];

        const network = await provider.getNetwork();
        if (Number(network.chainId) !== 56) {
            await window.ethereum.request({ 
                method: 'wallet_switchEthereumChain', 
                params: [{ chainId: '0x38' }] 
            });
        }

        const signer = provider.getSigner();
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const amountInWei = ethers.utils.parseUnits(paymentInit.amount.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(paymentInit.recipient_address, amountInWei);
        await tx.wait(1);

        return { 
            success: true, 
            payment_intent_id: tx.hash, 
            txHash: tx.hash, 
            network: 'bsc', 
            explorer: `https://bscscan.com/tx/${tx.hash}` 
        };

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
                <div id="tronQRCode" class="mb-4"></div>
                <button onclick="window.open('${tronDeepLink}','_blank')" class="w-full bg-red-600 py-3 rounded-lg text-white font-bold mb-2">Open in TronLink/Wallet</button>
                <button onclick="this.closest('.fixed').remove()" class="w-full bg-gray-600 py-2 rounded-lg text-white font-semibold">Cancel</button>
                <p class="mt-2 text-xs text-white/70">Scan QR or click to open wallet</p>
            </div>
        `;
        document.body.appendChild(modal);

        // Generate QR code
        setTimeout(() => generateEnhancedQRCode(recipientAddress, 'tronQRCode', 'tron', amountUSD), 100);

        return new Promise(resolve => {
            window.confirmTronPayment = async function(txHash) {
                modal.remove();
                if (txHash?.length === 64) {
                    resolve({ 
                        success: true, 
                        payment_intent_id: txHash, 
                        txHash, 
                        network: 'tron', 
                        explorer: `https://tronscan.org/#/transaction/${txHash}` 
                    });
                } else {
                    resolve({ 
                        success: true, 
                        payment_intent_id: `manual_${Date.now()}`, 
                        txHash: null, 
                        network: 'tron', 
                        manual: true 
                    });
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

        return { 
            success: true, 
            payment_intent_id: txResult, 
            txHash: txResult, 
            network: 'tron', 
            explorer: `https://tronscan.org/#/transaction/${txResult}` 
        };

    } catch (error) {
        return { success: false, error: error.message || 'TronLink payment failed' };
    }
}

// ========================================
// 🔹 UI / MODALS / QR HELPERS
// ========================================

function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            <h3 class="text-2xl font-bold mb-2">${network} Payment</h3>
            <p class="mb-4 text-lg">Amount: <span class="font-bold">${amount} USDT</span></p>
            <div id="modalStatus" class="mb-4 text-white/80">Connecting...</div>
            <div class="loading-spinner mx-auto mt-2"></div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function updateModalStatus(modal, message, status) {
    if (!modal) return;
    const statusDiv = modal.querySelector('#modalStatus');
    const spinner = modal.querySelector('.loading-spinner');
    
    if (statusDiv) statusDiv.innerHTML = message;
    
    if (spinner) {
        if (status === 'success' || status === 'error') {
            spinner.style.display = 'none';
        } else {
            spinner.style.display = 'block';
        }
    }
}

// Network selection modal
async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-8 max-w-lg w-full">
                <h3 class="text-2xl font-bold mb-4 text-center">Select USDT Network</h3>
                <p class="text-white/70 mb-6 text-center">Choose your preferred blockchain network</p>
                <button onclick="selectCryptoNetwork('bsc')" class="w-full mb-3 bg-yellow-500 hover:bg-yellow-600 py-4 rounded-lg font-bold text-lg transition-colors">
                    🟡 BSC (BEP-20)
                </button>
                <button onclick="selectCryptoNetwork('tron')" class="w-full mb-3 bg-red-500 hover:bg-red-600 py-4 rounded-lg font-bold text-lg transition-colors">
                    🔴 TRON (TRC-20)
                </button>
                <button onclick="selectCryptoNetwork(null)" class="w-full py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors">
                    Cancel
                </button>
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
    
    const qrUrl = `https://chart.googleapis.com/chart?chs=256x256&cht=qr&chl=${encodeURIComponent(qrData)}&choe=UTF-8`;
    element.innerHTML = `<img src="${qrUrl}" class="mx-auto rounded-lg shadow-lg border-2 border-white/20"/>`;
}

// Copy to clipboard helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard! 📋');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Copied to clipboard! 📋');
    });
}

// Export to window for access from vote.js
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;

console.log('✅ Crypto Payments Module Loaded');
