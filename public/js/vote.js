import { initSupabaseFromMeta, fetchParticipantByUsername, fetchParticipantByUserCode } from './supabase-config.js';

let currentParticipant = null;
let selectedVoteAmount = 1;
let selectedCost = 2.00;
let selectedPaymentMethod = 'stripe';

document.addEventListener('DOMContentLoaded', async function() {
    if (!initSupabaseFromMeta()) {
        showError('Supabase client not initialized. Check your configuration.');
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const username = urlParams.get('user') || urlParams.get('username');
    const userCode = urlParams.get('code') || urlParams.get('user_code');

    if (!username && !userCode) {
        showError('No participant specified in URL. Please provide either username or user code.');
        return;
    }

    try {
        if (userCode) {
            currentParticipant = await fetchParticipantByUserCode(userCode);
        } else {
            currentParticipant = await fetchParticipantByUsername(username);
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
            case 'stripe':
                paymentResult = await processStripePayment(paymentData);
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
            await recordVotesAfterPayment(paymentResult.payment_intent_id);
        } else {
            throw new Error(paymentResult.error || 'Payment was not completed');
        }

    } catch (error) {
        console.error('Payment processing error:', error);
        throw error;
    }
}

async function processStripePayment(paymentData) {
    // Initialize Stripe
    // Make sure you have set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your environment
    const publishableKey = window.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 
        (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : null) ||
        'pk_test_...'; // fallback for dev

    if (!publishableKey || publishableKey === 'pk_test_...') {
        alert('Stripe publishable key is not set. Please set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.');
        return { success: false, error: 'Stripe key missing' };
    }

    const stripe = Stripe(publishableKey);

    // Confirm payment
    try {
        const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
            clientSecret: paymentData.client_secret,
            confirmParams: {
                return_url: window.location.href,
            },
            redirect: 'if_required'
        });

        if (stripeError) {
            return { success: false, error: `Stripe payment failed: ${stripeError.message}` };
        }

        if (paymentIntent && paymentIntent.status === 'succeeded') {
            return { success: true, payment_intent_id: paymentData.payment_intent_id };
        } else {
            return { success: false, error: 'Payment was not completed' };
        }
    } catch (err) {
        console.error('Stripe JS error:', err);
        return { success: false, error: 'Stripe JS error: ' + err.message };
    }
}

async function processPaystackPayment(paymentData) {
    // Redirect to PayStack checkout
    if (paymentData.authorization_url) {
        // Open PayStack in new window
        const paymentWindow = window.open(
            paymentData.authorization_url, 
            'PayStack Payment', 
            'width=600,height=700,scrollbars=yes,resizable=yes'
        );

        // Wait for payment completion (you'd implement proper verification)
        return new Promise((resolve) => {
            const checkClosed = setInterval(() => {
                if (paymentWindow.closed) {
                    clearInterval(checkClosed);
                    // In production, verify payment status with PayStack webhook
                    resolve({ success: true, payment_intent_id: paymentData.payment_intent_id });
                }
            }, 1000);
        });
    } else {
        return { success: false, error: 'PayStack payment initialization failed' };
    }
}

async function processCryptoPayment(paymentData) {
    // Show crypto payment modal
    const confirmed = showCryptoPaymentModal(paymentData);
    
    if (confirmed) {
        return { success: true, payment_intent_id: paymentData.payment_intent_id };
    } else {
        return { success: false, error: 'Crypto payment was cancelled' };
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