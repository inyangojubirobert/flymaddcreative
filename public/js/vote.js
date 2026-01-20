console.log('📦 Vote.js Loading...');

// ========================================
// PAGE INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async function () {
  console.log('🎬 Vote page initializing...');

  // Ensure Supabase is initialized
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

  const initials = p.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  document.getElementById('participantInitials').textContent = initials;

  const goal = 1_000_000;
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
    window.selectedCost = 2.0;
  }

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
    if (amount < 1 || amount > 1000) {
      this.classList.add('error-input');
      return;
    }

    this.classList.remove('error-input');
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
// HANDLE VOTE / PAYMENT
// ========================================
async function handleVote() {
  if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
    alert('Please select a valid vote amount');
    return;
  }

  const voteButton = document.getElementById('voteButton');
  const spinner = document.getElementById('voteButtonSpinner');
  const buttonText = document.getElementById('voteButtonText');

  voteButton.disabled = true;
  spinner.classList.remove('hidden');
  buttonText.textContent = 'Processing Payment...';

  try {
    let paymentResult;

    if (window.selectedPaymentMethod === 'crypto') {
      if (typeof window.processCryptoPayment !== 'function') {
        throw new Error('Crypto payment module not loaded');
      }

      paymentResult = await window.processCryptoPayment();
    } else {
      throw new Error('Selected payment method not available yet');
    }

    if (!paymentResult?.success) {
      throw new Error(paymentResult?.error || 'Payment failed');
    }

async function handleVote() {
  if (!window.currentParticipant || window.selectedVoteAmount <= 0) {
    alert('Please select a valid vote amount');
    return;
  }

  const voteButton = document.getElementById('voteButton');
  const spinner = document.getElementById('voteButtonSpinner');
  const buttonText = document.getElementById('voteButtonText');

  // 1. UI State: Loading
  voteButton.disabled = true;
  spinner.classList.remove('hidden');
  buttonText.textContent = 'Preparing Secure Payment...';

  try {
    let paymentResult;

    if (window.selectedPaymentMethod === 'crypto') {
      if (typeof window.processCryptoPayment !== 'function') {
        throw new Error('Crypto payment module not loaded. Please refresh.');
      }
      // This triggers the process in crypto-payments.js (and its internal WC v2 loader)
      paymentResult = await window.processCryptoPayment();
    } else {
      throw new Error('Selected payment method not available yet');
    }

    // 2. Validate Payment Result
    if (!paymentResult?.success) {
      // If user closed the modal, we don't necessarily want a big red alert
      if (paymentResult?.error === 'User rejected request') return; 
      throw new Error(paymentResult?.error || 'Payment failed');
    }

    // 3. UI State: Recording
    buttonText.textContent = 'Finalizing Votes...';
    await recordVotesAfterPayment(paymentResult);
    
    // 4. UI State: Success
    showSuccessModal(); 
  } catch (error) {
    console.error('Vote processing failed:', error);
    alert(`Error: ${error.message}`);
  } finally {
    // Reset button regardless of outcome
    voteButton.disabled = false;
    spinner.classList.add('hidden');
    updateUI();
  }
}
  } catch (error) {
    console.error('Vote processing failed:', error);
    alert(`Payment failed: ${error.message}`);
  } finally {
    voteButton.disabled = false;
    spinner.classList.add('hidden');
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
        ip: null,
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

  if (data.milestones_achieved?.length) {
    showMilestoneAchievements(data.milestones_achieved);
  }

  console.log('✅ Votes recorded');
}

// ========================================
// SUCCESS + SHARING
// ========================================
function showSuccessModal() {
  document.getElementById('successParticipantName').textContent = window.currentParticipant.name;
  document.getElementById('successVoteCount').textContent = window.selectedVoteAmount;
  document.getElementById('successModal').classList.remove('hidden');
}

function closeSuccessModal() {
  document.getElementById('successModal').classList.add('hidden');
  window.selectedVoteAmount = 1;
  window.selectedCost = 2.0;
  document.getElementById('customVoteAmount').value = '';
  updateUI();
}

function shareOnTwitter() {
  const text = `I just voted for ${window.currentParticipant.name} in the One Dream Initiative 🌟`;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`,
    '_blank'
  );
}

function shareOnFacebook() {
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(location.href)}`,
    '_blank'
  );
}

function copyVoteLink() {
  navigator.clipboard.writeText(location.href).then(() => alert('Vote link copied 📋'));
}

// ========================================
// GLOBAL EXPORTS
// ========================================
window.showSuccessModal = showSuccessModal;
window.closeSuccessModal = closeSuccessModal;
window.shareOnTwitter = shareOnTwitter;
window.shareOnFacebook = shareOnFacebook;
window.copyVoteLink = copyVoteLink;

console.log('✅ Vote.js Loaded (WalletConnect v2 safe)');
