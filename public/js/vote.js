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
            await recordVotesAfterPayment(paymentResult.payment_intent_id);
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