// WalletConnect integration for crypto payments
// Supports Trust Wallet, MetaMask, and other Web3 wallets

import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { ethers } from 'ethers';

// Network configurations
const NETWORKS = {
  bsc: {
    chainId: 56,
    name: 'BNB Smart Chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    currency: 'BNB',
    explorer: 'https://bscscan.com',
    usdtAddress: '0x55d398326f99059fF775485246999027B3197955', // USDT on BSC (18 decimals)
    usdtDecimals: 18,
    type: 'evm' // EVM-compatible (uses WalletConnect)
  },
  tron: {
    chainId: null, // Tron doesn't use chain ID like EVM
    name: 'Tron Network',
    rpcUrl: 'https://api.trongrid.io',
    currency: 'TRX',
    explorer: 'https://tronscan.org',
    usdtAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', // USDT on Tron (TRC-20, 6 decimals)
    usdtDecimals: 6,
    type: 'tron' // Uses TronLink
  }
};

let provider = null;
let walletAddress = null;

/**
 * Initialize WalletConnect
 */
export async function initWalletConnect() {
  try {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
    const network = process.env.NEXT_PUBLIC_CRYPTO_NETWORK || 'bsc';
    const chainId = parseInt(process.env.NEXT_PUBLIC_CRYPTO_CHAIN_ID || '56');

    if (!projectId) {
      throw new Error('WalletConnect Project ID not configured');
    }

    provider = await EthereumProvider.init({
      projectId,
      chains: [chainId],
      showQrModal: true,
      qrModalOptions: {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-z-index': '9999'
        }
      },
      metadata: {
        name: 'One Dream Initiative',
        description: 'Vote with Crypto - Support Dreams',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://flymaddcreative.vercel.app',
        icons: ['https://flymaddcreative.vercel.app/logo.png']
      }
    });

    // Listen for connection
    provider.on('display_uri', (uri) => {
      console.log('WalletConnect URI:', uri);
    });

    provider.on('connect', ({ chainId }) => {
      console.log('Wallet connected, chainId:', chainId);
    });

    provider.on('disconnect', () => {
      console.log('Wallet disconnected');
      walletAddress = null;
    });

    return provider;
  } catch (error) {
    console.error('WalletConnect initialization error:', error);
    throw error;
  }
}

/**
 * Connect wallet
 */
export async function connectWallet() {
  try {
    if (!provider) {
      await initWalletConnect();
    }

    await provider.connect();
    const accounts = await provider.request({ method: 'eth_accounts' });
    
    if (accounts && accounts.length > 0) {
      walletAddress = accounts[0];
      return walletAddress;
    }

    throw new Error('No accounts found');
  } catch (error) {
    console.error('Wallet connection error:', error);
    throw error;
  }
}

/**
 * Send crypto payment
 */
export async function sendCryptoPayment(amountUSD, recipientAddress) {
  try {
    if (!provider || !walletAddress) {
      throw new Error('Wallet not connected');
    }

    const network = NETWORKS[process.env.NEXT_PUBLIC_CRYPTO_NETWORK || 'bsc'];
    
    // Convert USD to USDT (using correct decimals for network)
    const amountInWei = ethers.parseUnits(amountUSD.toString(), network.usdtDecimals);

    // USDT Transfer
    const usdtInterface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)'
    ]);

    const data = usdtInterface.encodeFunctionData('transfer', [
      recipientAddress,
      amountInWei
    ]);

    const txParams = {
      from: walletAddress,
      to: network.usdtAddress,
      data: data,
      value: '0x0'
    };

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams]
    });

    return {
      txHash,
      network: network.name,
      explorer: `${network.explorer}/tx/${txHash}`
    };
  } catch (error) {
    console.error('Payment error:', error);
    throw error;
  }
}

/**
 * Send native crypto (MATIC, BNB, ETH)
 */
export async function sendNativeCrypto(amountUSD, recipientAddress) {
  try {
    if (!provider || !walletAddress) {
      throw new Error('Wallet not connected');
    }

    const network = NETWORKS[process.env.NEXT_PUBLIC_CRYPTO_NETWORK || 'polygon'];
    
    // Approximate conversion (should use price oracle in production)
    const cryptoPrices = {
      polygon: 0.85, // MATIC ~ $0.85
      bsc: 600,      // BNB ~ $600
      ethereum: 3500 // ETH ~ $3500
    };

    const price = cryptoPrices[process.env.NEXT_PUBLIC_CRYPTO_NETWORK] || 1;
    const amountInCrypto = amountUSD / price;
    const amountInWei = ethers.parseEther(amountInCrypto.toFixed(8));

    const txParams = {
      from: walletAddress,
      to: recipientAddress,
      value: '0x' + amountInWei.toString(16)
    };

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams]
    });

    return {
      txHash,
      network: network.name,
      amount: amountInCrypto.toFixed(6),
      currency: network.currency,
      explorer: `${network.explorer}/tx/${txHash}`
    };
  } catch (error) {
    console.error('Native payment error:', error);
    throw error;
  }
}

/**
 * Disconnect wallet
 */
export async function disconnectWallet() {
  try {
    if (provider) {
      await provider.disconnect();
      walletAddress = null;
    }
  } catch (error) {
    console.error('Disconnect error:', error);
  }
}

/**
 * Get connected wallet address
 */
export function getWalletAddress() {
  return walletAddress;
}

/**
 * Check if wallet is connected
 */
export function isWalletConnected() {
  return !!walletAddress && !!provider;
}
