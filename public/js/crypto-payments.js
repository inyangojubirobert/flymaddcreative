/* ======================================================
   🪙 CRYPTO PAYMENTS MODULE (BSC + TRON)
   Client-only – SAFE for Next.js / Vercel
====================================================== */

(function () {
  if (typeof window === 'undefined') return;

  /* ================= CONFIG ================= */

  const APP = window.APP_CONFIG || {};

  const CONFIG = {
    BSC: {
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      CHAIN_ID: 56,
      RPC: APP.BSC_RPC_URL || "https://bsc-dataseed.binance.org/",
      WALLET: APP.BSC_WALLET,
      EXPLORER: "https://bscscan.com/tx/"
    },
    TRON: {
      USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      WALLET: APP.TRON_WALLET,
      EXPLORER: "https://tronscan.org/#/transaction/"
    },
    WC: {
      PROJECT_ID: APP.WALLETCONNECT_PROJECT_ID,
      SRC: "https://unpkg.com/@walletconnect/ethereum-provider@2.10.1/dist/index.umd.js"
    },
    LIMITS: {
      MAX_ATTEMPTS: 3,
      WINDOW_MS: 5 * 60 * 1000
    }
  };

  if (!CONFIG.WC.PROJECT_ID) {
    console.warn("⚠️ WalletConnect projectId missing");
  }

  /* ================= ERRORS ================= */

  class PaymentError extends Error {
    constructor(msg, code) {
      super(msg);
      this.code = code;
    }
  }

  /* ================= STATE ================= */

  const attempts = new Map();

  function rateLimit(id) {
    const now = Date.now();
    const list = (attempts.get(id) || []).filter(t => now - t < CONFIG.LIMITS.WINDOW_MS);
    if (list.length >= CONFIG.LIMITS.MAX_ATTEMPTS) {
      throw new PaymentError("Too many attempts. Try again later.", "RATE_LIMIT");
    }
    list.push(now);
    attempts.set(id, list);
  }

  /* ================= UTILS ================= */

  const isMobile = () =>
    /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  /* ================= WALLETCONNECT ================= */

  async function loadWalletConnect() {
    if (window.EthereumProvider) return window.EthereumProvider;
    await loadScript(CONFIG.WC.SRC);
    if (!window.EthereumProvider) {
      throw new PaymentError("WalletConnect failed to load", "PROVIDER");
    }
    return window.EthereumProvider;
  }

  async function connectWalletConnect() {
    const Provider = await loadWalletConnect();
    const provider = await Provider.init({
      projectId: CONFIG.WC.PROJECT_ID,
      chains: [CONFIG.BSC.CHAIN_ID],
      showQrModal: true
    });
    await provider.connect();
    return provider;
  }

  /* ================= NETWORK ================= */

  async function ensureBSC(provider) {
    const net = await provider.getNetwork();
    if (net.chainId === CONFIG.BSC.CHAIN_ID) return;

    await provider.provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x38" }]
    });
  }

  /* ================= BACKEND ================= */

  async function initPayment(participantId, votes, network) {
    const res = await fetch("/api/onedream/init-crypto-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: participantId, vote_count: votes, network })
    });
    if (!res.ok) throw new PaymentError("Backend init failed", "API");
    return res.json();
  }

  async function finalize(txHash, network) {
    const res = await fetch("/api/onedream/finalize-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_hash: txHash, network })
    });
    if (!res.ok) throw new PaymentError("Finalize failed", "API");
    return res.json();
  }

  /* ================= UI ================= */

  function modal(html) {
    const m = document.createElement("div");
    m.className = "fixed inset-0 bg-black/80 flex items-center justify-center z-50";
    m.innerHTML = html;
    document.body.appendChild(m);
    return m;
  }

  function statusModal(net, amt) {
    return modal(`
      <div class="bg-white p-6 rounded-xl w-80 text-center">
        <h3 class="font-bold mb-2">${net} Payment</h3>
        <p class="text-xl mb-3">${amt} USDT</p>
        <p id="status">Initializing…</p>
      </div>
    `);
  }

  /* ================= PAYMENTS ================= */

  async function payBSC(init) {
    let provider;

    if (window.ethereum && !isMobile()) {
      provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
    } else {
      const wc = await connectWalletConnect();
      provider = new ethers.providers.Web3Provider(wc);
    }

    await ensureBSC(provider);
    const signer = provider.getSigner();

    const usdt = new ethers.Contract(
      CONFIG.BSC.USDT,
      ["function transfer(address,uint256) returns (bool)"],
      signer
    );

    const tx = await usdt.transfer(
      init.recipient_address,
      ethers.utils.parseUnits(init.amount.toString(), 18)
    );

    await tx.wait(1);

    return { hash: tx.hash, explorer: CONFIG.BSC.EXPLORER + tx.hash };
  }

  async function payTron(init) {
    if (!window.tronWeb || !window.tronWeb.ready) {
      throw new PaymentError("TronLink not available", "TRON");
    }

    const c = await tronWeb.contract().at(CONFIG.TRON.USDT);
    const tx = await c
      .transfer(init.recipient_address, Math.floor(init.amount * 1e6))
      .send();

    return { hash: tx, explorer: CONFIG.TRON.EXPLORER + tx };
  }

  /* ================= MAIN ================= */

  async function processCryptoPayment() {
    try {
      const pid = window.currentParticipant?.id;
      const votes = window.selectedVoteAmount;

      if (!pid || !votes) throw new PaymentError("Invalid input", "INPUT");
      rateLimit(pid);

      const net = prompt("Choose network: bsc or tron")?.toLowerCase();
      if (!net) return { success: false, cancelled: true };

      const init = await initPayment(pid, votes, net);
      const m = statusModal(net.toUpperCase(), init.amount);

      let result;
      if (net === "bsc") result = await payBSC(init);
      else if (net === "tron") result = await payTron(init);
      else throw new PaymentError("Unsupported network", "NET");

      m.querySelector("#status").textContent = "✅ Confirmed";
      setTimeout(() => m.remove(), 2000);

      await finalize(result.hash, net);
      return { success: true, txHash: result.hash };

    } catch (e) {
      console.error("❌ Crypto error:", e);
      alert(e.message || "Payment failed");
      return { success: false, error: e.message };
    }
  }

  /* ================= INIT ================= */

  async function boot() {
    if (!window.ethers) {
      await loadScript("https://cdn.ethers.io/lib/ethers-5.7.2.min.js");
    }
    window.processCryptoPayment = processCryptoPayment;
    console.log("🪙 Crypto Payments Ready");
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", boot)
    : boot();

})();

