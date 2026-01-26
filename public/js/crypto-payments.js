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
  if (window.EthereumProvider) return window.EthereumProvider;

  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });

  return window.EthereumProvider;
}

/* ======================================================
    🟡 BSC – USDT (BEP-20 via WalletConnect)
====================================================== */
async function processBSCWalletConnect(init) {
  // Wait until Ethers.js is loaded
  if (!window.ethers) {
    console.error("Ethers.js not loaded yet");
    return { success: false, error: "Ethers.js not loaded" };
  }

  const modal = showPaymentStatusModal("BSC", init.amount);

  try {
    const provider = await loadWalletConnect();

    const wcProvider = await provider.init({
      projectId: window.WALLETCONNECT_PROJECT_ID,
      chains: [56],
      rpcMap: { 56: "https://bsc-dataseed.binance.org/" },
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
    await wcProvider.connect();

    // Ethers v5 / v6 compatibility
    const ethersLib = window.ethers;
    let signer;
    if (ethersLib.providers) {
      signer = new ethersLib.providers.Web3Provider(wcProvider).getSigner();
    } else {
      signer = await new ethersLib.BrowserProvider(wcProvider).getSigner();
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
      const contract = await window.tronWeb.contract().at(
        "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
      );
      const amountSun = Math.floor(init.amount * 1_000_000);

      updateStatus(modal, "Confirm in wallet…");
      const tx = await contract.transfer(init.recipient_address, amountSun).send();
      const txHash = typeof tx === "string" ? tx : tx.txid;

      successStatus(modal);
      return finalize(txHash, "tron");
    } catch (err) {
      errorStatus(modal, err?.message || "Transaction failed");
      return { success: false };
    }
  }

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
  status.innerHTML = `<b style="color:#dc2626">❌ Error</b><br/><small>${String(msg).slice(
    0,
    80
  )}</small>`;
  modal.querySelector(".loading-spinner")?.remove();

  const closeBtn = document.createElement("button");
  closeBtn.className = "mt-4 text-xs text-gray-400 underline";
  closeBtn.innerText = "Dismiss";
  closeBtn.onclick = () => modal.remove();
  modal.querySelector("div").appendChild(closeBtn);
}

function updateStatus(modal, text) {
  if (!modal) return;
  const statusEl = modal.querySelector("#statusText");
  if (!statusEl) return;
  statusEl.textContent = text;
}

/* ======================================================
    🔑 CRYPTO MODULE READINESS & EXPORTS
====================================================== */
async function initCryptoModule() {
  // Wait until WalletConnect and Ethers.js are loaded
  await loadWalletConnect();

  if (!window.ethers) {
    // Load Ethers.js dynamically if missing
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js";
    await new Promise((resolve, reject) => {
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  window.cryptoModuleReady = true;

  // Export functions globally
  window.processBSCWalletConnect = processBSCWalletConnect;
  window.processTron = processTron;
  window.loadWalletConnect = loadWalletConnect;
}

// Initialize module on page load
initCryptoModule().catch(console.error);
