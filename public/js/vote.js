console.log('📦 Vote.js Loading...');

// ========================================
// PAGE INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('🎬 Vote page initializing...');

    if (!window.__onedreamSupabase && typeof window.initializeSupabase === 'function') {
        const ok = window.initializeSupabase();
        if (!ok) {
            showError('Supabase failed to initialize. Some features may not work.');
            return;
        }
    }

    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user') || urlParams.get('username');
    const userCode = urlParams.get('code');

    if (!username && !userCode) {
        showError('To vote, search for the participant using their username or user code.');
        return;
    }

    try {
        if (userCode) {
            window.currentParticipant = await window.fetchParticipantByUserCode(userCode);
        } else {
            window.currentParticipant = await window.fetchParticipantByUsername(username);
        }

        if (!window.currentParticipant) {
            showError('Participant not found.');
            return;
        }

        showParticipant();
        initializeVoteSelection();
    } catch (error) {
        console.error('Failed to load participant:', error);
        showError(`Failed to load participant: ${error.message}`);
    }
});

/* ======================================================
    🚀 SDK LOADER: Fixes "Cannot read init of undefined"
====================================================== */
async function loadWalletConnect() {
    if (window.EthereumProvider) return window.EthereumProvider;

    return new Promise((resolve, reject) => {
        console.log('⏳ Injecting WalletConnect SDK...');
        const script = document.createElement('script');
        script.src = "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
        script.onload = () => resolve(window.EthereumProvider);
        script.onerror = () => reject(new Error("Failed to load WalletConnect library."));
        document.head.appendChild(script);
    });
}

// ========================================
// HANDLE VOTE / PAYMENT (CLEANED & MERGED)
// ========================================
async function handleVote() {
    if (window.selectedPaymentMethod === 'crypto' && typeof window.processCryptoPayment !== 'function') {
        alert("Payment system is still loading. Please wait 2 seconds and try again.");
        return;
    }
    if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
        alert('Please select a valid vote amount');
        return;
    }

    const voteButton = document.getElementById('voteButton');
    const spinner = document.getElementById('voteButtonSpinner');
    const buttonText = document.getElementById('voteButtonText');

    // UI State: Loading
    voteButton.disabled = true;
    spinner.classList.remove('hidden');
    const originalText = buttonText.textContent;
    buttonText.textContent = 'Preparing Secure Payment...';

    try {
        let paymentResult;

        if (window.selectedPaymentMethod === 'crypto') {
            // Ensure SDK is ready
            await loadWalletConnect();
            
            if (typeof window.processCryptoPayment !== 'function') {
                throw new Error('Crypto payment module not loaded. Please refresh.');
            }
            
            paymentResult = await window.processCryptoPayment();
        } else {
            throw new Error('Selected payment method not available yet');
        }

        // Validate Result
        if (!paymentResult?.success) {
            if (paymentResult?.error === 'User rejected request') return; 
            throw new Error(paymentResult?.error || 'Payment failed');
        }

        // UI State: Recording
        buttonText.textContent = 'Finalizing Votes...';
        await recordVotesAfterPayment(paymentResult);
        
        // UI State: Success
        showSuccessModal(); 
    } catch (error) {
        console.error('Vote processing failed:', error);
        alert(`Error: ${error.message}`);
    } finally {
        voteButton.disabled = false;
        spinner.classList.add('hidden');
        buttonText.textContent = originalText;
        updateUI();
    }
}

// ========================================
// RECORD VOTES AFTER PAYMENT
// ========================================
async function recordVotesAfterPayment(paymentResult) {
    const response = await fetch('/api/onedream/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: window.currentParticipant.id,
            vote_count: window.selectedVoteAmount,
            payment_amount: window.selectedCost,
            payment_method: window.selectedPaymentMethod,
            payment_intent_id: paymentResult.txHash || paymentResult.payment_intent_id,
            payment_status: 'completed',
            voter_info: {
                userAgent: navigator.userAgent
            }
        })
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to record votes');
    }

    const data = await response.json();
    if (data.participant) {
        window.currentParticipant.total_votes = data.participant.total_votes;
        showParticipant();
    }
    console.log('✅ Votes recorded');
}

// ========================================
// DISPLAY & UI HELPERS
// ========================================
function showParticipant() {
    if (!window.currentParticipant) return;
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('participantCard').classList.remove('hidden');

    const p = window.currentParticipant;
    document.getElementById('participantName').textContent = p.name;
    document.getElementById('participantUsername').textContent = p.username;
    document.getElementById('currentVotes').textContent = (p.total_votes || 0).toLocaleString();
    
    const goal = 1_000_000;
    const progress = Math.min((p.total_votes / goal) * 100, 100);
    document.getElementById('progressPercentage').textContent = `${progress.toFixed(1)}%`;
    document.getElementById('progressBar').style.width = `${progress}%`;
}

function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorState').classList.remove('hidden');
}

function initializeVoteSelection() {
    const buttons = document.querySelectorAll('.vote-amount-btn');
    const customInput = document.getElementById('customVoteAmount');

    window.selectedVoteAmount = 1;
    window.selectedCost = 2.0;
    updateUI();

    buttons.forEach(button => {
        button.addEventListener('click', function () {
            buttons.forEach(btn => btn.classList.remove('active'));
            customInput.value = '';
            this.classList.add('active');
            window.selectedVoteAmount = parseInt(this.dataset.amount);
            window.selectedCost = parseFloat(this.dataset.cost);
            updateUI();
        });
    });

    customInput.addEventListener('input', function () {
        buttons.forEach(btn => btn.classList.remove('active'));
        const amount = parseInt(this.value) || 1;
        window.selectedVoteAmount = amount;
        window.selectedCost = amount * 2;
        updateUI();
    });

    initializePaymentMethods();
    document.getElementById('voteButton').addEventListener('click', handleVote);
}

function initializePaymentMethods() {
    const buttons = document.querySelectorAll('.payment-method-btn');
    buttons.forEach(button => {
        button.addEventListener('click', function () {
            buttons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            window.selectedPaymentMethod = this.dataset.method;
            updateUI();
        });
    });
}

function updateUI() {
    document.getElementById('totalCost').textContent = window.selectedCost.toFixed(2);
    document.getElementById('voteButtonText').textContent =
        `Purchase ${window.selectedVoteAmount} Vote${window.selectedVoteAmount > 1 ? 's' : ''} - $${window.selectedCost.toFixed(2)}`;
}

function showSuccessModal() {
    document.getElementById('successParticipantName').textContent = window.currentParticipant.name;
    document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
    document.getElementById('successModal').classList.remove('hidden');
}

function closeSuccessModal() {
    document.getElementById('successModal').classList.add('hidden');
    updateUI();
}

// GLOBAL EXPORTS
window.closeSuccessModal = closeSuccessModal;
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;

// Network Handlers (Exported for direct debugging if needed)
window.processUSDTPaymentBSC = processUSDTPaymentBSC;
window.processUSDTPaymentTron = processUSDTPaymentTron;
window.processBSCWithWalletConnect = processBSCWithWalletConnect;
window.processBSCWithInjectedWallet = processBSCWithInjectedWallet;
window.processTronWithQRCode = processTronWithQRCode;

// UI Components
window.showNetworkSelectionModal = showNetworkSelectionModal;
window.showEnhancedPaymentModal = showEnhancedPaymentModal;
window.updateModalStatus = updateModalStatus;
window.generateQR = generateQR;

// Environment Constants (Ensure these are set in your HTML or here)
window.WALLETCONNECT_PROJECT_ID = window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5';

console.log('✅ Crypto Payments Module: All functions successfully exported to window scope.');