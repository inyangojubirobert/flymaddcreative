console.log('📦 Crypto Payments Module Loading (WC v2)...');

/* ======================================================
   🔒 BACKEND PAYMENT INITIALIZATION
====================================================== */
async function initializeCryptoPayment(participantId, voteCount, network) {
  const res = await fetch('/api/onedream/init-crypto-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participant_id: participantId,
      vote_count: voteCount,
      network
    })
  });

  if (!res.ok) throw new Error('Failed to initialize payment');
  return res.json();
}

/* ======================================================
   🌐 NETWORK SELECTION (Mobile-first + Remembered)
====================================================== */
async function showNetworkSelectionModal() {
  const saved = localStorage.getItem('preferred_network');
  if (saved) {
    console.log('🔁 Using saved network:', saved);
    return saved;
  }

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className =
      'fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center';

    modal.innerHTML = `
      <div class="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-xl animate-slide-up">
        <h3 class="text-xl font-bold text-center mb-4">Select Payment Network</h3>

        <button id="bscBtn"
          class="w-full bg-yellow-400 hover:bg-yellow-500 text-black py-3 rounded-xl mb-3 text-lg font-semibold">
          Binance Smart Chain (USDT)
        </button>

        <button id="tronBtn"
          class="w-full bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl mb-4 text-lg font-semibold">
          TRON (USDT)
        </button>

        <button id="cancelBtn"
          class="w-full text-gray-500 py-2">Cancel</button>
      </div>
    `;

    document.body.appendChild(modal);

    const select = (network) => {
      modal.remove();
      localStorage.setItem('preferred_network', network);
      resolve(network);
    };

    modal.querySelector('#bscBtn').onclick = () => select('bsc');
    modal.querySelector('#tronBtn').onclick = () => select('tron');
    modal.querySelector('#cancelBtn').onclick = () => {
      modal.remove();
      console.log('⚠️ Cancelled → defaulting to BSC');
      resolve('bsc');
    };
  });
}

/* ======================================================
   🆕 MAIN ENTRY
====================================================== */
async function processCryptoPayment() {
  const participantId = window.currentParticipant?.id;
  const voteCount = window.selectedVoteAmount;

  if (!participantId || !voteCount) {
    return { success: false, error: 'Missing participant or vote count' };
  }

  const network = await showNetworkSelectionModal();
  const paymentInit = await initializeCryptoPayment(participantId, voteCount, network);

  if (network === 'bsc') return processUSDTPaymentBSC(paymentInit);
  if (network === 'tron') return processUSDTPaymentTron(paymentInit);

  return { success: false, error: 'Unsupported network' };
}

/* ======================================================
   🔒 BSC (USDT) — WalletConnect v2 + MetaMask
====================================================== */
async function processUSDTPaymentBSC(paymentInit) {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

  if (window.ethereum && isMobile) {
    return processBSCWithInjectedWallet(paymentInit);
  }

  return processBSCWithWalletConnect(paymentInit);
}

/* ---------------- WalletConnect v2 ---------------- */
/* ---------------- WalletConnect v2 (FIXED) ---------------- */
async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);

    try {
        // FIX: Ensure the loader is triggered and awaited
        if (typeof window.loadWalletConnect === 'function') {
            console.log('⏳ Loading WalletConnect SDK...');
            await window.loadWalletConnect(); 
        }

        // Check again after awaiting the loader
        if (!window.EthereumProvider) {
            throw new Error('WalletConnect SDK could not be retrieved from the CDN.');
        }

        // Initialize the provider
        const wcProvider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID,
            chains: [56], // BSC Mainnet
            showQrModal: true,
            // ... rest of your config
        });
        
        // ... rest of your payment logic
    } catch (err) {
        console.error('WC v2 BSC error:', err);
        updateModalStatus(modal, `❌ ${err.message}`, 'error');
        // ...
    }
}
/* ---------------- MetaMask / Injected ---------------- */
async function processBSCWithInjectedWallet(paymentInit) {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send('eth_requestAccounts', []);

  const network = await provider.getNetwork();
  if (network.chainId !== 56) {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x38' }]
    });
  }

  const signer = provider.getSigner();

  const usdt = new ethers.Contract(
    '0x55d398326f99059fF775485246999027B3197955',
    ['function transfer(address to, uint256 amount) returns (bool)'],
    signer
  );

  const tx = await usdt.transfer(
    paymentInit.recipient_address,
    ethers.utils.parseUnits(paymentInit.amount.toString(), 18)
  );

  await tx.wait(1);

  return {
    success: true,
    txHash: tx.hash,
    payment_intent_id: tx.hash,
    network: 'bsc',
    explorer: `https://bscscan.com/tx/${tx.hash}`
  };
}

/* ======================================================
   🔒 TRON (UNCHANGED — STABLE)
====================================================== */
async function processUSDTPaymentTron(paymentInit) {
  if (window.tronWeb?.ready) return processTronWithTronLink(paymentInit);
  return processTronWithQRCode(paymentInit);
}

async function processTronWithTronLink(paymentInit) {
  const usdt = 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL';
  const amount = Math.floor(paymentInit.amount * 1e6);

  const tx = await tronWeb.contract().at(usdt)
    .then(c => c.transfer(paymentInit.recipient_address, amount).send());

  return {
    success: true,
    txHash: tx,
    payment_intent_id: tx,
    network: 'tron',
    explorer: `https://tronscan.org/#/transaction/${tx}`
  };
}

/* ======================================================
   🔹 UI HELPERS
====================================================== */
function showEnhancedPaymentModal(network, amount) {
  const m = document.createElement('div');
  m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
  m.innerHTML = `
    <div class="glassmorphism p-8 rounded-xl text-center max-w-md w-full">
      <h3 class="text-2xl font-bold mb-2">${network} Payment</h3>
      <p class="mb-4">${amount} USDT</p>
      <div id="modalStatus">Connecting...</div>
      <div class="loading-spinner mt-4"></div>
    </div>`;
  document.body.appendChild(m);
  return m;
}

function updateModalStatus(modal, text, status) {
  if (!modal) return;
  modal.querySelector('#modalStatus').textContent = text;
  const spinner = modal.querySelector('.loading-spinner');
  if (spinner) spinner.style.display =
    (status === 'success' || status === 'error') ? 'none' : 'block';
}

/* ======================================================
   🔹 EXPORTS
====================================================== */
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;
window.processUSDTPaymentBSC = processUSDTPaymentBSC;
window.processUSDTPaymentTron = processUSDTPaymentTron;
window.showNetworkSelectionModal = showNetworkSelectionModal;

console.log('✅ Crypto Payments Module Loaded (WalletConnect v2 SAFE)');
