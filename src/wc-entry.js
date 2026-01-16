// Entry point to bundle WalletConnect provider and ethers for browser usage
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import * as ethers from 'ethers';

// Expose to window for legacy scripts
window.EthereumProvider = EthereumProvider;
window.ethers = ethers;

console.log('✅ WalletConnect + ethers bundle initialized');
