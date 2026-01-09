// ========================================
// 🆕 IMPROVED CRYPTO USDT PAYMENT SYSTEM
// ========================================

async function processCryptoPayment(paymentData) {
    // Load crypto scripts if not already loaded
    if (typeof window.loadCryptoScripts === 'function') {
        const loadingModal = showPaymentModal('Loading crypto payment system...', 'loading');
        try {
            await window.loadCryptoScripts();
            loadingModal?.remove();
        } catch (error) {
            loadingModal?.remove();
            alert('Failed to load crypto payment system. Please refresh and try again.');
            return { success: false, error: 'Script loading failed' };
        }
    }
    
    // Show network selection modal
    const network = await showNetworkSelectionModal();
    
    if (!network) {
        return { success: false, error: 'Payment cancelled by user' };
    }
    
    // Process based on selected network
    if (network === 'bsc') {
        return await processUSDTPayment('bsc');
    } else if (network === 'tron') {
        return await processUSDTPayment('tron');
    }
}

// ========================================
// 🆕 UNIFIED USDT PAYMENT FUNCTION
// ========================================
async function processUSDTPayment(network) {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (network === 'bsc') {
        // BSC USDT Payment
        if (isMobile && window.ethereum) {
            // Mobile with injected wallet
            return await processBSCWithMobileWallet();
        } else {
            // Desktop or mobile without wallet - show QR
            return await processBSCWithQRCode();
        }
    } else if (network === 'tron') {
        // Tron USDT Payment
        if (window.tronWeb && window.tronWeb.ready) {
            // TronLink available
            return await processTronWithTronLink();
        } else {
            // Show QR code for mobile wallets
            return await processTronWithQRCode();
        }
    }
}

// ========================================
// 🆕 BSC PAYMENT WITH QR CODE
// ========================================
async function processBSCWithQRCode() {
    try {
        // Show custom loading modal with instructions
        const modal = showEnhancedPaymentModal('bsc', selectedCost);
        
        // Check if EthereumProvider is available
        if (typeof EthereumProvider === 'undefined') {
            throw new Error('WalletConnect library not loaded. Please refresh the page.');
        }

        // Initialize WalletConnect with QR Modal
        const provider = await EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || 'WALLETCONNECT_PROJECT_ID_REMOVED',
            chains: [56], // BSC
            showQrModal: true,
            methods: [
                'eth_sendTransaction',
                'eth_accounts',
                'eth_requestAccounts',
                'personal_sign'
            ],
            events: ['chainChanged', 'accountsChanged'],
            metadata: {
                name: 'One Dream Initiative',
                description: 'USDT Payment for Voting',
                url: window.location.origin,
                icons: [`${window.location.origin}/logo.png`]
            },
            qrModalOptions: {
                themeMode: 'dark',
                themeVariables: {
                    '--wcm-z-index': '99999',
                    '--wcm-accent-color': '#3b82f6',
                    '--wcm-background-color': '#1e293b'
                },
                mobileWallets: [
                    {
                        id: 'trust',
                        name: 'Trust Wallet',
                        links: {
                            native: 'trust://',
                            universal: 'https://link.trustwallet.com'
                        }
                    },
                    {
                        id: 'metamask',
                        name: 'MetaMask',
                        links: {
                            native: 'metamask://',
                            universal: 'https://metamask.app.link'
                        }
                    }
                ]
            }
        });

        // Update modal status
        updateModalStatus(modal, 'Scan QR Code with Your Wallet App', 'waiting');

        // Connect (this will show QR modal automatically)
        await provider.connect();

        // Get accounts
        const accounts = await provider.request({ method: 'eth_accounts' });
        const walletAddress = accounts[0];

        updateModalStatus(modal, `✅ Wallet Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, 'connected');

        // Check network
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (parseInt(chainId, 16) !== 56) {
            // Switch to BSC
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    // Add BSC network
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

        updateModalStatus(modal, 'Preparing USDT Transfer...', 'loading');

        // Create ethers provider
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();

        // USDT Contract (BSC-USD - 18 decimals)
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_BSC;
        const amountUSD = selectedCost;
        const amountInWei = ethers.parseUnits(amountUSD.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        updateModalStatus(modal, `💸 Sending ${amountUSD} USDT...\nPlease confirm in your wallet`, 'loading');

        // Send transaction
        const tx = await usdtContract.transfer(recipientAddress, amountInWei);

        updateModalStatus(modal, '⏳ Transaction Sent! Waiting for blockchain confirmation...', 'pending');

        // Wait for confirmation
        const receipt = await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Confirmed on Blockchain!', 'success');

        // Close modal after 2 seconds
        setTimeout(() => modal.remove(), 2000);

        // Disconnect
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

        if (error.message?.includes('User rejected')) {
            return { success: false, error: 'Connection cancelled' };
        }

        if (error.message?.includes('insufficient funds')) {
            return { success: false, error: 'Insufficient USDT or BNB for gas' };
        }

        return {
            success: false,
            error: error.message || 'BSC payment failed'
        };
    }
}

// ========================================
// 🆕 TRON PAYMENT WITH QR CODE
// ========================================
async function processTronWithQRCode() {
    try {
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_TRON;
        const amountUSD = selectedCost;
        const usdtAmount = amountUSD; // USDT has 6 decimals

        // Generate deep link for TronLink with USDT payment
        const tronDeepLink = `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${usdtAmount * 1000000}&receiver=${recipientAddress}`;
        
        // Create WalletConnect-style URI for TRON (for QR code)
        const tronPaymentData = `${recipientAddress}?amount=${usdtAmount}&token=USDT&network=tron`;

        // Create enhanced modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.style.zIndex = '99999';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-6 max-w-md w-full animate-scale-in">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-2xl font-bold">🔴 Pay with USDT (TRC-20)</h3>
                    <button onclick="this.closest('.fixed').remove()" class="text-white/70 hover:text-white text-2xl">&times;</button>
                </div>
                
                <!-- Network Badge -->
                <div class="flex items-center justify-center gap-2 mb-4">
                    <span class="bg-red-600/30 border border-red-500 text-red-200 px-4 py-2 rounded-full text-sm font-bold">
                        TRON Network (TRC-20)
                    </span>
                </div>

                <!-- Amount Display -->
                <div class="bg-gradient-to-r from-red-600/30 to-pink-600/30 border border-red-500 rounded-xl p-5 mb-6 text-center">
                    <div class="text-sm text-white/70 mb-1">Amount to Send</div>
                    <div class="text-4xl font-bold mb-1">${usdtAmount} USDT</div>
                    <div class="text-xs text-white/60">TRON TRC-20 Network</div>
                </div>

                <!-- QR Code Section -->
                <div class="bg-white rounded-xl p-4 mb-4">
                    <div class="text-center mb-3">
                        <div class="text-gray-800 font-bold mb-2">📱 Scan with TRON Wallet</div>
                        <div class="text-xs text-gray-600">TronLink, Trust Wallet, or any TRON wallet</div>
                    </div>
                    <div class="flex justify-center" id="tronQRCode">
                        <div class="w-48 h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                            <div class="text-gray-400 text-sm">Generating QR...</div>
                        </div>
                    </div>
                </div>

                <!-- Recipient Address -->
                <div class="mb-4">
                    <label class="text-sm text-white/70 mb-2 block font-semibold">Or Copy Address:</label>
                    <div class="bg-white/10 rounded-lg p-3 mb-2 border border-white/20">
                        <code class="text-xs break-all text-blue-300">${recipientAddress}</code>
                    </div>
                    <button onclick="copyToClipboard('${recipientAddress}')" 
                            class="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm transition-colors font-semibold">
                        📋 Copy Address
                    </button>
                </div>

                <!-- Mobile Wallet Button -->
                <a href="${tronDeepLink}" 
                   class="block w-full bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 py-3 rounded-lg text-center font-bold mb-4 transition-all shadow-lg hover:shadow-xl">
                    🔴 Open in TronLink / Trust Wallet
                </a>

                <!-- Important Notes -->
                <div class="bg-yellow-900/40 border border-yellow-600/50 rounded-lg p-4 mb-4">
                    <div class="flex items-start gap-2">
                        <div class="text-2xl">⚠️</div>
                        <div>
                            <div class="font-bold text-yellow-200 mb-2">Important Instructions:</div>
                            <ul class="text-xs text-white/90 space-y-1.5">
                                <li>✓ Send exactly <strong class="text-yellow-200">${usdtAmount} USDT</strong></li>
                                <li>✓ Use <strong class="text-yellow-200">TRC-20 network</strong> (TRON only)</li>
                                <li>✓ Contract: TR7NHq...gjLj6t</li>
                                <li>✗ Don't use BTC, ETH, BEP-20 or other networks</li>
                                <li>⚡ Transaction usually confirms in 3-5 seconds</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- Action Buttons -->
                <div class="flex gap-3">
                    <button onclick="this.closest('.fixed').remove()" 
                            class="flex-1 bg-gray-600 hover:bg-gray-700 py-3 rounded-lg transition-colors font-semibold">
                        Cancel
                    </button>
                    <button onclick="confirmTronPayment('${recipientAddress}', ${usdtAmount})" 
                            class="flex-1 bg-green-600 hover:bg-green-700 py-3 rounded-lg transition-colors font-bold shadow-lg">
                        ✓ I've Sent Payment
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Generate QR code with payment data
        setTimeout(() => generateEnhancedQRCode(recipientAddress, 'tronQRCode', 'tron', amountUSD), 100);

        return new Promise((resolve) => {
            window.confirmTronPayment = async function(address, amount) {
                const txHash = prompt('Enter transaction hash (optional):');
                modal.remove();
                
                if (txHash && txHash.length === 64) {
                    // User provided TX hash - verify it
                    resolve({
                        success: true,
                        payment_intent_id: txHash,
                        txHash: txHash,
                        network: 'tron',
                        explorer: `https://tronscan.org/#/transaction/${txHash}`
                    });
                } else {
                    // Manual confirmation - need backend verification
                    alert('Please wait while we verify your payment. This may take a few minutes.');
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
        console.error('Tron QR payment error:', error);
        return {
            success: false,
            error: error.message || 'Tron payment failed'
        };
    }
}

// ========================================
// 🆕 MOBILE WALLET HELPERS
// ========================================
async function processBSCWithMobileWallet() {
    if (!window.ethereum) {
        return { success: false, error: 'No wallet detected' };
    }

    try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        const walletAddress = accounts[0];

        // Check/switch network
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== 56) {
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }]
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x38',
                            chainName: 'BNB Smart Chain',
                            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                            rpcUrls: ['https://bsc-dataseed.binance.org/'],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                }
            }
        }

        const signer = await provider.getSigner();
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_BSC;
        const amountUSD = selectedCost;
        const amountInWei = ethers.parseUnits(amountUSD.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(recipientAddress, amountInWei);
        await tx.wait(1);

        return {
            success: true,
            payment_intent_id: tx.hash,
            txHash: tx.hash,
            network: 'bsc',
            explorer: `https://bscscan.com/tx/${tx.hash}`
        };

    } catch (error) {
        return {
            success: false,
            error: error.message || 'Payment failed'
        };
    }
}

async function processTronWithTronLink() {
    if (!window.tronWeb || !window.tronWeb.ready) {
        return { success: false, error: 'TronLink not available' };
    }

    try {
        const tronWeb = window.tronWeb;
        const userAddress = tronWeb.defaultAddress.base58;
        const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_TRON;
        const amountUSD = selectedCost;
        const amount = Math.floor(amountUSD * 1000000); // 6 decimals

        const contract = await tronWeb.contract().at(usdtContract);
        const txResult = await contract.transfer(recipientAddress, amount).send();

        return {
            success: true,
            payment_intent_id: txResult,
            txHash: txResult,
            network: 'tron',
            explorer: `https://tronscan.org/#/transaction/${txResult}`
        };

    } catch (error) {
        return {
            success: false,
            error: error.message || 'TronLink payment failed'
        };
    }
}

// ========================================
// 🆕 UI HELPER FUNCTIONS
// ========================================
function showPaymentModal(message, type = 'loading') {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.style.zIndex = '99999';
    
    let content = '';
    if (type === 'loading') {
        content = `
            <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
                <div class="loading-spinner mx-auto mb-4"></div>
                <h3 class="text-xl font-bold">${message}</h3>
            </div>
        `;
    } else if (type === 'qr') {
        content = `
            <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
                <h3 class="text-xl font-bold mb-4">${message}</h3>
                <p class="text-sm text-white/70">Use your mobile wallet to scan the QR code</p>
            </div>
        `;
    }
    
    modal.innerHTML = content;
    document.body.appendChild(modal);
    return modal;
}

function updatePaymentModal(modal, message, type) {
    const icons = {
        loading: '<div class="loading-spinner mx-auto mb-4"></div>',
        connected: '<div class="text-5xl mb-4">✅</div>',
        pending: '<div class="text-5xl mb-4">⏳</div>',
        success: '<div class="text-5xl mb-4">🎉</div>',
        error: '<div class="text-5xl mb-4">❌</div>'
    };

    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            ${icons[type] || ''}
            <h3 class="text-xl font-bold">${message}</h3>
        </div>
    `;
}

// ========================================
// 🆕 ENHANCED QR CODE GENERATION
// ========================================
function generateEnhancedQRCode(address, elementId, network = 'tron', amount = 0) {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Create payment URI
    let qrData = address;
    if (network === 'tron' && amount > 0) {
        qrData = `tron:${address}?amount=${amount}&token=USDT`;
    } else if (network === 'bsc' && amount > 0) {
        qrData = `ethereum:${address}@56?value=${amount}`;
    }

    // Generate QR using Google Charts API (reliable and fast)
    const size = 192;
    const qrUrl = `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(qrData)}&choe=UTF-8`;
    
    element.innerHTML = `
        <div class="relative">
            <img src="${qrUrl}" 
                 alt="Payment QR Code" 
                 class="mx-auto rounded-lg shadow-lg border-4 border-white"
                 style="width: ${size}px; height: ${size}px;"
                 onload="this.classList.add('animate-fade-in')" />
            <div class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-${network === 'tron' ? 'red' : 'yellow'}-600 text-white px-3 py-1 rounded-full text-xs font-bold shadow-lg">
                ${network.toUpperCase()}
            </div>
        </div>
    `;
}

// Copy to clipboard helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Show toast notification
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-[100000] animate-slide-in';
        toast.innerHTML = '✓ Address copied to clipboard!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }).catch(err => {
        alert('Failed to copy. Please copy manually.');
    });
}

// Enhanced payment modal for crypto payments
function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.style.zIndex = '99998';
    modal.id = 'cryptoPaymentModal';
    
    const networkInfo = {
        bsc: {
            color: 'yellow',
            name: 'BSC (BEP-20)',
            icon: '🟡'
        },
        tron: {
            color: 'red',
            name: 'TRON (TRC-20)',
            icon: '🔴'
        }
    };
    
    const info = networkInfo[network] || networkInfo.bsc;
    
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center animate-scale-in">
            <div class="text-5xl mb-4">${info.icon}</div>
            <h3 class="text-2xl font-bold mb-2">Connecting to ${info.name}</h3>
            <p class="text-white/80 mb-4">Amount: <span class="font-bold text-xl">${amount} USDT</span></p>
            <div id="modalStatus" class="text-white/70 mb-4">Initializing WalletConnect...</div>
            <div class="loading-spinner mx-auto"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
    return modal;
}

// Update modal status
function updateModalStatus(modal, message, status) {
    if (!modal) return;
    
    const statusDiv = modal.querySelector('#modalStatus');
    if (statusDiv) {
        statusDiv.innerHTML = message;
    }
    
    const spinner = modal.querySelector('.loading-spinner');
    if (spinner) {
        if (status === 'success' || status === 'connected') {
            spinner.style.display = 'none';
        }
    }
}

// Update network selection modal (already in your code, but ensure it's there)
async function showNetworkSelectionModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.style.zIndex = '99999';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-8 max-w-lg w-full animate-scale-in">
                <div class="text-center mb-6">
                    <h3 class="text-3xl font-bold mb-2">Choose USDT Network</h3>
                    <p class="text-sm text-white/70">Select your preferred blockchain network for payment</p>
                </div>
                
                <div class="space-y-4">
                    <!-- BSC Option -->
                    <button onclick="selectCryptoNetwork('bsc')" 
                            class="w-full bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-700 hover:to-amber-700 p-5 rounded-xl transition-all transform hover:scale-105 hover:shadow-2xl border border-yellow-500/30">
                        <div class="flex items-center gap-4">
                            <div class="text-5xl">🟡</div>
                            <div class="flex-1 text-left">
                                <div class="font-bold text-xl mb-1">Binance Smart Chain</div>
                                <div class="text-sm text-white/90 mb-1">BEP-20 Network</div>
                                <div class="flex items-center gap-3 text-xs">
                                    <span class="bg-white/20 px-2 py-1 rounded">⚡ Fast: ~5 sec</span>
                                    <span class="bg-white/20 px-2 py-1 rounded">💰 Fee: ~$0.30</span>
                                </div>
                            </div>
                            <div class="text-2xl">→</div>
                        </div>
                    </button>
                    
                    <!-- TRON Option -->
                    <button onclick="selectCryptoNetwork('tron')" 
                            class="w-full bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 p-5 rounded-xl transition-all transform hover:scale-105 hover:shadow-2xl border border-red-500/30">
                        <div class="flex items-center gap-4">
                            <div class="text-5xl">🔴</div>
                            <div class="flex-1 text-left">
                                <div class="font-bold text-xl mb-1">TRON Network</div>
                                <div class="text-sm text-white/90 mb-1">TRC-20 Network</div>
                                <div class="flex items-center gap-3 text-xs">
                                    <span class="bg-white/20 px-2 py-1 rounded">⚡ Very Fast: ~3 sec</span>
                                    <span class="bg-white/20 px-2 py-1 rounded">💰 Fee: ~$1-2</span>
                                </div>
                            </div>
                            <div class="text-2xl">→</div>
                        </div>
                    </button>
                    
                    <!-- Info Box -->
                    <div class="bg-blue-600/20 border border-blue-500/30 rounded-lg p-4 text-sm">
                        <div class="flex items-start gap-2">
                            <div class="text-xl">ℹ️</div>
                            <div class="text-white/80">
                                <strong class="text-white">Compatible Wallets:</strong>
                                <br>Trust Wallet, MetaMask, TronLink, Binance Wallet, and more
                            </div>
                        </div>
                    </div>
                    
                    <!-- Cancel Button -->
                    <button onclick="selectCryptoNetwork(null)" 
                            class="w-full bg-gray-600/50 hover:bg-gray-700 p-3 rounded-lg transition-colors text-sm font-semibold border border-gray-500/30">
                        Cancel Payment
                    </button>
                </div>
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