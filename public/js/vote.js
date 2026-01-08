let currentParticipant = null;
let selectedVoteAmount = 1;
let selectedCost = 2.00;
let selectedPaymentMethod = 'flutterwave';

document.addEventListener('DOMContentLoaded', async function() {
    if (!window.initSupabaseFromMeta()) {
        showError('Supabase client not initialized. Check your configuration.');
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user') || urlParams.get('username');
    const userCode = urlParams.get('code') || urlParams.get('user_code');

    if (!username && !userCode) {
        showError('To vote, search for the participant using their username or user code, or simply click on their unique voting link.');
        return;
    }

    try {
        if (userCode) {
            currentParticipant = await window.fetchParticipantByUserCode(userCode);
        } else {
            currentParticipant = await window.fetchParticipantByUsername(username);
        }
        showParticipant();
    } catch (error) {
        showError(`Failed to load participant: ${error.message}`);
        return;
    }

    initializeVoteSelection();
    document.getElementById('voteButton').addEventListener('click', handleVote);
});

function showParticipant() {
    if (!currentParticipant) return;
    
    // Hide loading, show participant card
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('participantCard').classList.remove('hidden');
    
    // Populate participant details
    document.getElementById('participantName').textContent = currentParticipant.name;
    document.getElementById('participantUsername').textContent = currentParticipant.username;
    document.getElementById('participantEmail').textContent = currentParticipant.email;
    document.getElementById('currentVotes').textContent = currentParticipant.total_votes.toLocaleString();
    document.getElementById('participantRank').textContent = `#${currentParticipant.rank}`;
    
    // Generate initials for avatar
    const initials = currentParticipant.name
        .split(' ')
        .map(n => n.charAt(0))
        .join('')
        .toUpperCase()
        .slice(0, 2);
    document.getElementById('participantInitials').textContent = initials;
    
    // Calculate progress (goal is 1M votes)
    const goal = 1000000;
    const progressPercent = Math.min((currentParticipant.total_votes / goal) * 100, 100);
    document.getElementById('progressPercentage').textContent = `${progressPercent.toFixed(1)}%`;
    document.getElementById('progressBar').style.width = `${progressPercent}%`;
    
    // Update page title
    document.title = `Vote for ${currentParticipant.name} - One Dream Initiative`;
}

function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('participantCard').classList.add('hidden');
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorState').classList.remove('hidden');
}

function initializeVoteSelection() {
    const buttons = document.querySelectorAll('.vote-amount-btn');
    const customInput = document.getElementById('customVoteAmount');
    
    // Pre-select first option (1 vote, $2)
    buttons[0].classList.add('border-blue-500', 'bg-blue-500/30');
    selectedVoteAmount = 1;
    selectedCost = 2.00;
    updateUI();
    
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            // Clear all selections
            buttons.forEach(btn => {
                btn.classList.remove('border-blue-500', 'bg-blue-500/30');
            });
            customInput.value = '';
            
            // Select this button
            this.classList.add('border-blue-500', 'bg-blue-500/30');
            selectedVoteAmount = parseInt(this.dataset.amount);
            selectedCost = parseFloat(this.dataset.cost);
            updateUI();
        });
    });
    
    customInput.addEventListener('input', function() {
        // Clear button selections
        buttons.forEach(btn => {
            btn.classList.remove('border-blue-500', 'bg-blue-500/30');
        });
        
        selectedVoteAmount = parseInt(this.value) || 1;
        selectedCost = selectedVoteAmount * 2.00; // $2 per vote
        updateUI();
    });

    // Initialize payment method selection
    initializePaymentMethods();
}

function initializePaymentMethods() {
    const paymentButtons = document.querySelectorAll('.payment-method-btn');
    
    paymentButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Clear all selections
            paymentButtons.forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Select this payment method
            this.classList.add('active');
            selectedPaymentMethod = this.dataset.method;
            updateUI();
        });
    });
}

function updateUI() {
    document.getElementById('totalCost').textContent = selectedCost.toFixed(2);
    document.getElementById('voteButtonText').textContent = `Purchase ${selectedVoteAmount} Vote${selectedVoteAmount > 1 ? 's' : ''} - $${selectedCost.toFixed(2)}`;
}

async function handleVote() {
    if (!currentParticipant || selectedVoteAmount <= 0) {
        alert('Please select a valid vote amount');
        return;
    }
    
    const voteButton = document.getElementById('voteButton');
    const buttonText = document.getElementById('voteButtonText');
    const spinner = document.getElementById('voteButtonSpinner');
    
    // Show loading state
    voteButton.disabled = true;
    buttonText.textContent = 'Processing Payment...';
    spinner.classList.remove('hidden');
    
    try {
        await processPaymentAndVote();
        
        showSuccessModal();
        
    } catch (error) {
        console.error('Vote processing failed:', error);
        alert(`Payment failed: ${error.message}`);
    } finally {
        // Reset button state
        voteButton.disabled = false;
        updateUI();
        spinner.classList.add('hidden');
    }
}

async function processPaymentAndVote() {
    try {
        // Step 1: Create payment intent for selected method
        const paymentResponse = await fetch('/api/onedream/create-payment-intent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                participant_id: currentParticipant.id,
                vote_count: selectedVoteAmount,
                payment_method: selectedPaymentMethod
            })
        });

        if (!paymentResponse.ok) {
            const errorData = await paymentResponse.json();
            throw new Error(errorData.error || 'Failed to create payment');
        }

        const paymentData = await paymentResponse.json();

        // Step 2: Process payment based on selected method
        let paymentResult;
        switch (selectedPaymentMethod) {
            case 'flutterwave':
                paymentResult = await processFlutterwavePayment(paymentData);
                break;
            case 'paystack':
                paymentResult = await processPaystackPayment(paymentData);
                break;
            case 'crypto':
                paymentResult = await processCryptoPayment(paymentData);
                break;
            default:
                throw new Error('Unsupported payment method');
        }

        // Step 3: If payment successful, record votes
        if (paymentResult.success) {
            // For crypto payments, verify on-chain before crediting votes
            if (selectedPaymentMethod === 'crypto' && paymentResult.txHash) {
                await verifyAndRecordCryptoPayment(
                    paymentResult.txHash,
                    paymentResult.network || 'bsc'
                );
            } else {
                await recordVotesAfterPayment(paymentResult.payment_intent_id);
            }
        } else {
            throw new Error(paymentResult.error || 'Payment was not completed');
        }

    } catch (error) {
        console.error('Payment processing error:', error);
        throw error;
    }
}

async function processFlutterwavePayment(paymentData) {
    // Redirect to Flutterwave payment page
    if (paymentData.payment_link) {
        window.location.href = paymentData.payment_link;
        // Return pending status since user is being redirected
        return { success: false, error: 'Redirecting to Flutterwave...' };
    } else if (window.FlutterwaveCheckout) {
        // Use Flutterwave Inline if available
        return new Promise((resolve) => {
            FlutterwaveCheckout({
                public_key: window.FLUTTERWAVE_PUBLIC_KEY || 'FLWPUBK_TEST-XXXXX',
                tx_ref: paymentData.tx_ref,
                amount: selectedCost,
                currency: 'USD',
                payment_options: 'card,banktransfer,ussd',
                customer: {
                    email: 'voter@onedream.com',
                    name: 'One Dream Voter'
                },
                customizations: {
                    title: 'One Dream Initiative',
                    description: `Vote for ${currentParticipant.name}`,
                    logo: window.location.origin + '/logo.png'
                },
                callback: function(response) {
                    console.log('Flutterwave payment successful:', response);
                    if (response.status === 'successful') {
                        verifyFlutterwaveTransaction(response.tx_ref).then(verified => {
                            if (verified) {
                                resolve({ success: true, payment_intent_id: response.tx_ref });
                            } else {
                                resolve({ success: false, error: 'Payment verification failed' });
                            }
                        });
                    } else {
                        resolve({ success: false, error: 'Payment failed' });
                    }
                },
                onclose: function() {
                    console.log('Flutterwave popup closed');
                    resolve({ success: false, error: 'Payment cancelled by user' });
                }
            });
        });
    } else {
        return { success: false, error: 'Flutterwave not available' };
    }
}

async function verifyFlutterwaveTransaction(txRef) {
    try {
        const response = await fetch('/api/onedream/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payment_intent_id: txRef,
                payment_method: 'flutterwave'
            })
        });
        
        const data = await response.json();
        return data.verified === true;
    } catch (error) {
        console.error('Flutterwave verification error:', error);
        return false;
    }
}

async function processPaystackPayment(paymentData) {
    // Check if Paystack Inline is available
    if (!window.PaystackPop) {
        console.error('Paystack Inline JS not loaded');
        // Fallback to redirect method
        if (paymentData.authorization_url) {
            window.location.href = paymentData.authorization_url;
            return { success: false, error: 'Redirecting to Paystack...' };
        }
        return { success: false, error: 'Paystack not available' };
    }

    return new Promise((resolve) => {
        // Generate a unique reference on the client side to ensure uniqueness
        const uniqueRef = `${paymentData.reference}_${Math.random().toString(36).substring(2, 9)}`;
        
        const handler = PaystackPop.setup({
            key: window.PAYSTACK_PUBLIC_KEY || 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxx', // Set your public key
            email: 'voter@onedream.com', // Default email for anonymous payments
            amount: selectedCost * 100 * 1600, // Amount in kobo, converted from USD to NGN
            currency: 'NGN',
            ref: uniqueRef,
            metadata: {
                participant_id: currentParticipant.id,
                participant_name: currentParticipant.name,
                vote_count: selectedVoteAmount,
                custom_fields: [
                    {
                        display_name: "Participant",
                        variable_name: "participant_name",
                        value: currentParticipant.name
                    },
                    {
                        display_name: "Votes",
                        variable_name: "vote_count",
                        value: selectedVoteAmount.toString()
                    }
                ]
            },
            onClose: function() {
                console.log('Paystack popup closed');
                resolve({ success: false, error: 'Payment cancelled by user' });
            },
            callback: function(response) {
                console.log('Paystack payment successful:', response);
                // Verify the payment on the server
                verifyPaystackTransaction(response.reference).then(verified => {
                    if (verified) {
                        resolve({ success: true, payment_intent_id: response.reference });
                    } else {
                        resolve({ success: false, error: 'Payment verification failed' });
                    }
                });
            }
        });

        handler.openIframe();
    });
}

async function verifyPaystackTransaction(reference) {
    try {
        const response = await fetch('/api/onedream/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payment_intent_id: reference,
                payment_method: 'paystack',
                reference: reference
            })
        });
        
        const data = await response.json();
        return data.verified === true;
    } catch (error) {
        console.error('Paystack verification error:', error);
        return false;
    }
}

async function processCryptoPayment(paymentData) {
    // Ask user to choose network
    const network = await showNetworkSelectionModal();
    
    if (!network) {
        return { success: false, error: 'Payment cancelled by user' };
    }
    
    if (network === 'bsc') {
        return await processBSCPayment();
    } else if (network === 'tron') {
        return await processTronPayment();
    }
}

async function showNetworkSelectionModal() {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-8 max-w-md w-full">
                <h3 class="text-2xl font-bold mb-4 text-center">Choose Network</h3>
                <p class="text-sm text-white/70 mb-6 text-center">Select your preferred USDT network</p>
                <div class="space-y-4">
                    <button onclick="selectNetwork('bsc')" 
                            class="w-full bg-yellow-600 hover:bg-yellow-700 p-4 rounded-lg transition-colors">
                        <div class="text-2xl mb-2">🟡</div>
                        <div class="font-bold">BSC (BEP-20)</div>
                        <div class="text-sm text-white/80">Binance Smart Chain</div>
                        <div class="text-xs text-white/60 mt-1">Low fees • Fast</div>
                    </button>
                    <button onclick="selectNetwork('tron')" 
                            class="w-full bg-red-600 hover:bg-red-700 p-4 rounded-lg transition-colors">
                        <div class="text-2xl mb-2">🔴</div>
                        <div class="font-bold">TRON (TRC-20)</div>
                        <div class="text-sm text-white/80">Tron Network</div>
                        <div class="text-xs text-white/60 mt-1">Very low fees • Fast</div>
                    </button>
                    <button onclick="selectNetwork(null)" 
                            class="w-full bg-gray-600 hover:bg-gray-700 p-3 rounded-lg transition-colors text-sm">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        window.selectNetwork = function(network) {
            modal.remove();
            delete window.selectNetwork;
            resolve(network);
        };
    });
}

async function processBSCPayment() {
    try {
        // Detect if user is on mobile
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Desktop: check for browser extension
        if (!isMobile) {
            if (window.ethereum) {
                const useExtension = confirm(
                    '🦊 MetaMask Detected!\n\n' +
                    'Click OK to use MetaMask extension\n' +
                    'Click Cancel to use WalletConnect (for mobile wallets)'
                );
                
                if (useExtension) {
                    console.log('Using browser wallet (MetaMask/injected)');
                    return await processBSCWithBrowserWallet();
                }
            }
            
            // Desktop without extension - use WalletConnect QR
            console.log('Using WalletConnect QR for desktop');
            return await processBSCWithWalletConnect();
        }
        
        // Mobile: check for installed wallets first
        const installedWallets = detectInstalledMobileWallets();
        
        if (installedWallets.length > 0) {
            // Show wallet selection modal for installed apps
            const selectedWallet = await showInstalledWalletSelector(installedWallets);
            
            if (!selectedWallet) {
                return { success: false, error: 'Payment cancelled by user' };
            }
            
            // Use deep link to open specific wallet app
            return await processBSCWithMobileWallet(selectedWallet);
        } else {
            // No wallets detected - show WalletConnect with install prompts
            return await processBSCWithWalletConnect();
        }
        
    } catch (error) {
        console.error('BSC payment error:', error);
        return { success: false, error: error.message || 'BSC payment failed' };
    }
}

// Detect which mobile wallets are installed
function detectInstalledMobileWallets() {
    const wallets = [];
    
    // Check for injected providers (in-app browsers)
    if (window.ethereum) {
        if (window.ethereum.isMetaMask) {
            wallets.push({ name: 'MetaMask', id: 'metamask', icon: '🦊' });
        }
        if (window.ethereum.isTrust) {
            wallets.push({ name: 'Trust Wallet', id: 'trust', icon: '🛡️' });
        }
        if (window.ethereum.isCoinbaseWallet) {
            wallets.push({ name: 'Coinbase Wallet', id: 'coinbase', icon: '💙' });
        }
        // Generic Web3 wallet detected
        if (wallets.length === 0) {
            wallets.push({ name: 'Web3 Wallet', id: 'generic', icon: '💼' });
        }
    }
    
    // Mobile deep link detection (check if apps are installed)
    // These are heuristics - not 100% accurate but helpful
    const userAgent = navigator.userAgent.toLowerCase();
    
    if (userAgent.includes('trust')) {
        if (!wallets.find(w => w.id === 'trust')) {
            wallets.push({ name: 'Trust Wallet', id: 'trust', icon: '🛡️' });
        }
    }
    
    if (userAgent.includes('metamask')) {
        if (!wallets.find(w => w.id === 'metamask')) {
            wallets.push({ name: 'MetaMask', id: 'metamask', icon: '🦊' });
        }
    }
    
    return wallets;
}

// Show modal to select from installed wallets
async function showInstalledWalletSelector(wallets) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        
        const walletButtons = wallets.map(wallet => `
            <button onclick="selectInstalledWallet('${wallet.id}')" 
                    class="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 p-4 rounded-lg transition-all transform hover:scale-105">
                <div class="flex items-center gap-3">
                    <span class="text-3xl">${wallet.icon}</span>
                    <div class="text-left">
                        <div class="font-bold text-lg">${wallet.name}</div>
                        <div class="text-xs text-white/80">Installed on this device</div>
                    </div>
                </div>
            </button>
        `).join('');
        
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-6 max-w-md w-full">
                <h3 class="text-2xl font-bold mb-2 text-center">Select Wallet</h3>
                <p class="text-sm text-white/70 mb-6 text-center">Choose your wallet to complete payment</p>
                <div class="space-y-3 mb-4">
                    ${walletButtons}
                </div>
                <button onclick="selectInstalledWallet('other')" 
                        class="w-full bg-gray-700 hover:bg-gray-600 p-3 rounded-lg transition-colors text-sm">
                    Use WalletConnect (Other Wallets)
                </button>
                <button onclick="selectInstalledWallet(null)" 
                        class="w-full mt-2 bg-transparent hover:bg-white/10 p-2 rounded-lg transition-colors text-sm text-white/70">
                    Cancel
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        window.selectInstalledWallet = function(walletId) {
            modal.remove();
            delete window.selectInstalledWallet;
            resolve(walletId === 'other' ? 'walletconnect' : walletId);
        };
    });
}

// Process payment using specific mobile wallet
async function processBSCWithMobileWallet(walletId) {
    // If user selected WalletConnect or no specific wallet
    if (walletId === 'walletconnect') {
        return await processBSCWithWalletConnect();
    }
    
    // If wallet is already injected (in-app browser)
    if (window.ethereum) {
        console.log(`Using injected wallet: ${walletId}`);
        return await processBSCWithBrowserWallet();
    }
    
    // Generate deep link to open wallet app
    const deepLink = generateWalletDeepLink(walletId);
    
    alert(
        `Opening ${walletId === 'metamask' ? 'MetaMask' : walletId === 'trust' ? 'Trust Wallet' : 'your wallet'}...\n\n` +
        'If the app doesn\'t open automatically, please:\n' +
        '1. Open your wallet app manually\n' +
        '2. Look for the connection request\n' +
        '3. Approve and complete the payment'
    );
    
    // Open wallet app via deep link
    window.location.href = deepLink;
    
    // Fall back to WalletConnect after short delay
    setTimeout(async () => {
        return await processBSCWithWalletConnect();
    }, 3000);
    
    return { success: false, error: 'Redirecting to wallet app...' };
}

// Generate deep link for specific wallet
function generateWalletDeepLink(walletId) {
    const currentUrl = window.location.href;
    const wcUri = ''; // WalletConnect URI would go here
    
    switch (walletId) {
        case 'metamask':
            return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
        case 'trust':
            return `https://link.trustwallet.com/open_url?url=${encodeURIComponent(currentUrl)}`;
        case 'coinbase':
            return `https://go.cb-w.com/dapp?url=${encodeURIComponent(currentUrl)}`;
        default:
            return currentUrl;
    }
}

// Browser wallet flow (MetaMask extension, etc.)
async function processBSCWithBrowserWallet() {
    const provider = new ethers.BrowserProvider(window.ethereum);

    // Request account access
    const accounts = await provider.send('eth_requestAccounts', []);
    const walletAddress = accounts[0];

    // Check if on BSC network
    const network = await provider.getNetwork();
    if (network.chainId !== 56n) {
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x38' }],
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
            } else {
                throw switchError;
            }
        }
    }

    console.log('Connected wallet:', walletAddress);

    // Calculate amount in USDT (18 decimals on BSC)
    const amountUSD = selectedCost;
    const amountInWei = ethers.parseUnits(amountUSD.toString(), 18);

    // USDT contract on BSC (BEP-20)
    const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
    const recipientAddress = window.CRYPTO_WALLET_ADDRESS_BSC;

    // Create contract instance
    const signer = await provider.getSigner();
    const usdtContract = new ethers.Contract(
        usdtAddress,
        ['function transfer(address to, uint256 amount) returns (bool)'],
        signer
    );

    // Send transaction
    const tx = await usdtContract.transfer(recipientAddress, amountInWei);
    console.log('Transaction sent:', tx.hash);

    // Wait for 1 confirmation
    await tx.wait(1);
    console.log('Transaction confirmed:', tx.hash);

    return { 
        success: true, 
        payment_intent_id: tx.hash,
        txHash: tx.hash,
        explorer: `https://bscscan.com/tx/${tx.hash}`
    };
}

// WalletConnect flow with mobile deep linking
async function processBSCWithWalletConnect() {
    try {
        // Check if WalletConnect libraries are loaded
        if (typeof EthereumProvider === 'undefined') {
            console.error('WalletConnect not loaded');
            return { 
                success: false, 
                error: 'WalletConnect library not available. Please try using MetaMask extension.' 
            };
        }

        // Initialize WalletConnect Provider
        const provider = await EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || 'WALLETCONNECT_PROJECT_ID_REMOVED',
            chains: [56], // BSC mainnet
            showQrModal: true,
            methods: ['eth_sendTransaction', 'eth_accounts', 'eth_requestAccounts', 'eth_call', 'eth_getBalance', 'eth_signTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData'],
            events: ['chainChanged', 'accountsChanged'],
            metadata: {
                name: 'One Dream Initiative',
                description: 'Vote with Crypto - BSC USDT Payment',
                url: window.location.origin,
                icons: [window.location.origin + '/logo.png']
            },
            qrModalOptions: {
                themeMode: 'dark',
                themeVariables: {
                    '--wcm-z-index': '10000'
                }
            }
        });

        // Enable session (shows QR on desktop, deep links on mobile)
        console.log('🔗 Connecting to WalletConnect...');
        await provider.connect();

        // Get connected accounts
        const accounts = await provider.request({ method: 'eth_accounts' });
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts found');
        }

        const walletAddress = accounts[0];
        console.log('✅ Connected wallet:', walletAddress);

        // Check network
        const chainId = await provider.request({ method: 'eth_chainId' });
        const currentChainId = parseInt(chainId, 16);
        
        if (currentChainId !== 56) {
            // Request network switch to BSC
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }],
                });
            } catch (switchError) {
                // If BSC not added, add it
                if (switchError.code === 4902) {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x38',
                            chainName: 'BNB Smart Chain',
                            nativeCurrency: {
                                name: 'BNB',
                                symbol: 'BNB',
                                decimals: 18
                            },
                            rpcUrls: ['https://bsc-dataseed.binance.org/'],
                            blockExplorerUrls: ['https://bscscan.com/']
                        }]
                    });
                } else {
                    throw switchError;
                }
            }
        }

        // Create ethers provider
        const ethersProvider = new ethers.BrowserProvider(provider);
        const signer = await ethersProvider.getSigner();

        // USDT contract details
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955'; // USDT BEP-20
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_BSC;
        const amountUSD = selectedCost;
        const amountInWei = ethers.parseUnits(amountUSD.toString(), 18);

        console.log('📝 Preparing USDT transfer:', {
            from: walletAddress,
            to: recipientAddress,
            amount: `${amountUSD} USDT`,
            amountInWei: amountInWei.toString()
        });

        // Create USDT contract instance
        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        // Send transaction
        console.log('💸 Sending transaction...');
        const tx = await usdtContract.transfer(recipientAddress, amountInWei);
        console.log('✅ Transaction sent:', tx.hash);

        // Show pending notification
        alert(`Transaction sent!\nHash: ${tx.hash}\n\nWaiting for confirmation...`);

        // Wait for confirmation
        const receipt = await tx.wait(1);
        console.log('✅ Transaction confirmed:', receipt);

        // Disconnect after successful payment
        await provider.disconnect();

        return {
            success: true,
            payment_intent_id: tx.hash,
            txHash: tx.hash,
            network: 'bsc',
            explorer: `https://bscscan.com/tx/${tx.hash}`
        };

    } catch (error) {
        console.error('❌ WalletConnect error:', error);

        // Handle specific error types
        if (error.code === 4001 || error.message?.includes('User rejected')) {
            return { success: false, error: 'Connection cancelled by user' };
        }

        if (error.code === -32000 || error.message?.includes('insufficient funds')) {
            return { success: false, error: 'Insufficient USDT balance in your wallet' };
        }

        return { 
            success: false, 
            error: error.message || 'WalletConnect payment failed' 
        };
    }
}

// Generic WalletConnect (QR code for desktop)
async function processTronPayment() {
    try {
        // Check if TronLink is installed
        if (!window.tronWeb || !window.tronWeb.ready) {
            alert('Please install TronLink wallet extension to pay with USDT TRC-20');
            window.open('https://www.tronlink.org/', '_blank');
            return { success: false, error: 'TronLink wallet not found' };
        }

        const tronWeb = window.tronWeb;
        const userAddress = tronWeb.defaultAddress.base58;
        
        if (!userAddress) {
            return { success: false, error: 'Please unlock TronLink wallet' };
        }

        console.log('TronLink connected:', userAddress);

        // USDT TRC-20 contract address
        const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const recipientAddress = window.CRYPTO_WALLET_ADDRESS_TRON;
        const amountUSD = selectedCost;
        
        // USDT TRC-20 has 6 decimals
        const amount = Math.floor(amountUSD * 1000000);

        // Get contract instance
        const contract = await tronWeb.contract().at(usdtContract);
        
        // Send USDT
        const txResult = await contract.transfer(recipientAddress, amount).send();
        
        console.log('Tron transaction:', txResult);

        return {
            success: true,
            payment_intent_id: txResult,
            txHash: txResult,
            explorer: `https://tronscan.org/#/transaction/${txResult}`
        };

    } catch (error) {
        console.error('Tron payment error:', error);
        
        if (error.message && error.message.includes('Confirmation declined')) {
            return { success: false, error: 'Payment cancelled by user' };
        }
        
        return { success: false, error: error.message || 'Tron payment failed' };
    }
}

function showCryptoPaymentModal(paymentData) {
    // Create and show crypto payment modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            <h3 class="text-2xl font-bold mb-4">Cryptocurrency Payment</h3>
            <div class="mb-4">
                <img src="${paymentData.qr_code_url}" alt="Payment QR Code" class="mx-auto mb-4 rounded-lg">
                <p class="text-sm mb-2">Send exactly:</p>
                <div class="bg-white/10 p-3 rounded-lg mb-2">
                    <code class="text-sm">${paymentData.amount_btc} BTC</code>
                </div>
                <div class="bg-white/10 p-3 rounded-lg mb-4">
                    <code class="text-sm">${paymentData.crypto_address}</code>
                </div>
                <p class="text-xs text-white/60">${paymentData.instructions}</p>
            </div>
            <div class="flex gap-4">
                <button onclick="this.closest('.fixed').remove()" 
                        class="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg transition-colors flex-1">
                    Cancel
                </button>
                <button onclick="confirmCryptoPayment(this)" 
                        class="bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg transition-colors flex-1">
                    Payment Sent
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    return new Promise((resolve) => {
        window.confirmCryptoPayment = function(button) {
            modal.remove();
            resolve(true);
        };
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                resolve(false);
            }
        });
    });
}

async function recordVotesAfterPayment(paymentIntentId) {
    // Get voter information for analytics
    const voterInfo = {
        ip: await getClientIP(),
        userAgent: navigator.userAgent
    };

    // Call the vote API with confirmed payment
    const response = await fetch('/api/onedream/vote', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            participant_id: currentParticipant.id,
            vote_count: selectedVoteAmount,
            payment_amount: selectedCost,
            payment_method: 'stripe',
            payment_intent_id: paymentIntentId,
            payment_status: 'completed',
            voter_info: voterInfo
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to record votes after payment');
    }

    const data = await response.json();
    
    // Update current participant data with response
    if (data.participant) {
        currentParticipant.total_votes = data.participant.total_votes;
    }
    
    console.log('✅ Payment processed and votes recorded:', data);
    return data;
}

// Helper function to get client IP (best effort)
async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.warn('Could not get client IP:', error);
        return null;
    }
}

function showSuccessModal() {
    document.getElementById('successParticipantName').textContent = currentParticipant.name;
    document.getElementById('successVoteCount').textContent = selectedVoteAmount;
    document.getElementById('successModal').classList.remove('hidden');
    
    // Update participant display
    showParticipant();
}

function closeSuccessModal() {
    document.getElementById('successModal').classList.add('hidden');
    
    // Reset vote selection to 1 vote
    selectedVoteAmount = 1;
    selectedCost = 2.00;
    document.getElementById('customVoteAmount').value = '';
    
    // Re-select first option
    const buttons = document.querySelectorAll('.vote-amount-btn');
    buttons.forEach(btn => btn.classList.remove('border-blue-500', 'bg-blue-500/30'));
    buttons[0].classList.add('border-blue-500', 'bg-blue-500/30');
    
    updateUI();
}

// ✅ Verify crypto payment on-chain and credit votes
async function verifyAndRecordCryptoPayment(txHash, network) {
    try {
        const response = await fetch('/api/onedream/verify-usdt-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tx_hash: txHash,
                network: network,
                participant_id: currentParticipant.id,
                expected_amount: selectedCost
            })
        });

        const data = await response.json();

        if (data.pending) {
            // Transaction pending confirmation
            alert(`Payment received! Waiting for ${data.required - data.confirmations} more confirmation(s). Your votes will be credited shortly.`);
            return;
        }

        if (!data.success) {
            throw new Error(data.error || 'Payment verification failed');
        }

        console.log('✅ Crypto payment verified and votes credited:', data);

    } catch (error) {
        console.error('Crypto verification error:', error);
        // Don't fail the whole flow - reconciliation script will handle it
        alert('Payment sent! Verification pending. Your votes will be credited within a few minutes.');
    }
}

// Sharing functions
function shareOnTwitter() {
    const text = `I just voted for ${currentParticipant.name} in the One Dream Initiative! 🌟 Help them reach their goal of 1M votes!`;
    const url = window.location.href;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
}

function shareOnFacebook() {
    const url = window.location.href;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
}

function copyVoteLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        alert('Vote link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

function generateUserCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

console.log('🗳️ One Dream Initiative Vote Page loaded');
console.log('🔐 Using secure configuration from environment variables');