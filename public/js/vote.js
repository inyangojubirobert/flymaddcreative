// vote.js
document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const loadingState = document.getElementById("loadingState");
  const errorState = document.getElementById("errorState");
  const participantCard = document.getElementById("participantCard");

  const participantName = document.getElementById("participantName");
  const participantUsername = document.getElementById("participantUsername");
  const participantEmail = document.getElementById("participantEmail");
  const participantInitials = document.getElementById("participantInitials");
  const currentVotes = document.getElementById("currentVotes");
  const participantRank = document.getElementById("participantRank");
  const progressBar = document.getElementById("progressBar");
  const progressPercentage = document.getElementById("progressPercentage");

  const voteButtons = document.querySelectorAll(".vote-amount-btn");
  const customVoteInput = document.getElementById("customVoteAmount");
  const totalCostEl = document.getElementById("totalCost");

  const paymentButtons = document.querySelectorAll(".payment-method-btn");
  const voteButton = document.getElementById("voteButton");
  const voteButtonText = document.getElementById("voteButtonText");
  const voteButtonSpinner = document.getElementById("voteButtonSpinner");

  const successModal = document.getElementById("successModal");
  const successParticipantName = document.getElementById("successParticipantName");
  const successVoteCount = document.getElementById("successVoteCount");

  let selectedVotes = 1;
  let selectedCost = 2;
  let selectedPaymentMethod = "flutterwave";
  let participantData = null;

  const VOTE_COST = 2; // $2 per vote

  // Fetch participant data
  async function fetchParticipant() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const participantId = urlParams.get("id");
      if (!participantId) throw new Error("Participant ID missing");

      const res = await fetch(`/api/onedream/participant/${participantId}`);
      if (!res.ok) throw new Error("Failed to fetch participant data");

      participantData = await res.json();
      populateParticipant(participantData);
    } catch (err) {
      console.error(err);
      loadingState.classList.add("hidden");
      errorState.classList.remove("hidden");
      document.getElementById("errorMessage").textContent = err.message;
    }
  }

  function populateParticipant(data) {
    loadingState.classList.add("hidden");
    participantCard.classList.remove("hidden");

    participantName.textContent = data.full_name;
    participantUsername.textContent = data.username;
    participantEmail.textContent = data.email || "N/A";

    const initials = data.full_name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase();
    participantInitials.textContent = initials;

    currentVotes.textContent = data.votes || 0;
    participantRank.textContent = "#" + (data.rank || 1);

    const progress = Math.min(((data.votes || 0) / 1000000) * 100, 100);
    progressBar.style.width = progress + "%";
    progressPercentage.textContent = progress.toFixed(1) + "%";
  }

  // Vote amount selection
  voteButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      voteButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      selectedVotes = parseInt(btn.dataset.amount, 10);
      selectedCost = parseFloat(btn.dataset.cost);

      customVoteInput.value = "";
      updateVoteUI();
    });
  });

  customVoteInput.addEventListener("input", () => {
    const val = parseInt(customVoteInput.value, 10);
    if (!isNaN(val) && val > 0) {
      selectedVotes = val;
      selectedCost = val * VOTE_COST;
      voteButtons.forEach(b => b.classList.remove("active"));
      updateVoteUI();
    }
  });

  function updateVoteUI() {
    totalCostEl.textContent = selectedCost.toFixed(2);
    voteButtonText.textContent = `Purchase Votes - $${selectedCost.toFixed(2)}`;
  }

  // Payment method selection
  paymentButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      paymentButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPaymentMethod = btn.dataset.method;
    });
  });

  // Vote button click
  voteButton.addEventListener("click", async () => {
    if (!window.configLoaded) {
      alert("Payment configuration not loaded yet.");
      return;
    }

    voteButton.disabled = true;
    voteButtonSpinner.classList.remove("hidden");

    try {
      if (selectedPaymentMethod === "flutterwave") await payWithFlutterwave();
      else if (selectedPaymentMethod === "paystack") await payWithPaystack();
      else if (selectedPaymentMethod === "crypto") await payWithCrypto();

      // Update participant votes in Supabase
      await updateVotes(participantData.id, selectedVotes);

      // Refresh participant UI
      participantData.votes += selectedVotes;
      populateParticipant(participantData);

      // Show success modal
      successParticipantName.textContent = participantData.full_name;
      successVoteCount.textContent = selectedVotes;
      successModal.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      alert("Payment failed: " + err.message);
    } finally {
      voteButton.disabled = false;
      voteButtonSpinner.classList.add("hidden");
    }
  });

  // Close success modal
  window.closeSuccessModal = () => {
    successModal.classList.add("hidden");
  };

  // -------------------
  // Payment Integrations
  // -------------------
  async function payWithFlutterwave() {
    await window.loadPaymentScripts();
    return new Promise((resolve, reject) => {
      const txRef = `FD-${Date.now()}`;
      const payment = FlutterwaveCheckout({
        public_key: window.FLUTTERWAVE_PUBLIC_KEY,
        tx_ref: txRef,
        amount: selectedCost,
        currency: "USD",
        payment_options: "card",
        customer: {
          email: participantData.email || "user@example.com",
          name: participantData.full_name
        },
        callback: function(response) {
          if (response.status === "successful") resolve(response);
          else reject(new Error("Flutterwave payment failed"));
        },
        onclose: function() {
          reject(new Error("Flutterwave payment closed"));
        }
      });
    });
  }

  async function payWithPaystack() {
    await window.loadPaymentScripts();
    return new Promise((resolve, reject) => {
      const handler = window.PaystackPop.setup({
        key: window.PAYSTACK_PUBLIC_KEY,
        email: participantData.email || "user@example.com",
        amount: selectedCost * 100, // NGN minor unit
        currency: "NGN",
        callback: function(response) {
          if (response.status === "success") resolve(response);
          else reject(new Error("Paystack payment failed"));
        },
        onClose: function() {
          reject(new Error("Paystack payment closed"));
        }
      });
      handler.openIframe();
    });
  }

  async function payWithCrypto() {
    await window.loadCryptoScripts();
    if (!window.ethereum) throw new Error("Crypto wallet not found");

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const tx = await signer.sendTransaction({
      to: "0xYourBackendWalletAddress", // replace with backend-generated wallet address
      value: ethers.parseEther((selectedCost / 1).toString()) // example: $1 = 1 ETH
    });
    await tx.wait();
  }

  // Update votes in backend (Supabase)
  async function updateVotes(participantId, votes) {
    const res = await fetch(`/api/onedream/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, votes })
    });
    if (!res.ok) throw new Error("Failed to update votes");
  }

  // Initialize
  fetchParticipant();
  updateVoteUI();
});
