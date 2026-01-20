console.log('📦 Vote.js Loading...');

// Global variables (declared in HTML)
// window.currentParticipant
// window.selectedVoteAmount
// window.selectedCost
// window.selectedPaymentMethod

// ========================================
// PAGE INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🎬 Vote page initializing...');

    // Get participant from URL
    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user') || urlParams.get('username');
    const userCode = urlParams.get('code');

    if (!username && !userCode) {
        showError('To vote, search for the participant using their username or user code.');
        return;
    }

    try {
        // Fetch participant data
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

// ========================================
// DISPLAY PARTICIPANT
// ========================================
function showParticipant() {
    if (!window.currentParticipant) return;

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('participantCard').classList.remove('hidden');

    const p = window.currentParticipant;
    document.getElementById('participantName').textContent = p.name;
    document.getElementById('participantUsername').textContent = p.username;
    document.getElementById('participantEmail').textContent = p.email || 'N/A';
    document.getElementById('currentVotes').textContent = (p.total_votes || 0).toLocaleString();
    document.getElementById('participantRank').textContent = `#${p.rank || '?'}`;

    const initials = p.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    document.getElementById('participantInitials').textContent = initials;

    const goal = 1000000;
    const progress = Math.min((p.total_votes / goal) * 100, 100);
    document.getElementById('progressPercentage').textContent = `${progress.toFixed(1)}%`;
    document.getElementById('progressBar').style.width = `${progress}%`;

    console.log('✅ Participant displayed:', p.name);
}

function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('participantCard').classList.add('hidden');
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorState').classList.remove('hidden');
}

// ========================================
// VOTE AMOUNT SELECTION
// ========================================
function initializeVoteSelection() {
    const buttons = document.querySelectorAll('.vote-amount-btn');
    const customInput = document.getElementById('customVoteAmount');

    if (buttons[0]) {
        buttons[0].classList.add('active');
        window.selectedVoteAmount = 1;
        window.selectedCost = 2.00;
    }
    updateUI();

    buttons.forEach(button => {
        button.addEventListener('click', function() {
            buttons.forEach(btn => btn.classList.remove('active'));
            customInput.value = '';
            this.classList.add('active');
            window.selectedVoteAmount = parseInt(this.dataset.amount);
            window.selectedCost = parseFloat(this.dataset.cost);
            updateUI();
        });
    });

    customInput.addEventListener('input', function() {
        buttons.forEach(btn => btn.classList.remove('active'));
        const amount = parseInt(this.value) || 1;
        if (amount < 1 || amount > 1000) {
            this.classList.add('error-input');
            return;
        }
        this.classList.remove('error-input');
        window.selectedVoteAmount = amount;
        window.selectedCost = window.selectedVoteAmount * 2;
        updateUI();
    });

    initializePaymentMethods();

    // Attach vote button handler
    document.getElementById('voteButton').addEventListener('click', handleVote);
}

function initializePaymentMethods() {
    const buttons = document.querySelectorAll('.payment-method-btn');
    buttons.forEach(button => {
        button.addEventListener('click', function() {
            if (this.classList.contains('disabled')) return;
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

// ========================================
// HANDLE VOTE/PAYMENT
// ========================================

// MetaMask initialization for direct BSC payments
async function initMetaMask() {
    if (typeof window.ethereum === "undefined") {
        alert("MetaMask is not installed. Please install it to continue.");
        throw new Error("MetaMask not found");
    }
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    return provider;
}

// Direct USDT transfer using MetaMask (fallback)
async function processVotePayment(amountUSDT) {
    try {
        const provider = await initMetaMask();
        const signer = provider.getSigner();
        const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
        const USDT_ABI = ["function transfer(address to, uint amount) returns (bool)"];
        const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer);

        const RECIPIENT_ADDRESS = "0xYOUR_RECIPIENT_ADDRESS"; // replace with your wallet
        const tx = await usdt.transfer(
            RECIPIENT_ADDRESS,
            ethers.utils.parseUnits(amountUSDT.toString(), 18)
        );

        console.log("Transaction sent:", tx.hash);
        await tx.wait();
        console.log("Transaction confirmed!");
        alert("Vote recorded successfully!");
        return { success: true, txHash: tx.hash };
    } catch (err) {
        console.error("Vote processing failed:", err);
        alert("Vote failed. Please try again.");
        return { success: false, error: err.message };
    }
}

async function handleVote(event) {
    if (event) event.preventDefault();

    if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
        alert('Please select a valid vote amount');
        return;
    }

    const voteButton = document.getElementById('voteButton');
    const buttonText = document.getElementById('voteButtonText');
    const spinner = document.getElementById('voteButtonSpinner');

    voteButton.disabled = true;
    buttonText.textContent = 'Processing Payment...';
    spinner.classList.remove('hidden');

    try {
        let paymentResult;

        if (window.selectedPaymentMethod === 'crypto') {
            // Call crypto-payments.js function
            if (typeof window.processCryptoPayment === 'function') {
                paymentResult = await window.processCryptoPayment();
            } else {
                // Fallback to direct MetaMask transfer
                paymentResult = await processVotePayment(window.selectedVoteAmount);
            }
        } else if (window.selectedPaymentMethod === 'paystack') {
            alert('PayStack payment coming soon. Please use Crypto for now.');
            throw new Error('PayStack not implemented');
        }

        if (!paymentResult || !paymentResult.success) {
            throw new Error(paymentResult?.error || 'Payment failed');
        }

        // Record votes in DB
        await recordVotesAfterPayment(paymentResult);

        // Show success
        showSuccessModal();

    } catch (error) {
        console.error('Vote processing failed:', error);
        alert(`Payment failed: ${error.message}`);
    } finally {
        voteButton.disabled = false;
        updateUI();
        spinner.classList.add('hidden');
    }
}

// ========================================
// RECORD VOTES AFTER PAYMENT
// ========================================
async function recordVotesAfterPayment(paymentResult) {
    try {
        const response = await fetch('/api/onedream/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: window.currentParticipant.id,
                vote_count: window.selectedVoteAmount,
                payment_amount: window.selectedCost,
                payment_method: window.selectedPaymentMethod,
                payment_intent_id: paymentResult.payment_intent_id || paymentResult.txHash,
                payment_status: 'completed',
                voter_info: { ip: null, userAgent: navigator.userAgent }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to record votes');
        }

        const data = await response.json();
        if (data.participant) {
            window.currentParticipant.total_votes = data.participant.total_votes;
            showParticipant();
        }

        if (data.milestones_achieved && data.milestones_achieved.length > 0) {
            showMilestoneAchievements(data.milestones_achieved);
        }

        return data;

    } catch (error) {
        console.error('Failed to record votes:', error);
        throw error;
    }
}

// ========================================
// MILESTONE ACHIEVEMENTS
// ========================================
function showMilestoneAchievements(milestones) {
    const milestoneHtml = milestones.map(m => `<div class="mb-2">🏆 ${m.name} ${m.icon || ''}</div>`).join('');
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            <div class="text-6xl mb-4">🎉</div>
            <h3 class="text-2xl font-bold mb-4">New Milestones Achieved!</h3>
            <div class="mb-6">${milestoneHtml}</div>
            <button onclick="this.closest('.fixed').remove()" 
                    class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition-colors">
                Awesome!
            </button>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 5000);
}

// ========================================
// SUCCESS MODAL
// ========================================
function showSuccessModal() {
    document.getElementById('successParticipantName').textContent = window.currentParticipant.name;
    document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
    document.getElementById('successModal').classList.remove('hidden');
}

function closeSuccessModal() {
    document.getElementById('successModal').classList.add('hidden');
    window.selectedVoteAmount = 1;
    window.selectedCost = 2.00;
    document.getElementById('customVoteAmount').value = '';

    const buttons = document.querySelectorAll('.vote-amount-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    if (buttons[0]) buttons[0].classList.add('active');
    updateUI();
}

// ========================================
// SHARING FUNCTIONS
// ========================================
function shareOnTwitter() {
    const text = `I just voted for ${window.currentParticipant.name} in the One Dream Initiative! 🌟`;
    const url = window.location.href;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
}

function shareOnFacebook() {
    const url = window.location.href;
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
}

function copyVoteLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
        alert('Vote link copied to clipboard! 📋');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = window.location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Vote link copied to clipboard! 📋');
    });
}

// Make functions globally accessible
window.showSuccessModal = showSuccessModal;
window.closeSuccessModal = closeSuccessModal;
window.shareOnTwitter = shareOnTwitter;
window.shareOnFacebook = shareOnFacebook;
window.copyVoteLink = copyVoteLink;

console.log('✅ Vote.js Loaded');
