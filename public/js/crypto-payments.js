/**
 * CRYPTO PAYMENT ENGINE
 */

console.log('🪙 Crypto module loaded');

async function processCryptoPayment() {
    const network = await showNetworkSelectionModal();
    if (!network) return { success: false };

    const init = await fetch('/api/onedream/init-crypto-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            participant_id: window.currentParticipant.id,
            vote_count: window.selectedVoteAmount,
            network
        })
    }).then(r => r.json());

    if (network === 'bsc') return processBSC(init);
    if (network === 'tron') return processTron(init);

    return { success: false };
}

async function processBSC(data) {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = provider.getSigner();

    const usdt = new ethers.Contract(
        data.token,
        ['function transfer(address,uint256) returns (bool)'],
        signer
    );

    const tx = await usdt.transfer(
        data.recipient_address,
        ethers.utils.parseUnits(data.amount.toString(), 18)
    );

    await tx.wait(1);

    return {
        success: true,
        payment_method: 'crypto',
        payment_reference: tx.hash
    };
}

async function processTron(data) {
    const contract = await tronWeb.contract().at(data.token);
    const tx = await contract.transfer(
        data.recipient_address,
        Math.floor(data.amount * 1e6)
    ).send();

    return {
        success: true,
        payment_method: 'crypto',
        payment_reference: tx
    };
}

// minimal modal
function showNetworkSelectionModal() {
    return new Promise(res => {
        const m = document.createElement('div');
        m.innerHTML = `<button id="bsc">BSC</button><button id="tron">TRON</button>`;
        document.body.appendChild(m);
        m.querySelector('#bsc').onclick = () => { m.remove(); res('bsc'); };
        m.querySelector('#tron').onclick = () => { m.remove(); res('tron'); };
    });
}

window.processCryptoPayment = processCryptoPayment;
