console.log('📦 Crypto Payments Module Loading (WalletConnect v2 Multi-Platform)...');

// --- REPLACE ensureBufferPolyfill with ensureNodePolyfills (loads buffer + process and sets globals)
async function ensureNodePolyfills() {
    if (typeof window === 'undefined') return;
    if (window._nodePolyfillsLoading) return window._nodePolyfillsLoading;

    // helper to load script and try local->cdn
    const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.crossOrigin = 'anonymous';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });

    const tryLocalThenCdn = async (localPath, cdnUrl) => {
        try {
            await loadScript(localPath);
            return 'local';
        } catch (e) {
            await loadScript(cdnUrl);
            return 'cdn';
        }
    };

    window._nodePolyfillsLoading = (async () => {
        // Buffer polyfill: prefer local
        if (typeof window.Buffer === 'undefined') {
            try {
                await tryLocalThenCdn('/polyfills/buffer.min.js', 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js');
                if (!window.Buffer && window.buffer && window.buffer.Buffer) window.Buffer = window.buffer.Buffer;
            } catch (e) {
                throw new Error('Failed to load buffer polyfill: ' + e.message);
            }
        }

        // process polyfill: prefer local
        if (typeof window.process === 'undefined') {
            try {
                await tryLocalThenCdn('/polyfills/process.browser.js', 'https://cdn.jsdelivr.net/npm/process@0.11.10/browser.js');
                if (!window.process && typeof process !== 'undefined') window.process = process;
            } catch (e) {
                throw new Error('Failed to load process polyfill: ' + e.message);
            }
        }

        if (typeof window.global === 'undefined') window.global = window;
        return true;
    })();

    return window._nodePolyfillsLoading;
}

// --- NEW: ensure browser (UMD) builds of ethers and TronWeb are available
async function ensureBrowserLibraries() {
    // ensure Buffer first
    try { await ensureNodePolyfills(); } catch (e) { /* non-fatal */ }

    // load ethers v5 UMD if missing
    if (!window.ethers && !window._ethersLoading) {
        window._ethersLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load ethers UMD'));
            document.head.appendChild(s);
        });
    }
    // load TronWeb browser build if missing
    if (!window.TronWeb && !window._tronwebLoading) {
        window._tronwebLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tronweb/dist/TronWeb.js';
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('Failed to load TronWeb UMD'));
            document.head.appendChild(s);
        });
    }

    // wait for required loads (ignore failures individually)
    try { if (window._ethersLoading) await window._ethersLoading; } catch (e) { console.warn(e); }
    try { if (window._tronwebLoading) await window._tronwebLoading; } catch (e) { console.warn(e); }
}

/* ======================================================
    🔒 SECURE CRYPTO PAYMENT INITIALIZATION
====================================================== */
// Helper to wait until the library is actually available on window
async function loadWalletConnect() {
    // Ensure Node polyfills before loading walletconnect or other libs that expect Node globals
    try {
        await ensureNodePolyfills();
    } catch (e) {
        console.warn('Node polyfills failed to load:', e);
        // Fail fast so callers know WalletConnect cannot initialize safely
        throw new Error('Required Node polyfills (Buffer/process) are missing or blocked.');
    }

    // If already available, return it
    if (window.EthereumProvider) return window.EthereumProvider;

    // Reuse existing loading promise if present
    if (window._walletConnectLoading) return window._walletConnectLoading;

    window._walletConnectLoading = new Promise((resolve, reject) => {
        // Prevent double-appending the same script tag
        if (document.querySelector('script[data-wc-loader="true"]')) {
            // Wait a short moment for globals to appear
            setTimeout(() => {
                const provider = detectWalletConnectGlobal();
                if (provider) return resolve(provider);
                return reject(new Error('WalletConnect script already present but provider not found'));
            }, 50);
            return;
        }

        const script = document.createElement('script');
        script.setAttribute('data-wc-loader', 'true');
        script.src = "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
        script.onload = () => {
            console.log("✅ WalletConnect SDK loaded via CDN");
            // allow UMD to register globals
            setTimeout(() => {
                const provider = detectWalletConnectGlobal();
                if (provider) return resolve(provider);
                return reject(new Error('WalletConnect loaded but provider global not found'));
            }, 50);
        };
        script.onerror = () => reject(new Error("Failed to load WalletConnect SDK"));
        document.head.appendChild(script);
    });

    return window._walletConnectLoading;
}

function detectWalletConnectGlobal() {
    // Try many possible global names and default properties used by various builds
    const candidates = [
        'EthereumProvider',
        'WalletConnectProvider',
        'WalletConnect',
        'walletconnect',
        'walletConnect',
        'WalletConnectEthereumProvider',
        'WalletConnectModal',
        'w3m', // wallet3 modal namespace (some builds)
    ];

    for (const k of candidates) {
        const val = window[k];
        if (val) return val;
        // Some UMDs attach default export under `.default`
        if (val && val.default) return val.default;
    }
    // Last attempt: check nested namespaces
    if (window.Wallet && window.Wallet.connect) return window.Wallet;
    return null;
}

async function initializeCryptoPayment(participantId, voteCount, network) {
    const res = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: participantId,
            vote_count: voteCount,
            network: network
        })
    });
    if (!res.ok) throw new Error('Failed to initialize payment backend');
    return res.json();
}

/* ======================================================
    🆕 MAIN ENTRY POINT
====================================================== */
async function processCryptoPayment() {
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount;

    if (!participantId || !voteCount) {
        alert('Missing participant info or vote amount.');
        return { success: false, error: 'Missing metadata' };
    }

    const network = await showNetworkSelectionModal();
    if (!network) return { success: false, error: 'Cancelled' };

    try {
        const paymentInit = await initializeCryptoPayment(participantId, voteCount, network);
        
        if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
        if (network === 'tron') return await processUSDTPaymentTron(paymentInit);
    } catch (err) {
        console.error('Payment Flow Error:', err);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 BSC USDT (BEP-20) - SMART ROUTING
====================================================== */
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    
    // 1. If inside a mobile wallet browser (MetaMask/Trust Browser)
    if (window.ethereum && isMobile) {
        return await processBSCWithInjectedWallet(paymentInit);
    }

    // 2. Otherwise (Desktop OR Mobile Chrome/Safari), use WalletConnect
    return await processBSCWithWalletConnect(paymentInit);
}

async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    
    try {
        // Ensure browser ethers is available (avoids require() or Node builds)
        try { await ensureBrowserLibraries(); } catch (e) { console.warn('Browser libs load failed', e); }

        if (typeof window.loadWalletConnect === 'function') {
            await window.loadWalletConnect();
        }

        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5',
            chains: [56], 
            showQrModal: true,
            methods: ["eth_sendTransaction", "personal_sign"],
            qrModalOptions: { themeMode: 'dark' }
        });

        updateModalStatus(modal, '📱 Connect your wallet...', 'waiting');
        await provider.connect();

        // ethers should now be present as window.ethers (UMD v5)
        const ethersLib = window.ethers;
        const ethersProvider = new ethersLib.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        updateModalStatus(modal, '💸 Confirming USDT Transfer...', 'loading');

        const usdtContract = new ethersLib.Contract(
            '0x55d398326f99059fF775485246999027B3197955',
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(
            paymentInit.recipient_address,
            ethersLib.utils.parseUnits(paymentInit.amount.toString(), 18)
        );

        updateModalStatus(modal, '⛓️ Verifying on Blockchain...', 'pending');
        await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Successful!', 'success');
        setTimeout(() => modal.remove(), 2500);
        return { success: true, txHash: tx.hash, network: 'bsc' };

    } catch (err) {
        updateModalStatus(modal, `❌ ${err.message}`, 'error');
        setTimeout(() => modal.remove(), 4000);
        return { success: false, error: err.message };
    }
}

/* ======================================================
    🔒 TRON USDT (TRC-20)
====================================================== */
async function processUSDTPaymentTron(paymentInit) {
    // 1. Injected (TronLink Extension/Mobile App Browser)
    if (window.tronWeb && window.tronWeb.ready) {
        const modal = showEnhancedPaymentModal('TRON', paymentInit.amount);
        try {
            const contract = await window.tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
            const amount = Math.floor(paymentInit.amount * 1e6);
            const tx = await contract.transfer(paymentInit.recipient_address, amount).send();
            modal.remove();
            return { success: true, txHash: tx, network: 'tron' };
        } catch (err) {
            updateModalStatus(modal, `❌ ${err}`, 'error');
            return { success: false, error: err };
        }
    }

    // 2. Mobile Deep Link / QR for standard browsers
    return await processTronWithQRCode(paymentInit);
}

async function processTronWithQRCode(paymentInit) {
    const amountSun = Math.floor(paymentInit.amount * 1e6);
    const deepLink = `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${amountSun}&receiver=${paymentInit.recipient_address}`;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
            <h3 class="text-xl font-bold mb-4">🔴 TRON (TRC-20)</h3>
            <div id="tronQR" class="mb-4 bg-gray-100 p-2 rounded-lg"></div>
            <a href="${deepLink}" class="block w-full bg-red-600 text-white py-3 rounded-xl font-bold mb-2">Open Tron Wallet</a>
            <button id="closeTron" class="text-gray-400 text-sm">Cancel</button>
        </div>`;
    document.body.appendChild(modal);

    generateQR(paymentInit.recipient_address, 'tronQR');
    
    return new Promise(resolve => {
        modal.querySelector('#closeTron').onclick = () => { modal.remove(); resolve({success: false}); };
    });
}

/* ======================================================
    🔹 UI HELPERS
===================================================== */
function showEnhancedPaymentModal(network, amount) {
    const m = document.createElement('div');
    m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-6';
    m.innerHTML = `
        <div class="bg-white p-8 rounded-2xl text-center max-w-sm w-full shadow-2xl">
            <h3 class="text-xl font-bold text-gray-800 mb-2">${network} Payment</h3>
            <p class="text-blue-600 text-2xl font-bold mb-6">${amount} USDT</p>
            <div id="modalStatus" class="text-gray-500 mb-4">Connecting...</div>
            <div class="loading-spinner mx-auto"></div>
        </div>`;
    document.body.appendChild(m);
    return m;
}

function updateModalStatus(modal, text, status) {
    if (!modal) return;
    const s = modal.querySelector('#modalStatus');
    s.textContent = text;
    if (status === 'success' || status === 'error') modal.querySelector('.loading-spinner').style.display = 'none';
}

async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-xs w-full shadow-2xl">
                <h3 class="text-lg font-bold mb-4 text-center">Choose USDT Network</h3>
                <button id="selBsc" class="w-full bg-yellow-400 py-4 rounded-xl mb-3 font-bold">🟡 BSC (BEP-20)</button>
                <button id="selTron" class="w-full bg-red-600 text-white py-4 rounded-xl font-bold">🔴 TRON (TRC-20)</button>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelector('#selBsc').onclick = () => { modal.remove(); resolve('bsc'); };
        modal.querySelector('#selTron').onclick = () => { modal.remove(); resolve('tron'); };
    });
}

function generateQR(text, id) {
    const url = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(text)}`;
    document.getElementById(id).innerHTML = `<img src="${url}" class="mx-auto" />`;
}
// At the bottom of crypto-payments.js
async function processBSCWithInjectedWallet() {
    try {
        if (!window.ethereum) throw new Error("MetaMask or Injected Wallet not found.");
        
        // Ensure ethers UMD available before using it
        try { await ensureBrowserLibraries(); } catch (e) { console.warn('Failed to load browser libs', e); }

        const ethersLib = window.ethers || ethers; // prefer UMD, fallback if already global
        const provider = new ethersLib.providers.Web3Provider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = provider.getSigner();

        console.log("Wallet connected:", await signer.getAddress());
        
        return { success: true, txHash: "0x..." };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// CRITICAL: This line makes it visible to vote.js
window.processBSCWithInjectedWallet = processBSCWithInjectedWallet;

// EXPORTS (crypto-only)
window.processCryptoPayment = processCryptoPayment;
window.processPaystackPayment = window.processPaystackPayment; // intentionally left undefined here; provided by paystack-payments.js
window.loadWalletConnect = loadWalletConnect;
