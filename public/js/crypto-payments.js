/* ======================================================
    📱 UTILS & DETECTION
====================================================== */
const isMobile = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

/* ======================================================
    🔒 WALLETCONNECT LOADER (v2)
====================================================== */
async function loadWalletConnect() {
  if (window.EthereumProvider) return;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* ======================================================
    🟡 BSC – USDT (BEP-20 via WalletConnect)
====================================================== */
async function processBSCWalletConnect(init) {
  const modal = showPaymentStatusModal("BSC", init.amount);

  try {
    await loadWalletConnect();

    const provider = await window.EthereumProvider.init({
      projectId: window.WALLETCONNECT_PROJECT_ID,

      chains: [56], // ✅ REQUIRED (not optional)
      optionalChains: [1, 137],

      rpcMap: {
        56: "https://bsc-dataseed.binance.org/"
      },

      metadata: {
        name: "OneDream Voting",
        description: "Secure Crypto Payment",
        url: window.location.origin,
        icons: ["https://avatars.githubusercontent.com/u/37784886"]
      },

      showQrModal: true,
      qrModalOptions: { themeMode: "dark" }
    });

    updateStatus(modal, "Connecting wallet…");

    // ❌ NEVER auto-disconnect here — breaks mobile wallets
    await provider.connect();

    /* ---------- ethers v5 / v6 compatibility ---------- */
    const ethersLib = window.ethers;
    let signer;

    if (ethersLib.providers) {
      // ethers v5
      const ethersProvider = new ethersLib.providers.Web3Provider(provider);
      signer = ethersProvider.getSigner();
    } else {
      // ethers v6
      const ethersProvider = new ethersLib.BrowserProvider(provider);
      signer = await ethersProvider.getSigner();
    }

    updateStatus(modal, "Requesting USDT transfer…");

    const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
    const abi = ["function transfer(address,uint256) returns (bool)"];
    const usdt = new ethersLib.Contract(usdtAddress, abi, signer);

    const amountWei = ethersLib.utils
      ? ethersLib.utils.parseUnits(init.amount.toString(), 18)
      : ethersLib.parseUnits(init.amount.toString(), 18);

    const tx = await usdt.transfer(init.recipient_address, amountWei);

    updateStatus(modal, "Confirming on-chain…");
    await tx.wait(1);

    successStatus(modal);
    return finalize(tx.hash, "bsc");
  } catch (err) {
    console.error(err);
    errorStatus(modal, err?.message || "User cancelled");
    return { success: false };
  }
}

/* ======================================================
    🔴 TRON – USDT (TRC-20)
====================================================== */
async function processTron(init) {
  if (window.tronWeb && window.tronWeb.ready) {
    const modal = showPaymentStatusModal("TRON", init.amount);

    try {
      updateStatus(modal, "Connecting to contract…");

      const contract = await window.tronWeb
        .contract()
        .at("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");

      const amountSun = Math.floor(init.amount * 1_000_000);

      updateStatus(modal, "Confirm in wallet…");

      const tx = await contract
        .transfer(init.recipient_address, amountSun)
        .send();

      const txHash = typeof tx === "string" ? tx : tx.txid;

      successStatus(modal);
      return finalize(txHash, "tron");
    } catch (err) {
      errorStatus(modal, err?.message || "Transaction failed");
      return { success: false };
    }
  }

  // Not inside TronLink / Tron browser
  return showTronManualModal(init);
}

/* ======================================================
    🧩 UI HELPERS
====================================================== */
function successStatus(modal) {
  const status = modal.querySelector("#statusText");
  status.innerHTML = `<b style="color:#059669">✅ Payment Confirmed!</b>`;
  modal.querySelector(".loading-spinner")?.remove();
  setTimeout(() => modal.remove(), 3000);
}

function errorStatus(modal, msg) {
  const status = modal.querySelector("#statusText");
  status.innerHTML = `
    <b style="color:#dc2626">❌ Error</b><br/>
    <small>${String(msg).slice(0, 80)}</small>
  `;
  modal.querySelector(".loading-spinner")?.remove();

  const closeBtn = document.createElement("button");
  closeBtn.className = "mt-4 text-xs text-gray-400 underline";
  closeBtn.innerText = "Dismiss";
  closeBtn.onclick = () => modal.remove();
  modal.querySelector("div").appendChild(closeBtn);
}
