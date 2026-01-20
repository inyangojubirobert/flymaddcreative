/* Crypto Payments Module — integrated fixes to avoid provider multiplex errors
   - Waits for injected providers to be ready before calling them (avoids inpage.js "malformed chunk without name 'ACK'")
   - Picks correct injected provider when multiple are present (window.ethereum.providers)
   - Uses provider.request / ethereum.request and safe fallbacks only (no raw postMessage)
   - Guards for ethers, WalletConnect, tronWeb presence
   - Unit consistency for QR / deep links (TRON = sun, BSC = wei)
   - Safer cleanup (disconnect guards, delete window.confirmTronPayment)
   - Safer DOM updates (minimize innerHTML for dynamic data)
*/

console.log('📦 Crypto Payments Module Loading...');

// -----------------------------
// Helpers & Config
// -----------------------------
const DEFAULT_WAIT_MS = 5000;
const WAIT_INTERVAL = 50;
const BSC_CHAIN_ID_HEX = '0x38';
const BSC_CHAIN_ID_DEC = 56;
const BSC_USDT_ADDRESS = '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d';
const TRON_USDT_CONTRACT = 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL';

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

function safeText(node, text) {
  if (!node) return;
  node.textContent = text;
}

function isMobile() {
  return /Android|iPhone|iPad/i.test(navigator.userAgent);
}

// A robust provider.request wrapper that falls back to send/sendAsync if necessary.
async function providerRequest(provider, payload) {
  // payload: { method: 'eth_accounts', params: [] }
  if (!provider) throw new Error('No provider supplied to providerRequest');

  if (typeof provider.request === 'function') {
    return provider.request(payload);
  }

  // EIP-1193 fallback: some older providers implement send(method, params)
  if (typeof provider.send === 'function') {
    // ethers may expect different shapes; try compatibility
    try {
      return await provider.send(payload.method, payload.params || []);
    } catch (err) {
      // some providers use send(payload, callback)
      return new Promise((resolve, reject) => {
        try {
          provider.send(payload, (err2, res) => {
            if (err2) return reject(err2);
            resolve(res && res.result ? res.result : res);
          });
        } catch (e) {
          reject(e);
        }
      });
    }
  }

  // Some legacy providers implement sendAsync
  if (typeof provider.sendAsync === 'function') {
    return new Promise((resolve, reject) => {
      provider.sendAsync(payload, (err, res) => {
        if (err) return reject(err);
        resolve(res && res.result ? res.result : res);
      });
    });
  }

  throw new Error('Provider does not support request/send/sendAsync');
}

// -----------------------------
// Injected provider initialization
// -----------------------------
async function waitForInjectedEthereum({ waitMs = DEFAULT_WAIT_MS } = {}) {
  // Wait for page load
  if (document.readyState === 'loading') {
    await new Promise(res => window.addEventListener('load', res, { once: true }));
  }

  let waited = 0;
  while (waited < waitMs) {
    if (window.ethereum) return window.ethereum;
    await wait(WAIT_INTERVAL);
    waited += WAIT_INTERVAL;
  }

  // final chance
  return window.ethereum || null;
}

// Choose a single injected provider when multiple are present
function chooseInjectedProvider(injected) {
  if (!injected) return null;
  // If providers array exists, prefer MetaMask
  if (Array.isArray(injected.providers) && injected.providers.length) {
    const mm = injected.providers.find(p => p.isMetaMask);
    return mm || injected.providers[0];
  }
  return injected;
}

// Safe initialize for injected providers (MetaMask / TronLink-like)
async function initInjectedProviderSafe({ waitMs = DEFAULT_WAIT_MS } = {}) {
  const injected = await waitForInjectedEthereum({ waitMs });
  if (!injected) {
    console.warn('No injected ethereum provider found.');
    return null;
  }

  const provider = chooseInjectedProvider(injected);

  // Basic sanity: ensure request function exists or fallback will be used
  if (!provider) {
    console.warn('No suitable provider chosen.');
    return null;
  }

  return provider;
}

// -----------------------------
// Backend init
// -----------------------------
async function initializeCryptoPayment(participantId, voteCount, network) {
  try {
    const response = await fetch('/api/onedream/init-crypto-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        participant_id: participantId,
        vote_count: voteCount,
        network
      })
    });

    if (!response.ok) throw new Error('Failed to initialize payment');
    const json = await response.json();
    // validate minimal fields
    if (!json?.recipient_address || typeof json?.amount === 'undefined') {
      throw new Error('Invalid init response from server');
    }
    return json; // { payment_id, recipient_address, amount, network }
  } catch (error) {
    console.error('Payment initialization error:', error);
    throw error;
  }
}

// -----------------------------
// Main Entry
// -----------------------------
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

  // Validate paymentInit minimally
  if (!paymentInit?.recipient_address || typeof paymentInit?.amount === 'undefined') {
    alert('Invalid payment initialization response');
    return { success: false, error: 'Invalid backend response' };
  }

  // Step 3: Process network-specific payment
  if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
  if (network === 'tron') return await processUSDTPaymentTron(paymentInit);

  return { success: false, error: 'Unsupported network' };
}

// -----------------------------
// BSC Flows
// -----------------------------
async function processUSDTPaymentBSC(paymentInit) {
  const mobile = isMobile();
  const injected = await initInjectedProviderSafe();

  const hasMetaMask = !!injected;
  if (mobile && hasMetaMask) {
    return await processBSCWithMobileWallet(paymentInit, injected);
  } else {
    return await processBSCWithWalletConnect(paymentInit);
  }
}

// WalletConnect + QR (desktop wallets and mobile wallets via QR)
async function processBSCWithWalletConnect(paymentInit) {
  const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
  try {
    if (typeof window.loadWalletConnect === 'function') {
      updateModalStatus(modal, 'Loading WalletConnect...', 'loading');
      try {
        await window.loadWalletConnect();
      } catch (e) {
        console.error('window.loadWalletConnect failed:', e);
        updateModalStatus(modal, 'Failed to load WalletConnect. Please refresh.', 'error');
        throw new Error('WalletConnect loader failed');
      }
    }

    if (typeof window.EthereumProvider !== 'function' && typeof window.EthereumProvider !== 'object') {
      updateModalStatus(modal, 'WalletConnect provider factory not available', 'error');
      throw new Error('WalletConnect provider factory not available');
    }

    // Initialize WalletConnect provider
    updateModalStatus(modal, 'Initializing WalletConnect...', 'loading');
    const wcProvider = await window.EthereumProvider.init({
      projectId: window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5',
      chains: [BSC_CHAIN_ID_DEC],
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

    // connect will show a QR modal if necessary
    await wcProvider.connect();

    // Request accounts using safe wrapper
    const accounts = await providerRequest(wcProvider, { method: 'eth_accounts' });
    const walletAddress = Array.isArray(accounts) ? accounts[0] : accounts;
    updateModalStatus(modal, `✅ Connected: ${String(walletAddress).slice(0, 6)}...${String(walletAddress).slice(-4)}`, 'connected');

    // Ensure correct chain
    const chainIdHex = await providerRequest(wcProvider, { method: 'eth_chainId' });
    if (parseInt(chainIdHex, 16) !== BSC_CHAIN_ID_DEC) {
      updateModalStatus(modal, 'Switching to BSC network...', 'loading');
      try {
        await providerRequest(wcProvider, { method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN_ID_HEX }] });
      } catch (switchError) {
        // If chain missing, try add chain
        if (switchError && switchError.code === 4902) {
          await providerRequest(wcProvider, {
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BSC_CHAIN_ID_HEX,
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

    if (typeof ethers === 'undefined') {
      updateModalStatus(modal, 'Ethers.js is not loaded. Please refresh.', 'error');
      throw new Error('Ethers.js not loaded');
    }

    const ethersProvider = new ethers.providers.Web3Provider(wcProvider);
    const signer = ethersProvider.getSigner();

    // Ensure amount converted to token decimals (USDT on BSC = 18 here)
    const amountInWei = ethers.utils.parseUnits(String(paymentInit.amount), 18);
    const usdtContract = new ethers.Contract(BSC_USDT_ADDRESS, ['function transfer(address to, uint256 amount) returns (bool)'], signer);

    updateModalStatus(modal, `💸 Sending ${paymentInit.amount} USDT...`, 'loading');
    const tx = await usdtContract.transfer(paymentInit.recipient_address, amountInWei);

    updateModalStatus(modal, '⏳ Waiting for confirmation...', 'pending');
    const receipt = await tx.wait(1);

    updateModalStatus(modal, '✅ Payment Confirmed!', 'success');
    setTimeout(() => modal?.remove(), 2000);

    if (typeof wcProvider.disconnect === 'function') {
      try { await wcProvider.disconnect(); } catch (e) { /* ignore disconnect errors */ }
    }

    return {
      success: true,
      payment_intent_id: tx.hash,
      txHash: tx.hash,
      network: 'bsc',
      explorer: `https://bscscan.com/tx/${tx.hash}`,
      receipt
    };

  } catch (error) {
    console.error('BSC WalletConnect payment error:', error);
    updateModalStatus(modal, `❌ Error: ${error?.message || error}`, 'error');
    setTimeout(() => modal?.remove(), 3000);
    return { success: false, error: error?.message || 'BSC payment failed' };
  }
}

// BSC Mobile (injected wallet like MetaMask mobile)
async function processBSCWithMobileWallet(paymentInit, injectedProvider) {
  try {
    const provider = injectedProvider || await initInjectedProviderSafe();
    if (!provider) throw new Error('No injected wallet detected');

    // Use safe provider request to ask for accounts
    const accounts = await providerRequest(provider, { method: 'eth_requestAccounts' });
    const walletAddress = Array.isArray(accounts) ? accounts[0] : accounts;

    // Ensure ethers is available
    if (typeof ethers === 'undefined') throw new Error('Ethers.js not loaded');

    const ethersProvider = new ethers.providers.Web3Provider(provider);
    const network = await ethersProvider.getNetwork();
    if (Number(network.chainId) !== BSC_CHAIN_ID_DEC) {
      await providerRequest(provider, { method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_CHAIN_ID_HEX }] });
    }

    const signer = ethersProvider.getSigner();
    const usdtContract = new ethers.Contract(BSC_USDT_ADDRESS, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
    const amountInWei = ethers.utils.parseUnits(String(paymentInit.amount), 18);

    const tx = await usdtContract.transfer(paymentInit.recipient_address, amountInWei);
    const receipt = await tx.wait(1);

    return {
      success: true,
      payment_intent_id: tx.hash,
      txHash: tx.hash,
      network: 'bsc',
      explorer: `https://bscscan.com/tx/${tx.hash}`,
      receipt
    };
  } catch (error) {
    console.error('BSC mobile payment error:', error);
    return { success: false, error: error?.message || 'BSC payment failed' };
  }
}

// -----------------------------
// TRON Flows
// -----------------------------
async function processUSDTPaymentTron(paymentInit) {
  // If tronWeb is injected and ready, use it; else show QR + deeplink
  if (window.tronWeb && window.tronWeb.ready) {
    return await processTronWithTronLink(paymentInit);
  } else {
    return await processTronWithQRCode(paymentInit);
  }
}

async function processTronWithTronLink(paymentInit) {
  try {
    const tronWeb = window.tronWeb;
    if (!tronWeb) throw new Error('tronWeb not available');

    const amountSun = Math.floor(Number(paymentInit.amount) * 1e6); // TRC-20 uses 6 decimals
    const contract = await tronWeb.contract().at(TRON_USDT_CONTRACT);
    const txResult = await contract.transfer(paymentInit.recipient_address, amountSun).send();

    return {
      success: true,
      payment_intent_id: txResult,
      txHash: txResult,
      network: 'tron',
      explorer: `https://tronscan.org/#/transaction/${txResult}`
    };
  } catch (error) {
    console.error('TronLink payment error:', error);
    return { success: false, error: error?.message || 'TronLink payment failed' };
  }
}

async function processTronWithQRCode(paymentInit) {
  try {
    const recipientAddress = paymentInit.recipient_address;
    const amountUSD = Number(paymentInit.amount);
    const amountSun = Math.floor(amountUSD * 1e6);

    const tronDeepLink = `tronlinkoutside://send?token=${TRON_USDT_CONTRACT}&amount=${amountSun}&receiver=${recipientAddress}`;

    // Build modal safely (avoid injecting untrusted HTML)
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';

    const box = document.createElement('div');
    box.className = 'glassmorphism rounded-2xl p-6 max-w-md w-full';
    const title = document.createElement('h3'); title.className = 'text-xl font-bold mb-2'; title.textContent = '🔴 TRON USDT Payment';
    const pAmt = document.createElement('p'); pAmt.className = 'mb-4'; pAmt.textContent = `Amount: ${amountUSD} USDT (TRC-20)`;
    const qrContainer = document.createElement('div'); qrContainer.id = 'tronQRCode'; qrContainer.className = 'mb-4';
    const openBtn = document.createElement('button'); openBtn.className = 'w-full bg-red-600 py-3 rounded-lg text-white font-bold mb-2'; openBtn.textContent = 'Open in TronLink/Wallet';
    openBtn.addEventListener('click', () => window.open(tronDeepLink, '_blank'));
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'w-full bg-gray-600 py-2 rounded-lg text-white font-semibold'; cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => modal.remove());
    const note = document.createElement('p'); note.className = 'mt-2 text-xs text-white/70'; note.textContent = 'Scan QR or click to open wallet';

    box.appendChild(title);
    box.appendChild(pAmt);
    box.appendChild(qrContainer);
    box.appendChild(openBtn);
    box.appendChild(cancelBtn);
    box.appendChild(note);
    modal.appendChild(box);
    document.body.appendChild(modal);

    // Generate QR (use amountSun for TRON)
    setTimeout(() => generateEnhancedQRCode(recipientAddress, 'tronQRCode', 'tron', amountSun), 100);

    return await new Promise(resolve => {
      // Expose a global confirm function but ensure cleanup
      window.confirmTronPayment = async function(txHash) {
        try {
          modal.remove();
          if (txHash && txHash.length === 64) {
            resolve({ success: true, payment_intent_id: txHash, txHash, network: 'tron', explorer: `https://tronscan.org/#/transaction/${txHash}` });
          } else {
            resolve({ success: true, payment_intent_id: `manual_${Date.now()}`, txHash: null, network: 'tron', manual: true });
          }
        } finally {
          try { delete window.confirmTronPayment; } catch (e) { window.confirmTronPayment = undefined; }
        }
      };
    });
  } catch (error) {
    console.error('TRON QR error:', error);
    return { success: false, error: error?.message || 'TRON payment failed' };
  }
}

// -----------------------------
// UI / Modals / QR Helpers
// -----------------------------
function showEnhancedPaymentModal(network, amount) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';

  const box = document.createElement('div');
  box.className = 'glassmorphism rounded-2xl p-8 max-w-md w-full text-center';

  const h = document.createElement('h3'); h.className = 'text-2xl font-bold mb-2'; h.textContent = `${network} Payment`;
  const p = document.createElement('p'); p.className = 'mb-4 text-lg'; p.innerHTML = `Amount: <span class="font-bold">${String(amount)} USDT</span>`;
  const status = document.createElement('div'); status.id = 'modalStatus'; status.className = 'mb-4 text-white/80'; status.textContent = 'Connecting...';
  const spinner = document.createElement('div'); spinner.className = 'loading-spinner mx-auto mt-2';

  box.appendChild(h); box.appendChild(p); box.appendChild(status); box.appendChild(spinner);
  modal.appendChild(box);
  document.body.appendChild(modal);
  return modal;
}

function updateModalStatus(modal, message, status) {
  if (!modal) return;
  const statusDiv = modal.querySelector('#modalStatus');
  const spinner = modal.querySelector('.loading-spinner');

  if (statusDiv) statusDiv.textContent = message || '';

  if (spinner) {
    spinner.style.display = (status === 'success' || status === 'error') ? 'none' : 'block';
  }
}

// Network selection modal (safe DOM)
async function showNetworkSelectionModal() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';

    const box = document.createElement('div');
    box.className = 'glassmorphism rounded-2xl p-8 max-w-lg w-full';
    const title = document.createElement('h3'); title.className = 'text-2xl font-bold mb-4 text-center'; title.textContent = 'Select USDT Network';
    const desc = document.createElement('p'); desc.className = 'text-white/70 mb-6 text-center'; desc.textContent = 'Choose your preferred blockchain network';

    const btnBsc = document.createElement('button'); btnBsc.className = 'w-full mb-3 bg-yellow-500 hover:bg-yellow-600 py-4 rounded-lg font-bold text-lg transition-colors'; btnBsc.textContent = '🟡 BSC (BEP-20)';
    btnBsc.addEventListener('click', () => select('bsc'));

    const btnTron = document.createElement('button'); btnTron.className = 'w-full mb-3 bg-red-500 hover:bg-red-600 py-4 rounded-lg font-bold text-lg transition-colors'; btnTron.textContent = '🔴 TRON (TRC-20)';
    btnTron.addEventListener('click', () => select('tron'));

    const btnCancel = document.createElement('button'); btnCancel.className = 'w-full py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors'; btnCancel.textContent = 'Cancel';
    btnCancel.addEventListener('click', () => select(null));

    box.appendChild(title); box.appendChild(desc); box.appendChild(btnBsc); box.appendChild(btnTron); box.appendChild(btnCancel);
    modal.appendChild(box);
    document.body.appendChild(modal);

    function select(network) {
      try { modal.remove(); } catch (e) { /* ignore */ }
      resolve(network);
    }
  });
}

// QR code generator — TRON expects sun (integer), BSC/ethereum expects wei (we convert if ethers available)
function generateEnhancedQRCode(address, elementId, network = 'tron', amount = 0) {
  const element = document.getElementById(elementId);
  if (!element) return;

  let qrData;
  if (network === 'tron') {
    // amount is expected as sun (integer)
    qrData = `tron:${address}?amount=${amount}&token=USDT`;
  } else if (network === 'bsc' || network === 'ethereum') {
    if (typeof ethers !== 'undefined') {
      // amount is human-readable (e.g., 1.5), convert to wei
      try {
        const wei = ethers.utils.parseUnits(String(amount), 18).toString();
        // Some wallets accept EIP-681 with value query param
        qrData = `ethereum:${address}?value=${wei}`;
      } catch (e) {
        // fallback to raw amount
        qrData = `ethereum:${address}?value=${amount}`;
      }
    } else {
      qrData = `ethereum:${address}?value=${amount}`;
    }
  } else {
    qrData = address;
  }

  const qrUrl = `https://chart.googleapis.com/chart?chs=256x256&cht=qr&chl=${encodeURIComponent(qrData)}&choe=UTF-8`;
  // render image safely
  element.innerHTML = ''; // clear existing
  const img = document.createElement('img');
  img.src = qrUrl;
  img.className = 'mx-auto rounded-lg shadow-lg border-2 border-white/20';
  element.appendChild(img);
}

// -----------------------------
// Export / Window bindings
// -----------------------------
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;
window.showNetworkSelectionModal = showNetworkSelectionModal;

console.log('✅ Crypto Payments Module Loaded');