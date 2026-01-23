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
    const initRes = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: participant.id,
            vote_count: votes,
            network
        })
    });

    const payment = await initRes.json();
    if (!payment?.id) {
        alert('Failed to initialize crypto payment');
        return { success: false };
    }

    // 2️⃣ Route by network
    if (network === 'bsc') {
        return await processBSC(payment);
    }

    if (network === 'tron') {
        return await processTron(payment);
    }

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
        return { success: false };
    }
}

/* ======================================================
   AUTO VERIFY TX HASH (LOCKS VOTES UNTIL CONFIRMED)
====================================================== */
async function verifyTx(paymentId, txHash, modal) {
    updateModal(modal, 'Verifying transaction…');

    const res = await fetch('/api/onedream/verify-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId, txHash })
    });

    const data = await res.json();

    if (!data.success) {
        updateModal(modal, 'Verification pending. You can retry later.');
        showManualVerify(modal, paymentId);
        return;
    }

    updateModal(modal, '✅ Payment confirmed!');
    setTimeout(() => modal.remove(), 2000);
}

/* ======================================================
   NETWORK SELECTION MODAL
====================================================== */
function showNetworkSelectionModal() {
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';

        modal.innerHTML = `
        <div class="bg-white p-6 rounded-2xl w-[90%] max-w-md relative">
            <button class="absolute top-3 right-4 text-xl" id="close">✖</button>
            <h3 class="text-lg font-bold mb-4 text-center">Choose USDT Network</h3>
            <button id="bsc" class="w-full bg-yellow-400 py-3 rounded-xl mb-3 font-bold">
                BSC (BEP-20)
            </button>
            <button id="tron" class="w-full bg-red-600 text-white py-3 rounded-xl font-bold">
                TRON (TRC-20)
            </button>
        </div>`;

        document.body.appendChild(modal);

        modal.querySelector('#close').onclick = () => {
            modal.remove();
            resolve(null);
        };
        modal.querySelector('#bsc').onclick = () => {
            modal.remove();
            resolve('bsc');
        };
        modal.querySelector('#tron').onclick = () => {
            modal.remove();
            resolve('tron');
        };
    });
}

/* ======================================================
   PAYMENT STATUS MODAL
====================================================== */
function showPaymentModal(network, amount) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50';

    modal.innerHTML = `
    <div class="bg-white p-8 rounded-2xl w-[95%] max-w-lg text-center relative">
        <button class="absolute top-3 right-4 text-xl" onclick="this.closest('.fixed').remove()">✖</button>
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
            <input id="txHashInput" class="border p-2 w-full" placeholder="Paste TX hash" />
            <button class="mt-2 bg-blue-600 text-white px-4 py-2 rounded"
                onclick="manualVerify('${paymentId}')">
                I've Paid
            </button>
        </div>`;
}

window.manualVerify = async function (paymentId) {
    const txHash = document.getElementById('txHashInput').value;
    await verifyTx(paymentId, txHash, document.body);
};
