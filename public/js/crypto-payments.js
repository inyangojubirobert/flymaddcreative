// // ======================================================
// // 🏗️  INITIALIZATION & CONFIGURATION
// // ======================================================

// if (typeof window === 'undefined') {
//     throw new Error('This script is designed to run in a browser environment');
// }

// // ✅ Inject required CSS for loading spinner
// (function injectStyles() {
//     if (document.getElementById('crypto-payments-styles')) return;
//     const style = document.createElement('style');
//     style.id = 'crypto-payments-styles';
//     style.textContent = `
//         .loading-spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: crypto-spin 0.8s linear infinite; }
//         @keyframes crypto-spin { to { transform: rotate(360deg); } }
//         .crypto-modal-fade-in { animation: crypto-fade-in 0.2s ease-out; }
//         @keyframes crypto-fade-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
//     `;
//     document.head.appendChild(style);
// })();

// const scriptTag = document.currentScript || document.querySelector('script[src*="crypto-payments"]');

// const CONFIG = {
//     BSC: {
//         USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
//         RPC_URL: "https://bsc-dataseed.binance.org/",
//         CHAIN_ID: 56,
//         EXPLORER: "https://bscscan.com/tx/",
//         WALLET_ADDRESS: scriptTag?.dataset?.bscWallet || "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d"
//     },
//     TRON: {
//         USDT_ADDRESS: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
//         EXPLORER: "https://tronscan.org/#/transaction/",
//         WALLET_ADDRESS: scriptTag?.dataset?.tronWallet || "TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL"
//     },
//     WALLETCONNECT: {
//         SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js",
//         PROJECT_ID: scriptTag?.dataset?.wcProjectId || "61d9b98f81731dffa9988c0422676fc5"
//     },
//     ETHERS: {
//         SRC: "https://cdn.ethers.io/lib/ethers-5.7.2.umd.min.js"
//     },
//     PAYSTACK: {
//         PUBLIC_KEY: scriptTag?.dataset?.paystackKey || window.PAYSTACK_PUBLIC_KEY || "",
//         SRC: "https://js.paystack.co/v1/inline.js"
//     },
//     LIMITS: { MAX_RETRIES: 5, TIMEOUT_MS: 300000, ATTEMPT_TIMEOUT: 5 * 60 * 1000 }
// };

// const ERROR_CODES = {
//     INVALID_INPUT: 'INVALID_INPUT', RATE_LIMIT: 'RATE_LIMIT', NETWORK_ERROR: 'NETWORK_ERROR',
//     WALLET_ERROR: 'WALLET_ERROR', TRANSACTION_ERROR: 'TRANSACTION_ERROR', TIMEOUT: 'TIMEOUT',
//     PROVIDER_ERROR: 'PROVIDER_ERROR', INITIALIZATION_ERROR: 'INITIALIZATION_ERROR',
//     DEPENDENCY_ERROR: 'DEPENDENCY_ERROR', UNKNOWN_ERROR: 'UNKNOWN_ERROR'
// };

// // ======================================================
// // 🔄  INITIALIZATION STATE
// // ======================================================

// let isInitialized = false;
// let initializationPromise = null;
// let walletConnectLoaded = false;
// let walletConnectPromise = null;
// let walletConnectProvider = null;
// let resolveReady, rejectReady;
// const readyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

// // ======================================================
// // 🛡️  ERROR HANDLING CLASS
// // ======================================================

// class PaymentError extends Error {
//     constructor(message, code, metadata = {}) {
//         super(message);
//         this.name = 'PaymentError';
//         this.code = code;
//         this.metadata = metadata;
//         if (Error.captureStackTrace) Error.captureStackTrace(this, PaymentError);
//     }
// }

// // ======================================================
// // 🔌  DEPENDENCY LOADING
// // ======================================================

// async function loadScript(src, checkFn, name, timeout = 20000) {
//     if (checkFn()) { 
//         console.log(`✅ ${name} already loaded`); 
//         return true; 
//     }
    
//     return new Promise((resolve, reject) => {
//         const startTime = Date.now();
//         const srcFile = src.split('/').pop().split('?')[0];
//         const existingScript = document.querySelector(`script[src*="${srcFile}"]`);
        
//         // If script exists, wait for it
//         if (existingScript) {
//             console.log(`[${name}] Waiting for existing script...`);
//             const check = setInterval(() => {
//                 if (checkFn()) { 
//                     clearInterval(check); 
//                     console.log(`✅ ${name} ready`);
//                     resolve(true); 
//                 } else if (Date.now() - startTime > timeout) {
//                     clearInterval(check);
//                     console.warn(`[${name}] Timeout waiting for existing script`);
//                     // Don't reject - mark as "soft fail" and let caller handle
//                     resolve(false);
//                 }
//             }, 150);
//             return;
//         }
        
//         // Load fresh script
//         const script = document.createElement('script'); 
//         script.src = src;
//         script.async = true;
        
//         script.onload = () => {
//             const initCheck = setInterval(() => {
//                 if (checkFn()) { 
//                     clearInterval(initCheck);
//                     console.log(`✅ ${name} loaded`); 
//                     resolve(true); 
//                 } else if (Date.now() - startTime > timeout) {
//                     clearInterval(initCheck);
//                     reject(new PaymentError(`${name} init timeout`, ERROR_CODES.DEPENDENCY_ERROR));
//                 }
//             }, 100);
//         };
        
//         script.onerror = () => reject(new PaymentError(`Failed to load ${name}`, ERROR_CODES.DEPENDENCY_ERROR));
//         document.head.appendChild(script);
//     });
// }

// async function loadEthers() { 
//     return loadScript(CONFIG.ETHERS.SRC, () => typeof ethers !== 'undefined' && ethers.utils, 'Ethers.js', 25000); 
// }

// // Shared WalletConnect loader with retry logic - can be called from vote.js
// async function loadWalletConnectWithRetry(retries = 3, delay = 2000) {
//     if (walletConnectLoaded && window.EthereumProvider) {
//         console.log('✅ WalletConnect already available');
//         return window.EthereumProvider;
//     }
    
//     if (walletConnectPromise) {
//         console.log('[WalletConnect] Waiting for existing load...');
//         try {
//             return await walletConnectPromise;
//         } catch (e) {
//             console.warn('[WalletConnect] Existing load failed, retrying...');
//             walletConnectPromise = null;
//         }
//     }
    
//     for (let attempt = 1; attempt <= retries; attempt++) {
//         try {
//             console.log(`[WalletConnect] Load attempt ${attempt}/${retries}...`);
            
//             walletConnectPromise = loadScript(
//                 CONFIG.WALLETCONNECT.SRC, 
//                 () => !!window.EthereumProvider, 
//                 'WalletConnect',
//                 20000
//             );
            
//             const result = await walletConnectPromise;
            
//             if (result && window.EthereumProvider) {
//                 walletConnectLoaded = true;
//                 console.log('✅ WalletConnect loaded successfully');
//                 return window.EthereumProvider;
//             }
            
//             throw new Error('EthereumProvider not available after load');
            
//         } catch (e) {
//             console.warn(`[WalletConnect] Attempt ${attempt} failed:`, e.message);
//             walletConnectPromise = null;
            
//             if (attempt < retries) {
//                 console.log(`[WalletConnect] Waiting ${delay}ms before retry...`);
//                 await new Promise(r => setTimeout(r, delay));
//             }
//         }
//     }
    
//     throw new PaymentError('WalletConnect failed after retries', ERROR_CODES.PROVIDER_ERROR);
// }

// // Simple alias for backward compatibility
// async function loadWalletConnect() {
//     return loadWalletConnectWithRetry(2, 1500);
// }

// async function loadPaystack() { 
//     return loadScript(CONFIG.PAYSTACK.SRC, () => typeof PaystackPop !== 'undefined', 'Paystack', 15000); 
// }

// // ======================================================
// // 🔌  UTILITY FUNCTIONS
// // ======================================================

// function validateInputs(participantId, voteCount) {
//     if (!participantId || typeof participantId !== 'string') throw new PaymentError('Invalid participant ID', ERROR_CODES.INVALID_INPUT);
//     if (!voteCount || isNaN(voteCount) || voteCount <= 0) throw new PaymentError('Invalid vote count', ERROR_CODES.INVALID_INPUT);
// }

// function getAttempts(pid) { try { return JSON.parse(sessionStorage.getItem(`crypto_pay_${pid}`) || '[]'); } catch { return []; } }
// function setAttempts(pid, a) { try { sessionStorage.setItem(`crypto_pay_${pid}`, JSON.stringify(a)); } catch {} }
// function checkRateLimit(pid) {
//     const now = Date.now(), attempts = getAttempts(pid).filter(t => now - t < CONFIG.LIMITS.ATTEMPT_TIMEOUT);
//     if (attempts.length >= CONFIG.LIMITS.MAX_RETRIES) throw new PaymentError('Too many attempts. Try later.', ERROR_CODES.RATE_LIMIT);
//     attempts.push(now); setAttempts(pid, attempts);
// }

// function trackEvent(name, meta = {}) { try { window.analytics?.track(name, meta); console.log(`[Analytics] ${name}`, meta); } catch {} }
// function isMobile() { return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent); }

// function generateQR(text, elementId) {
//     const el = document.getElementById(elementId); if (!el) return;
//     const img = document.createElement('img'); img.className = 'mx-auto rounded-lg'; img.alt = 'QR Code'; img.style.cssText = 'width:200px;height:200px;';
//     const urls = [`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(text)}`, `https://quickchart.io/qr?text=${encodeURIComponent(text)}&size=200`];
//     let i = 0; img.onerror = () => { if (++i < urls.length) img.src = urls[i]; };
//     img.src = urls[0]; el.innerHTML = ''; el.appendChild(img);
// }

// // ======================================================
// // 🌐  WALLET MANAGEMENT
// // ======================================================

// async function detectNetwork() {
//     try {
//         if (window.tronWeb?.ready) return 'TRON';
//         if (window.ethereum) { const c = await window.ethereum.request({ method: 'eth_chainId' }); if (c === '0x38') return 'BSC'; }
//     } catch {} return null;
// }

// async function connectWalletConnect() {
//     try {
//         // Use retry loader
//         const EthereumProvider = await loadWalletConnectWithRetry(3, 2000);
        
//         if (!EthereumProvider) {
//             throw new PaymentError('WalletConnect not available', ERROR_CODES.PROVIDER_ERROR);
//         }
        
//         // Clear stale sessions
//         try {
//             Object.keys(localStorage)
//                 .filter(k => k.startsWith('wc@') || k.includes('walletconnect'))
//                 .forEach(k => { try { localStorage.removeItem(k); } catch {} });
//         } catch {}
        
//         console.log('[WalletConnect] Initializing provider...');
        
//         const provider = await EthereumProvider.init({
//             projectId: CONFIG.WALLETCONNECT.PROJECT_ID,
//             chains: [CONFIG.BSC.CHAIN_ID],
//             showQrModal: true,
//             qrModalOptions: { 
//                 themeMode: 'dark', 
//                 enableExplorer: true,
//                 explorerRecommendedWalletIds: [
//                     'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
//                     '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
//                     '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369'
//                 ] 
//             },
//             metadata: { 
//                 name: "OneDream Voting", 
//                 description: "Secure USDT Payment", 
//                 url: window.location.origin, 
//                 icons: [`${window.location.origin}/favicon.ico`] 
//             }
//         });
        
//         console.log('[WalletConnect] Connecting...');
//         await provider.connect();
        
//         // Chain verification
//         const chainId = await provider.request({ method: 'eth_chainId' });
//         const targetChain = `0x${CONFIG.BSC.CHAIN_ID.toString(16)}`;
        
//         if (chainId !== targetChain) {
//             try { 
//                 await provider.request({ 
//                     method: 'wallet_switchEthereumChain', 
//                     params: [{ chainId: targetChain }] 
//                 }); 
//             } catch { 
//                 throw new PaymentError('Please switch to BSC network', ERROR_CODES.NETWORK_ERROR); 
//             }
//         }
        
//         const accounts = await provider.request({ method: 'eth_accounts' });
//         if (!accounts?.length) throw new PaymentError('No wallet accounts', ERROR_CODES.WALLET_ERROR);
        
//         walletConnectProvider = provider;
//         console.log('✅ WalletConnect connected:', accounts[0]);
//         return provider;
        
//     } catch (error) {
//         console.error('[WalletConnect] Error:', error);
        
//         // Handle component registry conflicts
//         if (error.message?.includes('already been used') || error.message?.includes('already registered')) {
//             console.log('[WalletConnect] Component conflict, provider may still work');
//             walletConnectLoaded = true;
//             if (walletConnectProvider) return walletConnectProvider;
//         }
        
//         throw new PaymentError(error.message || 'WalletConnect failed', ERROR_CODES.WALLET_ERROR);
//     }
// }

// // ======================================================
// // 🏦  PAYMENT EXECUTION
// // ======================================================

// async function executeBSCTransfer(provider, recipient, amount) {
//     await loadEthers();
//     const accounts = await provider.request({ method: 'eth_accounts' });
//     if (!accounts[0]) throw new PaymentError('No wallet connected', ERROR_CODES.WALLET_ERROR);
//     const amountWei = ethers.utils.parseUnits(amount.toString(), 18);
//     const iface = new ethers.utils.Interface(["function transfer(address to, uint256 amount) returns (bool)"]);
//     const data = iface.encodeFunctionData("transfer", [recipient, amountWei]);
//     const txHash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: CONFIG.BSC.USDT_ADDRESS, data }] });
//     return { txHash, network: 'BSC', explorerUrl: `${CONFIG.BSC.EXPLORER}${txHash}` };
// }

// async function executeTronTransfer(recipient, amount) {
//     if (!window.tronWeb?.ready) throw new PaymentError('TronLink not available', ERROR_CODES.PROVIDER_ERROR);
//     const contract = await window.tronWeb.contract().at(CONFIG.TRON.USDT_ADDRESS);
//     const tx = await contract.transfer(recipient, Math.floor(amount * 1e6)).send();
//     if (!tx?.transaction?.txID) throw new PaymentError('TRON transaction failed', ERROR_CODES.TRANSACTION_ERROR);
//     return { txHash: tx.transaction.txID, network: 'TRON', explorerUrl: `${CONFIG.TRON.EXPLORER}${tx.transaction.txID}` };
// }

// async function finalizePayment(txHash, network) {
//     const res = await fetch('/api/onedream/finalize-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_hash: txHash, network: network.toLowerCase() }) });
//     if (!res.ok) throw new PaymentError('Finalization failed', ERROR_CODES.NETWORK_ERROR);
//     return res.json();
// }

// // ======================================================
// // 💳  PAYSTACK INTEGRATION
// // ======================================================

// async function initiatePaystackPayment(email, amount, participantId, voteCount, onSuccess, onClose) {
//     if (!CONFIG.PAYSTACK.PUBLIC_KEY) { alert('Paystack not configured'); return { success: false }; }
//     await loadPaystack();
//     return new Promise((resolve) => {
//         const handler = PaystackPop.setup({
//             key: CONFIG.PAYSTACK.PUBLIC_KEY,
//             email: email,
//             amount: Math.round(amount * 100), // Paystack uses kobo/cents
//             currency: 'NGN',
//             ref: `vote_${participantId}_${Date.now()}`,
//             metadata: { participant_id: participantId, vote_count: voteCount },
//             callback: (response) => {
//                 trackEvent('paystack_success', { reference: response.reference, participantId });
//                 if (onSuccess) onSuccess(response);
//                 resolve({ success: true, reference: response.reference });
//             },
//             onClose: () => {
//                 trackEvent('paystack_closed', { participantId });
//                 if (onClose) onClose();
//                 resolve({ success: false, cancelled: true });
//             }
//         });
//         handler.openIframe();
//     });
// }

// // ======================================================
// // 🧩  UI COMPONENTS
// // ======================================================

// function createModal(content) { const m = document.createElement('div'); m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 crypto-modal-fade-in'; m.innerHTML = content; document.body.appendChild(m); return m; }

// function showPaymentStatusModal(network, amount) {
//     return createModal(`<div class="bg-white p-6 rounded-xl text-center w-80 max-w-[90vw]"><div class="flex justify-between items-center mb-3"><h3 class="font-bold text-lg">${network} Payment</h3><span class="text-xs bg-gray-100 px-2 py-1 rounded">${network === 'BSC' ? 'BEP-20' : 'TRC-20'}</span></div><div class="text-2xl font-bold mb-4">${amount} USDT</div><div id="statusText" class="min-h-6 mb-4">Initializing…</div><div class="loading-spinner mx-auto"></div><div id="txLink" class="mt-4 text-sm hidden"><a href="#" target="_blank" class="text-blue-500">View on explorer</a></div><button id="closeModal" class="mt-4 text-gray-500 text-sm hidden">Close</button></div>`);
// }

// function showNetworkModal(preferred) {
//     return new Promise(resolve => {
//         const m = createModal(`<div class="bg-white p-6 rounded-xl w-80 text-center"><h3 class="font-bold mb-4">Choose Payment Method</h3><button id="bsc" class="w-full bg-yellow-400 hover:bg-yellow-500 py-3 rounded mb-2">🟡 BSC (USDT BEP-20)${preferred === 'BSC' ? ' ✓' : ''}</button><button id="tron" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded mb-2">🔴 TRON (USDT TRC-20)${preferred === 'TRON' ? ' ✓' : ''}</button>${CONFIG.PAYSTACK.PUBLIC_KEY ? '<button id="card" class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded mb-2">💳 Pay with Card (Paystack)</button>' : ''}<button id="cancel" class="mt-2 text-gray-500 text-sm">Cancel</button></div>`);
//         m.querySelector('#bsc').onclick = () => { m.remove(); resolve('BSC'); };
//         m.querySelector('#tron').onclick = () => { m.remove(); resolve('TRON'); };
//         m.querySelector('#card')?.addEventListener('click', () => { m.remove(); resolve('CARD'); });
//         m.querySelector('#cancel').onclick = () => { m.remove(); resolve(null); };
//     });
// }

// function showWalletOptionsModal(network) {
//     return new Promise(resolve => {
//         const m = createModal(`<div class="bg-white p-6 rounded-xl text-center w-80"><h3 class="font-bold mb-3">Connect Wallet</h3><p class="text-sm text-gray-600 mb-4">${isMobile() ? 'Tap to open your wallet app:' : 'Scan QR code or pay manually:'}</p><button id="wc" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded mb-2">🔗 ${isMobile() ? 'Open Wallet App' : 'WalletConnect QR'}</button><button id="qr" class="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded mb-2">📱 Pay via QR Code</button><button id="back" class="w-full bg-gray-200 py-2 rounded mt-2">← Back</button></div>`);
//         m.querySelector('#wc').onclick = () => { m.remove(); resolve('walletconnect'); };
//         m.querySelector('#qr').onclick = () => { m.remove(); resolve('qr'); };
//         m.querySelector('#back').onclick = () => { m.remove(); resolve('back'); };
//     });
// }

// function showManualPaymentModal(network, recipient, amount) {
//     return new Promise(resolve => {
//         const id = network.toLowerCase() + 'QR';
//         const m = createModal(`<div class="bg-white p-6 rounded-xl text-center w-80 max-w-[95vw]"><h3 class="font-bold mb-3">${network} USDT Payment</h3><p class="text-sm mb-2">Send <strong>${amount} USDT</strong> to:</p><div class="bg-gray-100 p-2 rounded break-all text-xs mb-3 font-mono">${recipient}</div><div id="${id}" class="mx-auto mb-3"></div><p class="text-xs text-red-500 mb-2">⚠️ Only send USDT on ${network} network!</p><button id="copy" class="text-blue-500 text-xs mb-3">📋 Copy Address</button><div class="border-t pt-3 mt-2"><input type="text" id="txHash" placeholder="Transaction hash (optional)" class="w-full text-xs p-2 border rounded mb-2"/><button id="confirm" class="w-full bg-green-600 text-white py-2 rounded text-sm mb-2">✅ I've Paid</button></div><button id="close" class="w-full bg-gray-200 py-2 rounded text-sm">Cancel</button></div>`);
//         generateQR(recipient, id);
//         m.querySelector('#copy').onclick = () => { navigator.clipboard.writeText(recipient); m.querySelector('#copy').textContent = '✅ Copied!'; setTimeout(() => m.querySelector('#copy').textContent = '📋 Copy Address', 2000); };
//         m.querySelector('#confirm').onclick = () => { const tx = m.querySelector('#txHash').value.trim(); if (!tx && !confirm('No hash entered. Continue?')) return; m.remove(); const pattern = network === 'BSC' ? /^0x[a-fA-F0-9]{64}$/ : /^[a-fA-F0-9]{64}$/; resolve(tx && pattern.test(tx) ? { success: true, manual: true, txHash: tx, explorerUrl: `${CONFIG[network].EXPLORER}${tx}` } : { success: false, manual: true, pending: true }); };
//         m.querySelector('#close').onclick = () => { m.remove(); resolve({ success: false, cancelled: true }); };
//     });
// }

// function updateStatus(m, t) { const el = m.querySelector('#statusText'); if (el) el.textContent = t; }
// function successStatus(m, tx, url) { updateStatus(m, '✅ Payment confirmed'); m.querySelector('.loading-spinner')?.remove(); const l = m.querySelector('#txLink'); if (l) { l.querySelector('a').href = url; l.classList.remove('hidden'); } setTimeout(() => m.remove(), 5000); }
// function errorStatus(m, e) { updateStatus(m, `❌ ${e.message || 'Failed'}`); m.querySelector('.loading-spinner')?.remove(); m.querySelector('#closeModal')?.classList.remove('hidden'); }

// // ======================================================
// // 🚀  MAIN ENTRY POINTS
// // ======================================================

// async function initiateCryptoPayment(participantId, voteCount, amount, email = null) {
//     let modal = null;
//     try {
//         validateInputs(participantId, voteCount);
//         checkRateLimit(participantId);
        
//         // Update vote.js overlay if available (step 2: network selection)
//         if (window.updateOverlayStep) window.updateOverlayStep(2);
//         if (window.updateOverlayMessage) window.updateOverlayMessage('Choose payment network...', 'Select BSC, TRON, or Card');
        
//         const preferred = await detectNetwork();
//         const method = await showNetworkModal(preferred);
//         if (!method) return { success: false, cancelled: true };
        
//         // Paystack card payment
//         if (method === 'CARD') {
//             const userEmail = email || prompt('Enter your email for payment receipt:');
//             if (!userEmail) return { success: false, cancelled: true };
//             return initiatePaystackPayment(userEmail, amount, participantId, voteCount);
//         }
        
//         const recipient = CONFIG[method].WALLET_ADDRESS;
        
//         // BSC Payment Flow
//         if (method === 'BSC') {
//             const choice = await showWalletOptionsModal(method);
//             if (choice === 'back') return initiateCryptoPayment(participantId, voteCount, amount, email);
//             if (choice === 'qr') {
//                 const result = await showManualPaymentModal(method, recipient, amount);
//                 if (result.success && result.txHash) { 
//                     try { await finalizePayment(result.txHash, method); } catch {} 
//                 }
//                 trackEvent('payment_completed', { participantId, network: method, manual: true });
//                 return result;
//             }
//             if (choice === 'walletconnect') {
//                 modal = showPaymentStatusModal(method, amount);
//                 updateStatus(modal, isMobile() ? 'Opening wallet...' : 'Scan QR with wallet...');
                
//                 // Update vote.js overlay (step 3: confirming)
//                 if (window.updateOverlayStep) window.updateOverlayStep(3);
                
//                 try {
//                     const provider = await connectWalletConnect();
//                     updateStatus(modal, 'Confirm transaction...');
//                     const result = await executeBSCTransfer(provider, recipient, amount);
//                     updateStatus(modal, 'Finalizing...');
//                     await finalizePayment(result.txHash, method);
//                     successStatus(modal, result.txHash, result.explorerUrl);
//                     trackEvent('payment_completed', { participantId, network: method, method: 'walletconnect' });
//                     return { success: true, ...result };
//                 } catch (e) {
//                     errorStatus(modal, e);
//                     if (confirm('Connection failed. Try QR payment?')) {
//                         modal.remove();
//                         return showManualPaymentModal(method, recipient, amount);
//                     }
//                     return { success: false, error: e.message };
//                 }
//             }
//         }
        
//         // TRON Payment Flow
//         if (method === 'TRON') {
//             if (!window.tronWeb?.ready) {
//                 const result = await showManualPaymentModal(method, recipient, amount);
//                 if (result.success && result.txHash) { 
//                     try { await finalizePayment(result.txHash, method); } catch {} 
//                 }
//                 trackEvent('payment_completed', { participantId, network: method, manual: true });
//                 return result;
//             }
//             modal = showPaymentStatusModal(method, amount);
//             updateStatus(modal, 'Confirm in TronLink...');
            
//             // Update vote.js overlay (step 3: confirming)
//             if (window.updateOverlayStep) window.updateOverlayStep(3);
            
//             const result = await executeTronTransfer(recipient, amount);
//             updateStatus(modal, 'Finalizing...');
//             await finalizePayment(result.txHash, method);
//             successStatus(modal, result.txHash, result.explorerUrl);
//             trackEvent('payment_completed', { participantId, network: method, method: 'tronlink' });
//             return { success: true, ...result };
//         }
        
//         return { success: false, error: 'Invalid method' };
//     } catch (error) {
//         console.error('[Payment] Error:', error);
//         if (modal) errorStatus(modal, error); 
//         else if (window.showOverlayError) window.showOverlayError(error.message || 'Payment failed');
//         else alert(error.message || 'Payment failed');
//         trackEvent('payment_error', { error: error.message, participantId });
//         return { success: false, error: error.message };
//     }
// }

// async function processCryptoPayment() {
//     const pid = window.currentParticipant?.id, votes = window.selectedVoteAmount, amt = window.selectedPaymentAmount || votes * 0.5;
//     if (!pid || !votes) return { success: false, error: 'Missing details' };
//     return initiateCryptoPayment(pid, votes, amt);
// }

// // ======================================================
// // 🏁  INITIALIZATION
// // ======================================================

// async function initialize() {
//     if (isInitialized) return true;
//     if (initializationPromise) return initializationPromise;
    
//     initializationPromise = (async () => {
//         try {
//             await loadEthers();
            
//             // Pre-load WalletConnect in background - don't block
//             loadWalletConnectWithRetry(2, 1000).catch(e => 
//                 console.warn('[Init] WalletConnect preload skipped:', e.message)
//             );
            
//             isInitialized = true;
//             resolveReady(true);
//             console.log('🔒 Crypto Payments Ready');
//             return true;
//         } catch (e) {
//             console.error('[Init] Failed:', e);
//             rejectReady(e);
//             throw e;
//         }
//     })();
    
//     return initializationPromise;
// }

// function isReady() { return isInitialized; }
// async function whenReady(timeout = 15000) {
//     if (isInitialized) return true;
//     return Promise.race([readyPromise, new Promise((_, r) => setTimeout(() => r(new Error('Init timeout')), timeout))]);
// }

// // Auto-initialize
// setTimeout(() => initialize().catch(console.error), 50);

// // ======================================================
// // 🌍  GLOBAL EXPORTS
// // ======================================================

// window.initiateCryptoPayment = initiateCryptoPayment;
// window.processCryptoPayment = processCryptoPayment;
// window.initiatePaystackPayment = initiatePaystackPayment;
// window.cryptoPaymentReady = readyPromise;

// // Shared loader for vote.js to use
// window.loadWalletConnectShared = loadWalletConnectWithRetry;

// window.CryptoPayments = {
//     initiate: initiateCryptoPayment,
//     process: processCryptoPayment,
//     paystack: initiatePaystackPayment,
//     loadWalletConnect: loadWalletConnectWithRetry,
//     connectWallet: connectWalletConnect,
//     isReady, whenReady, initialize,
//     showManualPaymentModal,
//     CONFIG, ERROR_CODES
// };

// console.log('✅ Crypto Payments module loaded');
console.log('📦 Crypto Payments Module Loading...');

// ========================================
// 🔒 SECURE CRYPTO PAYMENT INITIALIZATION
// ========================================
async function initializeCryptoPayment(participantId, voteCount, network) {
    try {
        const response = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participantId,
                vote_count: voteCount,
                network: network
            })
        });

        if (!response.ok) throw new Error('Failed to initialize payment');
        return await response.json(); // { payment_id, recipient_address, amount, network }
    } catch (error) {
        console.error('Payment initialization error:', error);
        throw error;
    }
}

// ========================================
// 🆕 PROCESS CRYPTO PAYMENT (Main Entry Point)
// ========================================
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

    // Step 3: Process network-specific payment
    if (network === 'bsc') return await processUSDTPaymentBSC(paymentInit);
    if (network === 'tron') return await processUSDTPaymentTron(paymentInit);

    return { success: false, error: 'Unsupported network' };
}

// ========================================
// 🔒 BSC USDT PAYMENT (WalletConnect + MetaMask)
// ========================================
async function processUSDTPaymentBSC(paymentInit) {
    const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    const hasMetaMask = typeof window.ethereum !== 'undefined';

    if (isMobile && hasMetaMask) {
        return await processBSCWithMobileWallet(paymentInit);
    } else {
        return await processBSCWithWalletConnect(paymentInit);
    }
}

// BSC WalletConnect (QR Code for desktop + mobile wallets)
async function processBSCWithWalletConnect(paymentInit) {
    const modal = showEnhancedPaymentModal('BSC', paymentInit.amount);
    
    try {
        // ✅ Load WalletConnect if not already loaded (lazy loading)
        if (typeof window.loadWalletConnect === 'function') {
            updateModalStatus(modal, 'Loading WalletConnect library...', 'loading');
            try {
                await window.loadWalletConnect();
            } catch (error) {
                console.error('WalletConnect loader failed (original):', error);
                updateModalStatus(modal, 'Failed to load WalletConnect. Click Retry or Refresh the page.', 'error');

                // Provide a Retry / Cancel UI inside the modal
                const inner = modal.querySelector('.glassmorphism') || modal.firstElementChild || modal;
                const actionBar = document.createElement('div');
                actionBar.style.marginTop = '12px';
                actionBar.style.display = 'flex';
                actionBar.style.gap = '8px';
                actionBar.style.justifyContent = 'center';

                const retryBtn = document.createElement('button');
                retryBtn.textContent = 'Retry';
                retryBtn.className = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg';

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = 'Cancel';
                cancelBtn.className = 'bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg';

                actionBar.appendChild(retryBtn);
                actionBar.appendChild(cancelBtn);
                inner.appendChild(actionBar);

                // Promise that resolves when retry succeeds or rejects on cancel
                const retryPromise = new Promise((resolve, reject) => {
                    retryBtn.addEventListener('click', async () => {
                        retryBtn.disabled = true;
                        updateModalStatus(modal, 'Retrying to load WalletConnect...', 'loading');
                        try {
                            await window.loadWalletConnect();
                            // remove action bar and continue
                            actionBar.remove();
                            resolve(true);
                        } catch (e) {
                            console.error('Retry failed:', e);
                            updateModalStatus(modal, 'Retry failed. Please refresh the page.', 'error');
                            retryBtn.disabled = false;
                        }
                    });

                    cancelBtn.addEventListener('click', () => {
                        actionBar.remove();
                        reject(new Error('User cancelled WalletConnect load'));
                    });
                });

                try {
                    await retryPromise;
                } catch (err) {
                    modal?.remove();
                    throw new Error('Failed to load WalletConnect. Please refresh and try again.');
                }
            }
        }

        // ✅ Check if EthereumProvider is available
        if (!window.EthereumProvider) {
            modal?.remove();
            throw new Error('WalletConnect library not loaded. Please refresh the page.');
        }

        updateModalStatus(modal, 'Initializing WalletConnect...', 'loading');

        // Initialize WalletConnect Provider
        const provider = await window.EthereumProvider.init({
            projectId: window.WALLETCONNECT_PROJECT_ID || '61d9b98f81731dffa9988c0422676fc5',
            chains: [56], // BSC Mainnet
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

        // Connect wallet (this will show the QR code modal)
        await provider.connect();

        const accounts = await provider.request({ method: 'eth_accounts' });
        const walletAddress = accounts[0];

        updateModalStatus(modal, `✅ Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`, 'connected');

        // Check if on correct network (BSC)
        const chainId = await provider.request({ method: 'eth_chainId' });
        if (parseInt(chainId, 16) !== 56) {
            updateModalStatus(modal, 'Switching to BSC network...', 'loading');
            try {
                await provider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x38' }] // BSC Mainnet
                });
            } catch (switchError) {
                // If network doesn't exist in wallet, add it
                if (switchError.code === 4902) {
                    await provider.request({
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

        updateModalStatus(modal, 'Preparing USDT transfer...', 'loading');

        // Create ethers provider (use ethers v5 from CDN)
        const ethersProvider = new ethers.providers.Web3Provider(provider);
        const signer = ethersProvider.getSigner();

        // BSC USDT Contract Address
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const recipientAddress = paymentInit.recipient_address;
        const amountInWei = ethers.utils.parseUnits(paymentInit.amount.toString(), 18);

        // Create USDT contract instance
        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        updateModalStatus(modal, `💸 Sending ${paymentInit.amount} USDT...`, 'loading');

        // Execute transfer
        const tx = await usdtContract.transfer(recipientAddress, amountInWei);

        updateModalStatus(modal, '⏳ Waiting for confirmation...', 'pending');

        // Wait for transaction confirmation
        const receipt = await tx.wait(1);

        updateModalStatus(modal, '✅ Payment Confirmed!', 'success');

        setTimeout(() => modal?.remove(), 2000);

        // Disconnect WalletConnect
        await provider.disconnect();

        return {
            success: true,
            payment_intent_id: tx.hash,
            txHash: tx.hash,
            network: 'bsc',
            explorer: `https://bscscan.com/tx/${tx.hash}`,
            receipt: receipt
        };

    } catch (error) {
        console.error('BSC WalletConnect payment error:', error);
        updateModalStatus(modal, `❌ Error: ${error.message}`, 'error');
        setTimeout(() => modal?.remove(), 3000);
        return {
            success: false,
            error: error.message || 'BSC payment failed'
        };
    }
}

// BSC mobile wallet (MetaMask / injected)
async function processBSCWithMobileWallet(paymentInit) {
    if (!window.ethereum) return { success: false, error: 'No wallet detected' };
    
    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        const walletAddress = accounts[0];

        const network = await provider.getNetwork();
        if (Number(network.chainId) !== 56) {
            await window.ethereum.request({ 
                method: 'wallet_switchEthereumChain', 
                params: [{ chainId: '0x38' }] 
            });
        }

        const signer = provider.getSigner();
        const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
        const amountInWei = ethers.utils.parseUnits(paymentInit.amount.toString(), 18);

        const usdtContract = new ethers.Contract(
            usdtAddress,
            ['function transfer(address to, uint256 amount) returns (bool)'],
            signer
        );

        const tx = await usdtContract.transfer(paymentInit.recipient_address, amountInWei);
        await tx.wait(1);

        return { 
            success: true, 
            payment_intent_id: tx.hash, 
            txHash: tx.hash, 
            network: 'bsc', 
            explorer: `https://bscscan.com/tx/${tx.hash}` 
        };

    } catch (error) {
        return { success: false, error: error.message || 'BSC payment failed' };
    }
}

// ========================================
// 🔒 TRON USDT PAYMENT
// ========================================
async function processUSDTPaymentTron(paymentInit) {
    if (window.tronWeb && window.tronWeb.ready) {
        return await processTronWithTronLink(paymentInit);
    } else {
        return await processTronWithQRCode(paymentInit);
    }
}

// TRON QR + deep link
async function processTronWithQRCode(paymentInit) {
    try {
        const recipientAddress = paymentInit.recipient_address;
        const amountUSD = paymentInit.amount;

        const tronDeepLink = `tronlinkoutside://send?token=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&amount=${amountUSD*1000000}&receiver=${recipientAddress}`;

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-6 max-w-md w-full">
                <h3 class="text-xl font-bold mb-2">🔴 TRON USDT Payment</h3>
                <p class="mb-4">Amount: ${amountUSD} USDT (TRC-20)</p>
                <div id="tronQRCode" class="mb-4"></div>
                <button onclick="window.open('${tronDeepLink}','_blank')" class="w-full bg-red-600 py-3 rounded-lg text-white font-bold mb-2">Open in TronLink/Wallet</button>
                <button onclick="this.closest('.fixed').remove()" class="w-full bg-gray-600 py-2 rounded-lg text-white font-semibold">Cancel</button>
                <p class="mt-2 text-xs text-white/70">Scan QR or click to open wallet</p>
            </div>
        `;
        document.body.appendChild(modal);

        // Generate QR code
        setTimeout(() => generateEnhancedQRCode(recipientAddress, 'tronQRCode', 'tron', amountUSD), 100);

        return new Promise(resolve => {
            window.confirmTronPayment = async function(txHash) {
                modal.remove();
                if (txHash?.length === 64) {
                    resolve({ 
                        success: true, 
                        payment_intent_id: txHash, 
                        txHash, 
                        network: 'tron', 
                        explorer: `https://tronscan.org/#/transaction/${txHash}` 
                    });
                } else {
                    resolve({ 
                        success: true, 
                        payment_intent_id: `manual_${Date.now()}`, 
                        txHash: null, 
                        network: 'tron', 
                        manual: true 
                    });
                }
            };
        });

    } catch (error) {
        console.error('TRON QR error:', error);
        return { success: false, error: error.message || 'TRON payment failed' };
    }
}

// TRON injected wallet (TronLink)
async function processTronWithTronLink(paymentInit) {
    try {
        const tronWeb = window.tronWeb;
        const usdtContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
        const amount = Math.floor(paymentInit.amount * 1000000);

        const contract = await tronWeb.contract().at(usdtContract);
        const txResult = await contract.transfer(paymentInit.recipient_address, amount).send();

        return { 
            success: true, 
            payment_intent_id: txResult, 
            txHash: txResult, 
            network: 'tron', 
            explorer: `https://tronscan.org/#/transaction/${txResult}` 
        };

    } catch (error) {
        return { success: false, error: error.message || 'TronLink payment failed' };
    }
}

// ========================================
// 🔹 UI / MODALS / QR HELPERS
// ========================================

function showEnhancedPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="glassmorphism rounded-2xl p-8 max-w-md w-full text-center">
            <h3 class="text-2xl font-bold mb-2">${network} Payment</h3>
            <p class="mb-4 text-lg">Amount: <span class="font-bold">${amount} USDT</span></p>
            <div id="modalStatus" class="mb-4 text-white/80">Connecting...</div>
            <div class="loading-spinner mx-auto mt-2"></div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function updateModalStatus(modal, message, status) {
    if (!modal) return;
    const statusDiv = modal.querySelector('#modalStatus');
    const spinner = modal.querySelector('.loading-spinner');
    
    if (statusDiv) statusDiv.innerHTML = message;
    
    if (spinner) {
        if (status === 'success' || status === 'error') {
            spinner.style.display = 'none';
        } else {
            spinner.style.display = 'block';
        }
    }
}

// Network selection modal
async function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
        modal.innerHTML = `
            <div class="glassmorphism rounded-2xl p-8 max-w-lg w-full">
                <h3 class="text-2xl font-bold mb-4 text-center">Select USDT Network</h3>
                <p class="text-white/70 mb-6 text-center">Choose your preferred blockchain network</p>
                <button onclick="selectCryptoNetwork('bsc')" class="w-full mb-3 bg-yellow-500 hover:bg-yellow-600 py-4 rounded-lg font-bold text-lg transition-colors">
                    🟡 BSC (BEP-20)
                </button>
                <button onclick="selectCryptoNetwork('tron')" class="w-full mb-3 bg-red-500 hover:bg-red-600 py-4 rounded-lg font-bold text-lg transition-colors">
                    🔴 TRON (TRC-20)
                </button>
                <button onclick="selectCryptoNetwork(null)" class="w-full py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors">
                    Cancel
                </button>
            </div>
        `;
        document.body.appendChild(modal);

        window.selectCryptoNetwork = function(network) {
            modal.remove();
            delete window.selectCryptoNetwork;
            resolve(network);
        };
    });
}

// QR code generator
function generateEnhancedQRCode(address, elementId, network='tron', amount=0) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    let qrData = address;
    if (network === 'tron') qrData = `tron:${address}?amount=${amount}&token=USDT`;
    if (network === 'bsc') qrData = `ethereum:${address}@56?value=${amount}`;
    
    const qrUrl = `https://chart.googleapis.com/chart?chs=256x256&cht=qr&chl=${encodeURIComponent(qrData)}&choe=UTF-8`;
    element.innerHTML = `<img src="${qrUrl}" class="mx-auto rounded-lg shadow-lg border-2 border-white/20"/>`;
}

// Copy to clipboard helper
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard! 📋');
    }).catch(() => {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
        alert('Copied to clipboard! 📋');
    });
}

// Export to window for access from vote.js
window.processCryptoPayment = processCryptoPayment;
window.initializeCryptoPayment = initializeCryptoPayment;

console.log('✅ Crypto Payments Module Loaded');
