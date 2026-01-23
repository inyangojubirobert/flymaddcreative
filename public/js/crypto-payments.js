// console.log('🪙 Crypto Payments Module Loaded (BSC + TRON USDT)');

// /* ======================================================
//    🔒 WALLETCONNECT LOADER
// ====================================================== */
// async function loadWalletConnect() {
//     if (window.EthereumProvider) return window.EthereumProvider;

//     return new Promise((resolve, reject) => {
//         const script = document.createElement('script');
//         script.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js';
//         script.onload = () => {
//             console.log('✅ WalletConnect SDK loaded');
//             resolve(window.EthereumProvider);
//         };
//         script.onerror = () => reject(new Error('WalletConnect failed to load'));
//         document.head.appendChild(script);
//     });
// }

// /* ======================================================
//    🔒 BACKEND INITIALIZATION
// ====================================================== */
// async function initializeCryptoPayment(participantId, voteCount, network) {
//     const res = await fetch('/api/onedream/init-crypto-payment', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ participant_id: participantId, vote_count: voteCount, network })
//     });

//     if (!res.ok) throw new Error('Backend init failed');
//     return res.json();
// }

// /* ======================================================
//    🆕 MAIN ENTRY
// ====================================================== */
// async function processCryptoPayment() {
//     const participantId = window.currentParticipant?.id;
//     const voteCount = window.selectedVoteAmount;

//     if (!participantId || !voteCount) {
//         alert('Missing participant or vote amount');
//         return { success: false };
//     }

//     const network = await showNetworkSelectionModal();
//     if (!network) return { success: false, cancelled: true };

//     try {
//         const init = await initializeCryptoPayment(participantId, voteCount, network);

//         if (network === 'bsc') return await processBSC(init);
//         if (network === 'tron') return await processTron(init);

//         throw new Error('Unsupported network');
//     } catch (err) {
//         console.error('❌ Crypto Payment Error:', err);
//         return { success: false, error: err.message };
//     }
// }

// /* ======================================================
//    🟡 BSC – USDT (BEP-20)
// ====================================================== */
// async function processBSC(init) {
//     const isInjected = window.ethereum;

//     if (isInjected) return processBSCInjected(init);
//     return processBSCWalletConnect(init);
// }

// async function processBSCInjected(init) {
//     const modal = showPaymentStatusModal('BSC', init.amount);

//     try {
//         const provider = new ethers.providers.Web3Provider(window.ethereum);
//         await provider.send('eth_requestAccounts', []);
//         const signer = provider.getSigner();

//         updateStatus(modal, 'Confirm USDT transfer…');

//         const usdt = new ethers.Contract(
//             '0x55d398326f99059fF775485246999027B3197955',
//             ['function transfer(address,uint256) returns (bool)'],
//             signer
//         );

//         const tx = await usdt.transfer(
//             init.recipient_address,
//             ethers.utils.parseUnits(init.amount.toString(), 18)
//         );

//         updateStatus(modal, 'Waiting for confirmation…');
//         await tx.wait(1);

//         successStatus(modal);
//         return finalize(tx.hash, 'bsc');
//     } catch (err) {
//         errorStatus(modal, err.message);
//         return { success: false, error: err.message };
//     }
// }

// async function processBSCWalletConnect(init) {
//     const modal = showPaymentStatusModal('BSC', init.amount);

//     try {
//         await loadWalletConnect();

//         const provider = await window.EthereumProvider.init({
//             projectId: window.WALLETCONNECT_PROJECT_ID,
//             chains: [56],
//             showQrModal: true,
//             methods: ['eth_sendTransaction'],
//             qrModalOptions: { themeMode: 'dark' }
//         });

//         updateStatus(modal, 'Connect your wallet…');
//         await provider.connect();

//         const ethersProvider = new ethers.providers.Web3Provider(provider);
//         const signer = ethersProvider.getSigner();

//         updateStatus(modal, 'Confirm USDT transfer…');

//         const usdt = new ethers.Contract(
//             '0x55d398326f99059fF775485246999027B3197955',
//             ['function transfer(address,uint256) returns (bool)'],
//             signer
//         );

//         const tx = await usdt.transfer(
//             init.recipient_address,
//             ethers.utils.parseUnits(init.amount.toString(), 18)
//         );

//         updateStatus(modal, 'Waiting for confirmation…');
//         await tx.wait(1);

//         successStatus(modal);
//         return finalize(tx.hash, 'bsc');
//     } catch (err) {
//         errorStatus(modal, err.message);
//         return { success: false, error: err.message };
//     }
// }

// /* ======================================================
//    🔴 TRON – USDT (TRC-20)
// ====================================================== */
// async function processTron(init) {
//     const modal = showPaymentStatusModal('TRON', init.amount);

//     try {
//         if (!window.tronWeb || !window.tronWeb.ready) {
//             modal.remove();
//             return showTronQR(init);
//         }

//         const contract = await tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
//         const amount = Math.floor(init.amount * 1e6);

//         updateStatus(modal, 'Confirm in TronLink…');
//         const tx = await contract.transfer(init.recipient_address, amount).send();

//         successStatus(modal);
//         return finalize(tx, 'tron');
//     } catch (err) {
//         errorStatus(modal, err.message);
//         return { success: false, error: err.message };
//     }
// }

// function showTronQR(init) {
//     const modal = document.createElement('div');
//     modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';

//     modal.innerHTML = `
//         <div class="bg-white p-6 rounded-xl text-center w-80">
//             <h3 class="font-bold mb-3">TRON USDT</h3>
//             <div id="tronQR"></div>
//             <p class="text-sm mt-2">${init.amount} USDT</p>
//             <button id="closeTron" class="mt-4 text-gray-500">Cancel</button>
//         </div>
//     `;

//     document.body.appendChild(modal);
//     generateQR(init.recipient_address, 'tronQR');

//     modal.querySelector('#closeTron').onclick = () => modal.remove();
//     return { success: false };
// }

// /* ======================================================
//    🧩 UI HELPERS
// ====================================================== */
// function showPaymentStatusModal(network, amount) {
//     const m = document.createElement('div');
//     m.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';
//     m.innerHTML = `
//         <div class="bg-white p-6 rounded-xl text-center w-80">
//             <h3 class="font-bold mb-2">${network} Payment</h3>
//             <p class="text-xl font-bold mb-4">${amount} USDT</p>
//             <div id="statusText">Initializing…</div>
//             <div class="loading-spinner mx-auto mt-4"></div>
//         </div>
//     `;
//     document.body.appendChild(m);
//     return m;
// }

// function updateStatus(modal, text) {
//     modal.querySelector('#statusText').textContent = text;
// }

// function successStatus(modal) {
//     modal.querySelector('#statusText').textContent = '✅ Payment confirmed';
//     modal.querySelector('.loading-spinner').remove();
//     setTimeout(() => modal.remove(), 2000);
// }

// function errorStatus(modal, msg) {
//     modal.querySelector('#statusText').textContent = '❌ ' + msg;
//     modal.querySelector('.loading-spinner')?.remove();
// }

// function finalize(txHash, network) {
//     return {
//         success: true,
//         payment_method: 'crypto',
//         payment_reference: txHash,
//         network
//     };
// }

// function showNetworkSelectionModal() {
//     return new Promise(resolve => {
//         const m = document.createElement('div');
//         m.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
//         m.innerHTML = `
//             <div class="bg-white p-6 rounded-xl w-72 text-center">
//                 <h3 class="font-bold mb-4">Choose Network</h3>
//                 <button id="bsc" class="w-full bg-yellow-400 py-3 rounded mb-3">🟡 BSC</button>
//                 <button id="tron" class="w-full bg-red-600 text-white py-3 rounded">🔴 TRON</button>
//             </div>
//         `;
//         document.body.appendChild(m);
//         m.querySelector('#bsc').onclick = () => { m.remove(); resolve('bsc'); };
//         m.querySelector('#tron').onclick = () => { m.remove(); resolve('tron'); };
//     });
// }

// function generateQR(text, id) {
//     document.getElementById(id).innerHTML =
//         `<img src="https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(text)}" />`;
// }

// /* ======================================================
//    🔑 EXPORT
// ====================================================== */
// window.processCryptoPayment = processCryptoPayment;
//

// /**
//  * 🪙 CRYPTO PAYMENTS MODULE
//  * File: /public/js/crypto-payments.js
//  */

// console.log('🪙 Crypto Payments Module Loaded');

// window.processCryptoPayment = processCryptoPayment;

// /* ======================================================
//    ENTRY POINT CALLED BY vote-payments.js
// ====================================================== */
// async function processCryptoPayment() {
//     const participant = window.currentParticipant;
//     const votes = window.selectedVoteAmount;

//     if (!participant || !votes) {
//         alert('Participant or vote amount missing');
//         return { success: false };
//     }

//     const network = await showNetworkSelectionModal();
//     if (!network) return { success: false };

//     // 1️⃣ Init backend record (LOCK VOTES)
//     const initRes = await fetch('/api/onedream/init-crypto-payment', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//             participant_id: participant.id,
//             vote_count: votes,
//             network
//         })
//     });

//     const payment = await initRes.json();
//     if (!payment?.id) {
//         alert('Failed to initialize crypto payment');
//         return { success: false };
//     }

//     // 2️⃣ Route by network
//     if (network === 'bsc') {
//         return await processBSC(payment);
//     }

//     if (network === 'tron') {
//         return await processTron(payment);
//     }

//     return { success: false };
// }

// /* ======================================================
//    BSC – USDT (BEP-20)
// ====================================================== */
// async function processBSC(payment) {
//     const modal = showPaymentModal('BSC', payment.amount);

//     try {
//         if (!window.ethereum) throw new Error('No wallet detected');

//         const provider = new ethers.providers.Web3Provider(window.ethereum);
//         await provider.send('eth_requestAccounts', []);
//         const signer = provider.getSigner();

//         const usdt = new ethers.Contract(
//             payment.token,
//             ['function transfer(address,uint256) returns (bool)'],
//             signer
//         );

//         updateModal(modal, 'Confirm USDT transfer in wallet…');

//         const tx = await usdt.transfer(
//             payment.recipient_address,
//             ethers.utils.parseUnits(payment.amount.toString(), 18)
//         );

//         updateModal(modal, 'Waiting for blockchain confirmation…');

//         await tx.wait(1);

//         await verifyTx(payment.id, tx.hash, modal);

//         return { success: true };
//     } catch (err) {
//         updateModal(modal, err.message, true);
//         return { success: false };
//     }
// }

// /* ======================================================
//    TRON – USDT (TRC-20)
// ====================================================== */
// async function processTron(payment) {
//     const modal = showPaymentModal('TRON', payment.amount);

//     try {
//         if (!window.tronWeb || !window.tronWeb.ready) {
//             throw new Error('TronLink wallet not found');
//         }

//         const contract = await window.tronWeb.contract().at(payment.token);
//         const amount = Math.floor(payment.amount * 1e6);

//         updateModal(modal, 'Confirm transfer in TronLink…');

//         const tx = await contract
//             .transfer(payment.recipient_address, amount)
//             .send();

//         await verifyTx(payment.id, tx, modal);

//         return { success: true };
//     } catch (err) {
//         updateModal(modal, err.message, true);
//         return { success: false };
//     }
// }

// /* ======================================================
//    AUTO VERIFY TX HASH (LOCKS VOTES UNTIL CONFIRMED)
// ====================================================== */
// async function verifyTx(paymentId, txHash, modal) {
//     updateModal(modal, 'Verifying transaction…');

//     const res = await fetch('/api/onedream/verify-crypto-payment', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ paymentId, txHash })
//     });

//     const data = await res.json();

//     if (!data.success) {
//         updateModal(modal, 'Verification pending. You can retry later.');
//         showManualVerify(modal, paymentId);
//         return;
//     }

//     updateModal(modal, '✅ Payment confirmed!');
//     setTimeout(() => modal.remove(), 2000);
// }

// /* ======================================================
//    NETWORK SELECTION MODAL
// ====================================================== */
// function showNetworkSelectionModal() {
//     return new Promise(resolve => {
//         const modal = document.createElement('div');
//         modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';

//         modal.innerHTML = `
//         <div class="bg-white p-6 rounded-2xl w-[90%] max-w-md relative">
//             <button class="absolute top-3 right-4 text-xl" id="close">✖</button>
//             <h3 class="text-lg font-bold mb-4 text-center">Choose USDT Network</h3>
//             <button id="bsc" class="w-full bg-yellow-400 py-3 rounded-xl mb-3 font-bold">
//                 BSC (BEP-20)
//             </button>
//             <button id="tron" class="w-full bg-red-600 text-white py-3 rounded-xl font-bold">
//                 TRON (TRC-20)
//             </button>
//         </div>`;

//         document.body.appendChild(modal);

//         modal.querySelector('#close').onclick = () => {
//             modal.remove();
//             resolve(null);
//         };
//         modal.querySelector('#bsc').onclick = () => {
//             modal.remove();
//             resolve('bsc');
//         };
//         modal.querySelector('#tron').onclick = () => {
//             modal.remove();
//             resolve('tron');
//         };
//     });
// }

// /* ======================================================
//    PAYMENT STATUS MODAL
// ====================================================== */
// function showPaymentModal(network, amount) {
//     const modal = document.createElement('div');
//     modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';

//     modal.innerHTML = `
//     <div class="bg-white p-8 rounded-2xl w-[95%] max-w-lg text-center relative">
//         <button class="absolute top-3 right-4 text-xl" onclick="this.closest('.fixed').remove()">✖</button>
//         <h3 class="text-xl font-bold mb-2">${network} Payment</h3>
//         <p class="text-2xl font-bold mb-4">${amount} USDT</p>
//         <p id="status">Initializing…</p>
//     </div>`;

//     document.body.appendChild(modal);
//     return modal;
// }

// function updateModal(modal, text, error = false) {
//     const p = modal.querySelector('#status');
//     p.textContent = text;
//     p.style.color = error ? 'red' : 'black';
// }

// /* ======================================================
//    MANUAL "I’VE PAID" FALLBACK
// ====================================================== */
// function showManualVerify(modal, paymentId) {
//     const p = modal.querySelector('#status');
//     p.innerHTML += `
//         <div class="mt-4">
//             <input id="txHashInput" class="border p-2 w-full" placeholder="Paste TX hash" />
//             <button class="mt-2 bg-blue-600 text-white px-4 py-2 rounded"
//                 onclick="manualVerify('${paymentId}')">
//                 I've Paid
//             </button>
//         </div>`;
// }

// window.manualVerify = async function (paymentId) {
//     const txHash = document.getElementById('txHashInput').value;
//     await verifyTx(paymentId, txHash, document.body);
// };
/**
 * 🪙 CRYPTO PAYMENTS MODULE
 * File: /public/js/crypto-payments.js
 */

console.log('🪙 Crypto Payments Module Loaded');

window.processCryptoPayment = processCryptoPayment;

/* ======================================================
   ENTRY POINT CALLED BY vote-payments.js
====================================================== */
async function processCryptoPayment() {
    const participant = window.currentParticipant;
    const votes = window.selectedVoteAmount;

    if (!participant || !votes) {
        alert('Participant or vote amount missing');
        return { success: false };
    }

    const network = await showNetworkSelectionModal();
    if (!network) return { success: false };

    // 1️⃣ Init backend record (LOCK VOTES)
    let payment;
    try {
        const initRes = await fetch('/api/onedream/init-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                participant_id: participant.id,
                vote_count: votes,
                network
            })
        });

        payment = await initRes.json();
    } catch (err) {
        alert('Failed to initialize crypto payment: ' + err.message);
        return { success: false };
    }

    if (!payment?.id) {
        alert('Failed to initialize crypto payment');
        return { success: false };
    }

    // 2️⃣ Route by network
    if (network === 'bsc') return await processBSC(payment);
    if (network === 'tron') return await processTron(payment);

    return { success: false };
}

/* ======================================================
   BSC – USDT (BEP-20)
====================================================== */
async function processBSC(payment) {
    const modal = showPaymentModal('BSC', payment.amount);

    try {
        if (!window.ethereum) throw new Error('No wallet detected');

        const provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = provider.getSigner();

        const usdt = new ethers.Contract(
            payment.token,
            ['function transfer(address,uint256) returns (bool)'],
            signer
        );

        updateModal(modal, 'Confirm USDT transfer in wallet…');

        const tx = await usdt.transfer(
            payment.recipient_address,
            ethers.utils.parseUnits(payment.amount.toString(), 18)
        );

        updateModal(modal, 'Waiting for blockchain confirmation…');

        await tx.wait(1);

        await verifyTx(payment.id, tx.hash, modal);

        return { success: true };
    } catch (err) {
        updateModal(modal, err.message, true);
        showManualVerify(modal, payment.id);
        return { success: false };
    }
}

/* ======================================================
   TRON – USDT (TRC-20)
====================================================== */
async function processTron(payment) {
    const modal = showPaymentModal('TRON', payment.amount);

    try {
        if (!window.tronWeb || !window.tronWeb.ready) {
            throw new Error('TronLink wallet not found');
        }

        const contract = await window.tronWeb.contract().at(payment.token);
        const amount = Math.floor(payment.amount * 1e6);

        updateModal(modal, 'Confirm transfer in TronLink…');

        const tx = await contract
            .transfer(payment.recipient_address, amount)
            .send();

        await verifyTx(payment.id, tx, modal);

        return { success: true };
    } catch (err) {
        updateModal(modal, err.message, true);
        showManualVerify(modal, payment.id);
        return { success: false };
    }
}

/* ======================================================
   AUTO VERIFY TX HASH (LOCKS VOTES UNTIL CONFIRMED)
====================================================== */
async function verifyTx(paymentId, txHash, modal) {
    updateModal(modal, 'Verifying transaction…');

    try {
        const res = await fetch('/api/onedream/verify-crypto-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId, txHash })
        });

        const data = await res.json();

        if (!data.success) {
            updateModal(modal, 'Verification pending. You can retry manually.', true);
            showManualVerify(modal, paymentId);
            return;
        }

        updateModal(modal, '✅ Payment confirmed!');
        setTimeout(() => modal.remove(), 2000);
    } catch (err) {
        updateModal(modal, 'Verification failed. Try manual input.', true);
        showManualVerify(modal, paymentId);
    }
}

/* ======================================================
   NETWORK SELECTION MODAL
====================================================== */
function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4';

        modal.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-full max-w-md relative shadow-lg">
            <button class="absolute top-3 right-4 text-xl font-bold" id="close">✖</button>
            <h3 class="text-lg font-bold mb-4 text-center">Choose USDT Network</h3>
            <button id="bsc" class="w-full bg-yellow-400 py-3 rounded-xl mb-3 font-bold">
                BSC (BEP-20)
            </button>
            <button id="tron" class="w-full bg-red-600 text-white py-3 rounded-xl font-bold">
                TRON (TRC-20)
            </button>
        </div>`;

        document.body.appendChild(modal);

        modal.querySelector('#close').onclick = () => { modal.remove(); resolve(null); };
        modal.querySelector('#bsc').onclick = () => { modal.remove(); resolve('bsc'); };
        modal.querySelector('#tron').onclick = () => { modal.remove(); resolve('tron'); };
    });
}

/* ======================================================
   PAYMENT STATUS MODAL
====================================================== */
function showPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';

    modal.innerHTML = `
    <div class="bg-white p-8 rounded-2xl w-full max-w-lg text-center relative shadow-lg">
        <button class="absolute top-3 right-4 text-xl font-bold" onclick="this.closest('.fixed').remove()">✖</button>
        <h3 class="text-xl font-bold mb-2">${network} Payment</h3>
        <p class="text-2xl font-bold mb-4">${amount} USDT</p>
        <p id="status">Initializing…</p>
    </div>`;

    document.body.appendChild(modal);
    return modal;
}

function updateModal(modal, text, error = false) {
    const p = modal.querySelector('#status');
    p.textContent = text;
    p.style.color = error ? 'red' : 'black';
}

/* ======================================================
   MANUAL "I’VE PAID" FALLBACK
====================================================== */
function showManualVerify(modal, paymentId) {
    const p = modal.querySelector('#status');
    p.innerHTML += `
        <div class="mt-4">
            <input id="txHashInput" class="border p-2 w-full rounded mb-2" placeholder="Paste TX hash" />
            <button class="mt-2 bg-blue-600 text-white px-4 py-2 rounded"
                onclick="manualVerify('${paymentId}')">
                I've Paid
            </button>
        </div>`;
}

window.manualVerify = async function(paymentId) {
    const txHash = document.getElementById('txHashInput')?.value;
    if (!txHash) return alert('Enter TX hash');
    const modal = document.querySelector('.fixed');
    await verifyTx(paymentId, txHash, modal);
};
