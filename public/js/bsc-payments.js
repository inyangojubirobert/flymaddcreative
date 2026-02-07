// ======================================================
// 🚀 COMPLETE BSC USDT DESKTOP PAYMENT SCRIPT
// ======================================================

(function() {
    'use strict';
    
    // ✅ Configuration
    const CONFIG = {
        BSC_USDT_ADDRESS: "0x55d398326f99059fF775485246999027B3197955",
        BSC_CHAIN_ID: 56,
        BSC_RPC: "https://bsc-dataseed.binance.org/",
        EXPLORER_URL: "https://bscscan.com/tx/",
        RECIPIENT_ADDRESS: "0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d", // Replace with your address
        DECIMALS: 18
    };

    // ✅ Load dependencies
    function loadDependencies() {
        return new Promise((resolve, reject) => {
            // Check if ethers.js is loaded
            if (typeof ethers === 'undefined') {
                const ethersScript = document.createElement('script');
                ethersScript.src = 'https://cdn.ethers.io/lib/ethers-5.7.umd.min.js';
                ethersScript.crossOrigin = 'anonymous';
                ethersScript.onload = () => {
                    console.log('✅ Ethers.js loaded');
                    loadQRCode();
                };
                ethersScript.onerror = () => {
                    console.error('Failed to load ethers.js');
                    reject(new Error('Failed to load ethers.js'));
                };
                document.head.appendChild(ethersScript);
            } else {
                loadQRCode();
            }

            function loadQRCode() {
                if (typeof QRCode !== 'undefined') {
                    resolve();
                    return;
                }
                
                const qrScript = document.createElement('script');
                qrScript.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
                qrScript.crossOrigin = 'anonymous';
                qrScript.onload = () => {
                    console.log('✅ QRCode.js loaded');
                    resolve();
                };
                qrScript.onerror = () => {
                    console.warn('QRCode.js failed to load, using fallback');
                    resolve(); // Still resolve
                };
                document.head.appendChild(qrScript);
            }
        });
    }

    // ✅ Inject CSS
    function injectStyles() {
        if (document.getElementById('bsc-payment-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'bsc-payment-styles';
        style.textContent = `
            .bsc-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.2s ease-out;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            .bsc-modal {
                background: white;
                border-radius: 16px;
                width: 420px;
                max-width: 95vw;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                animation: slideUp 0.3s ease-out;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            
            @keyframes slideUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .bsc-modal-header {
                padding: 24px 24px 16px;
                border-bottom: 1px solid #e5e7eb;
                position: relative;
            }
            
            .bsc-modal-title {
                font-size: 20px;
                font-weight: 700;
                color: #111827;
                margin: 0;
            }
            
            .bsc-modal-subtitle {
                font-size: 14px;
                color: #6b7280;
                margin-top: 4px;
            }
            
            .bsc-modal-close {
                position: absolute;
                top: 20px;
                right: 20px;
                background: none;
                border: none;
                font-size: 24px;
                color: #6b7280;
                cursor: pointer;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            
            .bsc-modal-close:hover {
                background: #f3f4f6;
                color: #374151;
            }
            
            .bsc-modal-body {
                padding: 24px;
            }
            
            .bsc-amount-card {
                background: linear-gradient(135deg, #fef3c7, #fde68a);
                border-radius: 12px;
                padding: 24px;
                text-align: center;
                margin-bottom: 24px;
            }
            
            .bsc-amount {
                font-size: 36px;
                font-weight: 800;
                color: #92400e;
                line-height: 1;
                margin-bottom: 8px;
            }
            
            .bsc-amount-label {
                font-size: 14px;
                color: #92400e;
                opacity: 0.8;
                font-weight: 500;
            }
            
            .bsc-address-card {
                background: #f9fafb;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 24px;
                border: 1px solid #e5e7eb;
            }
            
            .bsc-address-label {
                font-size: 12px;
                color: #6b7280;
                font-weight: 500;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .bsc-address {
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
                font-size: 13px;
                word-break: break-all;
                color: #111827;
                line-height: 1.5;
                background: white;
                padding: 12px;
                border-radius: 6px;
                border: 1px solid #e5e7eb;
            }
            
            .bsc-qr-container {
                width: 220px;
                height: 220px;
                margin: 0 auto 20px;
                background: white;
                border-radius: 12px;
                padding: 16px;
                border: 1px solid #e5e7eb;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .bsc-qr-canvas {
                cursor: pointer;
                transition: transform 0.2s;
            }
            
            .bsc-qr-canvas:hover {
                transform: scale(1.03);
            }
            
            .bsc-action-buttons {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
                margin-bottom: 24px;
            }
            
            .bsc-btn {
                padding: 12px 16px;
                border-radius: 8px;
                border: none;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            
            .bsc-btn-primary {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: white;
            }
            
            .bsc-btn-primary:hover {
                background: linear-gradient(135deg, #d97706, #b45309);
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
            }
            
            .bsc-btn-secondary {
                background: #e5e7eb;
                color: #374151;
            }
            
            .bsc-btn-secondary:hover {
                background: #d1d5db;
            }
            
            .bsc-btn-success {
                background: #10b981;
                color: white;
            }
            
            .bsc-btn-success:hover {
                background: #059669;
            }
            
            .bsc-btn-danger {
                background: #ef4444;
                color: white;
            }
            
            .bsc-btn-danger:hover {
                background: #dc2626;
            }
            
            .bsc-btn-full {
                grid-column: 1 / -1;
            }
            
            .bsc-input {
                width: 100%;
                padding: 12px 16px;
                border: 1px solid #d1d5db;
                border-radius: 8px;
                font-size: 14px;
                margin-bottom: 16px;
                transition: all 0.2s;
                font-family: monospace;
                box-sizing: border-box;
            }
            
            .bsc-input:focus {
                outline: none;
                border-color: #f59e0b;
                box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
            }
            
            .bsc-loading {
                text-align: center;
                padding: 40px 20px;
            }
            
            .bsc-loading-spinner {
                width: 48px;
                height: 48px;
                border: 3px solid #f3f4f6;
                border-top-color: #f59e0b;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .bsc-loading-text {
                font-size: 16px;
                color: #374151;
                font-weight: 500;
            }
            
            .bsc-success {
                text-align: center;
                padding: 40px 20px;
            }
            
            .bsc-success-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }
            
            .bsc-success-text {
                font-size: 18px;
                color: #10b981;
                font-weight: 600;
                margin-bottom: 8px;
            }
            
            .bsc-tx-link {
                display: inline-block;
                margin-top: 16px;
                color: #3b82f6;
                text-decoration: none;
                font-size: 14px;
                font-weight: 500;
            }
            
            .bsc-tx-link:hover {
                text-decoration: underline;
            }
            
            .bsc-network-info {
                background: #fffbeb;
                border: 1px solid #fef3c7;
                border-radius: 8px;
                padding: 12px 16px;
                margin-bottom: 20px;
                font-size: 13px;
                color: #92400e;
            }
            
            .bsc-network-info strong {
                font-weight: 600;
            }
            
            .bsc-footer {
                text-align: center;
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid #e5e7eb;
            }
            
            .bsc-footer-text {
                font-size: 12px;
                color: #6b7280;
            }
            
            .bsc-step {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
                padding: 12px;
                background: #f9fafb;
                border-radius: 8px;
                border-left: 4px solid #f59e0b;
            }
            
            .bsc-step-number {
                background: #f59e0b;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                font-weight: 600;
                flex-shrink: 0;
            }
            
            .bsc-step-text {
                font-size: 13px;
                color: #374151;
                flex: 1;
            }
            
            .bsc-error {
                background: #fef2f2;
                border: 1px solid #fee2e2;
                border-radius: 8px;
                padding: 16px;
                margin-bottom: 20px;
                color: #dc2626;
                font-size: 14px;
                text-align: center;
            }
            
            .mt-2 { margin-top: 8px; }
            .mt-4 { margin-top: 16px; }
        `;
        document.head.appendChild(style);
    }

    // ✅ Show alert/notification
    function showAlert(message, type = 'info', duration = 5000) {
        const existingAlert = document.querySelector('.bsc-alert');
        if (existingAlert) existingAlert.remove();
        
        const alert = document.createElement('div');
        alert.className = `bsc-alert bsc-alert-${type}`;
        alert.innerHTML = `
            <div style="position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                       background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
                       color: white; padding: 12px 24px; border-radius: 8px; z-index: 10001;
                       font-size: 14px; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                ${message}
            </div>
        `;
        document.body.appendChild(alert);
        
        if (duration > 0) {
            setTimeout(() => {
                if (alert.parentNode) alert.remove();
            }, duration);
        }
    }

    // ✅ Create modal
    function createModal(content, onClose = null) {
        const overlay = document.createElement('div');
        overlay.className = 'bsc-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'bsc-modal';
        modal.innerHTML = content;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Close on backdrop click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.remove();
                if (onClose) onClose();
            }
        });
        
        return { overlay, modal };
    }

    // ✅ Generate QR code for BSC USDT payment
    function generateBSCQR(recipient, amount, element) {
        const amountWei = (amount * Math.pow(10, CONFIG.DECIMALS)).toString();
        
        // EIP-681 format for BSC USDT
        const qrData = `ethereum:${CONFIG.BSC_USDT_ADDRESS}@56/transfer?address=${recipient}&uint256=${amountWei}`;
        
        console.log('QR Data for BSC USDT:', {
            recipient: recipient,
            amount: amount,
            amountWei: amountWei,
            contract: CONFIG.BSC_USDT_ADDRESS,
            qrData: qrData
        });
        
        // Always use image-based QR for reliability
        showFallbackQR(element, recipient, amount, qrData);
    }

    function showFallbackQR(element, recipient, amount, qrData) {
        // Get parent container
        let container;
        if (element.tagName === 'CANVAS') {
            container = element.parentNode;
            container.innerHTML = ''; // Clear the canvas
        } else {
            container = element;
            container.innerHTML = '';
        }
        
        container.style.textAlign = 'center';
        
        // Use the EIP-681 data if provided, otherwise use simple text
        const dataToEncode = qrData || `${recipient}`;
        const encodedData = encodeURIComponent(dataToEncode);
        
        // Try multiple QR APIs for reliability
        const qrApis = [
            `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodedData}`,
            `https://quickchart.io/qr?text=${encodedData}&size=180`,
            `https://chart.googleapis.com/chart?chs=180x180&cht=qr&chl=${encodedData}`
        ];
        
        const img = document.createElement('img');
        img.alt = 'BSC USDT Payment QR Code';
        img.style.width = '180px';
        img.style.height = '180px';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        img.title = 'Click to copy payment details';
        
        let currentApiIndex = 0;
        
        function tryNextApi() {
            if (currentApiIndex >= qrApis.length) {
                // All APIs failed, show text fallback
                showTextFallback(container, recipient, amount);
                return;
            }
            
            img.src = qrApis[currentApiIndex];
            currentApiIndex++;
        }
        
        img.onload = function() {
            console.log('✅ QR code loaded successfully');
            // Add click to copy
            img.onclick = function() {
                const textToCopy = `Send ${amount} USDT (BEP-20) to: ${recipient}\nNetwork: BSC (Binance Smart Chain)`;
                navigator.clipboard.writeText(textToCopy)
                    .then(() => showAlert('Payment details copied!', 'success', 2000))
                    .catch(() => showAlert('Failed to copy', 'error'));
            };
        };
        
        img.onerror = function() {
            console.warn(`QR API ${currentApiIndex} failed, trying next...`);
            tryNextApi();
        };
        
        container.appendChild(img);
        tryNextApi();
    }
    
    function showTextFallback(container, recipient, amount) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 14px; color: #6b7280; margin-bottom: 12px;">📱 Scan QR unavailable</div>
                <div style="background: linear-gradient(135deg, #fef3c7, #fde68a); padding: 16px; border-radius: 8px; margin-bottom: 12px;">
                    <div style="font-size: 24px; font-weight: 700; color: #92400e;">${amount} USDT</div>
                    <div style="font-size: 12px; color: #92400e;">BEP-20 (BSC Network)</div>
                </div>
                <div style="font-size: 11px; background: #f3f4f6; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace;">
                    ${recipient}
                </div>
                <button onclick="navigator.clipboard.writeText('${recipient}').then(() => alert('Address copied!'))" 
                        style="margin-top: 12px; padding: 8px 16px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                    📋 Copy Address
                </button>
            </div>
        `;
    }

    // ✅ Check and switch to BSC network
    async function ensureBSCNetwork() {
        if (!window.ethereum) {
            throw new Error('MetaMask not installed. Please install MetaMask to proceed.');
        }
        
        try {
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            
            if (chainId !== '0x38') { // BSC mainnet chainId in hex
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: '0x38' }]
                    });
                } catch (switchError) {
                    // If chain is not added, add it
                    if (switchError.code === 4902) {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: '0x38',
                                chainName: 'Binance Smart Chain',
                                nativeCurrency: {
                                    name: 'BNB',
                                    symbol: 'BNB',
                                    decimals: 18
                                },
                                rpcUrls: [CONFIG.BSC_RPC],
                                blockExplorerUrls: ['https://bscscan.com/']
                            }]
                        });
                    } else {
                        throw switchError;
                    }
                }
            }
            return true;
        } catch (error) {
            console.error('Network switch error:', error);
            throw new Error('Failed to switch to BSC network. Please switch manually in MetaMask.');
        }
    }

    // ✅ Send USDT transaction via MetaMask
    async function sendUSDTTransaction(recipient, amount, fromAddress) {
        if (!window.ethereum) {
            throw new Error('MetaMask not available');
        }
        
        if (typeof ethers === 'undefined') {
            throw new Error('Ethers.js library not loaded');
        }
        
        try {
            const provider = new ethers.providers.Web3Provider(window.ethereum);
            const signer = provider.getSigner();
            
            // USDT Contract ABI (only transfer function)
            const usdtAbi = [
                "function transfer(address to, uint256 amount) public returns (bool)",
                "function balanceOf(address account) public view returns (uint256)"
            ];
            
            // Create contract instance
            const usdtContract = new ethers.Contract(CONFIG.BSC_USDT_ADDRESS, usdtAbi, signer);
            
            // Convert amount to wei (USDT has 18 decimals on BSC)
            const amountWei = ethers.utils.parseUnits(amount.toString(), CONFIG.DECIMALS);
            
            console.log('Sending USDT transaction:', {
                from: fromAddress,
                to: recipient,
                amount: amount,
                amountWei: amountWei.toString(),
                contract: CONFIG.BSC_USDT_ADDRESS
            });
            
            // Estimate gas
            const gasEstimate = await usdtContract.estimateGas.transfer(recipient, amountWei);
            const gasPrice = await provider.getGasPrice();
            
            console.log('Gas estimate:', gasEstimate.toString());
            console.log('Gas price:', gasPrice.toString());
            
            // Send transaction
            const tx = await usdtContract.transfer(recipient, amountWei, {
                gasLimit: gasEstimate.mul(120).div(100), // 20% extra
                gasPrice: gasPrice
            });
            
            console.log('Transaction sent:', tx.hash);
            
            // Wait for transaction confirmation
            const receipt = await tx.wait();
            
            return {
                success: true,
                txHash: tx.hash,
                explorerUrl: `${CONFIG.EXPLORER_URL}${tx.hash}`,
                receipt: receipt
            };
            
        } catch (error) {
            console.error('Transaction error:', error);
            
            if (error.code === 4001 || error.message.includes('user rejected')) {
                throw new Error('Transaction was rejected by user');
            }
            
            if (error.message.includes('insufficient funds') || error.message.includes('balance')) {
                throw new Error('Insufficient USDT balance for this transaction');
            }
            
            if (error.message.includes('gas')) {
                throw new Error('Transaction failed due to gas estimation error');
            }
            
            throw new Error('Transaction failed: ' + error.message);
        }
    }

    // ✅ Show payment modal
    async function showPaymentModal(amount, customRecipient = null) {
        await loadDependencies();
        
        return new Promise((resolve) => {
            const recipient = customRecipient || CONFIG.RECIPIENT_ADDRESS;
            
            const modalContent = `
                <div class="bsc-modal-header">
                    <button class="bsc-modal-close" id="modalClose">×</button>
                    <h2 class="bsc-modal-title">Pay with USDT (BSC)</h2>
                    <p class="bsc-modal-subtitle">Send ${amount} USDT on Binance Smart Chain</p>
                </div>
                
                <div class="bsc-modal-body">
                    <div class="bsc-amount-card">
                        <div class="bsc-amount">${amount} USDT</div>
                        <div class="bsc-amount-label">Amount to pay</div>
                    </div>
                    
                    <div class="bsc-network-info">
                        <strong>⚠️ Important:</strong> Send only USDT on <strong>BSC (BEP-20)</strong> network
                    </div>
                    
                    <div class="bsc-address-card">
                        <div class="bsc-address-label">Recipient Address (BSC)</div>
                        <div class="bsc-address" id="bscAddress">${recipient}</div>
                    </div>
                    
                    <div class="bsc-qr-container" id="bscQRCode">
                        <!-- QR code will be loaded here -->
                    </div>
                    
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">Scan with wallet app</div>
                        <div style="font-size: 12px; color: #9ca3af;">OR</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">1</div>
                        <div class="bsc-step-text">Copy the recipient address above</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">2</div>
                        <div class="bsc-step-text">Open your wallet (MetaMask, Trust Wallet, etc.)</div>
                    </div>
                    
                    <div class="bsc-step">
                        <div class="bsc-step-number">3</div>
                        <div class="bsc-step-text">Send <strong>${amount} USDT</strong> on <strong>BSC (BEP-20)</strong> network</div>
                    </div>
                    
                    <div class="bsc-action-buttons">
                        <button id="copyAddressBtn" class="bsc-btn bsc-btn-secondary">
                            <span>📋</span> Copy Address
                        </button>
                        <button id="viewExplorerBtn" class="bsc-btn bsc-btn-secondary">
                            <span>🔍</span> View on BscScan
                        </button>
                    </div>
                    
                    <button id="payWithMetaMaskBtn" class="bsc-btn bsc-btn-primary bsc-btn-full">
                        <span>🦊</span> Pay with MetaMask
                    </button>
                    
                    <div style="margin: 24px 0; text-align: center; position: relative;">
                        <div style="height: 1px; background: #e5e7eb;"></div>
                        <div style="display: inline-block; background: white; padding: 0 12px; position: relative; top: -10px; color: #6b7280; font-size: 12px;">
                            OR enter transaction hash
                        </div>
                    </div>
                    
                    <input type="text" 
                           id="txHashInput" 
                           placeholder="Paste transaction hash (0x...)" 
                           class="bsc-input">
                    
                    <button id="confirmPaymentBtn" class="bsc-btn bsc-btn-success bsc-btn-full">
                        ✅ I've Already Paid
                    </button>
                    
                    <div class="bsc-footer">
                        <p class="bsc-footer-text">
                            Transaction will be confirmed on BSC network. 
                            This may take 15-60 seconds.
                        </p>
                    </div>
                </div>
            `;
            
            const { overlay, modal } = createModal(modalContent, () => {
                resolve({ success: false, cancelled: true });
            });
            
            // Close button
            modal.querySelector('#modalClose').onclick = () => {
                overlay.remove();
                resolve({ success: false, cancelled: true });
            };
            
            // Generate QR code
            setTimeout(() => {
                const qrContainer = modal.querySelector('#bscQRCode');
                if (qrContainer) {
                    console.log('[BSC] Generating QR code for:', recipient, amount);
                    generateBSCQR(recipient, amount, qrContainer);
                } else {
                    console.error('[BSC] QR container not found!');
                }
            }, 200);
            
            // Copy address button
            modal.querySelector('#copyAddressBtn').onclick = () => {
                navigator.clipboard.writeText(recipient)
                    .then(() => {
                        showAlert('Address copied to clipboard!', 'success', 2000);
                    })
                    .catch(() => {
                        showAlert('Failed to copy address', 'error');
                    });
            };
            
            // View on explorer button
            modal.querySelector('#viewExplorerBtn').onclick = () => {
                window.open(`https://bscscan.com/address/${recipient}`, '_blank');
            };
            
            // Pay with MetaMask button
            modal.querySelector('#payWithMetaMaskBtn').onclick = async () => {
                // Close current modal
                overlay.remove();
                
                // Show processing modal
                const processingModal = createProcessingModal();
                
                try {
                    // Step 1: Check MetaMask
                    updateProcessingStatus(processingModal.modal, 'Checking MetaMask...');
                    
                    if (!window.ethereum) {
                        throw new Error('MetaMask not detected. Please install MetaMask extension.');
                    }
                    
                    // Step 2: Request account access
                    updateProcessingStatus(processingModal.modal, 'Connecting to MetaMask...');
                    
                    let accounts;
                    try {
                        accounts = await window.ethereum.request({ 
                            method: 'eth_requestAccounts' 
                        });
                    } catch (connectError) {
                        if (connectError.code === 4001) {
                            throw new Error('MetaMask connection rejected. Please connect to proceed.');
                        }
                        throw connectError;
                    }
                    
                    if (!accounts || accounts.length === 0) {
                        throw new Error('No accounts found in MetaMask.');
                    }
                    
                    const fromAddress = accounts[0];
                    
                    // Step 3: Switch to BSC network
                    updateProcessingStatus(processingModal.modal, 'Switching to BSC network...');
                    await ensureBSCNetwork();
                    
                    // Step 4: Send transaction
                    updateProcessingStatus(processingModal.modal, 'Confirm transaction in MetaMask...');
                    const result = await sendUSDTTransaction(recipient, amount, fromAddress);
                    
                    // Step 5: Show success
                    showSuccessModal(processingModal, result.txHash, result.explorerUrl);
                    
                    resolve({
                        success: true,
                        txHash: result.txHash,
                        explorerUrl: result.explorerUrl,
                        method: 'metamask'
                    });
                    
                } catch (error) {
                    console.error('MetaMask payment error:', error);
                    showErrorModal(processingModal, error.message, amount);
                }
            };
            
            // Confirm payment with transaction hash
            modal.querySelector('#confirmPaymentBtn').onclick = () => {
                const txHash = modal.querySelector('#txHashInput').value.trim();
                
                if (!txHash) {
                    if (!confirm(`No transaction hash entered. Are you sure you have already sent ${amount} USDT on BSC network?`)) {
                        return;
                    }
                    overlay.remove();
                    resolve({ 
                        success: false, 
                        manual: true, 
                        pendingConfirmation: true 
                    });
                    return;
                }
                
                if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
                    showAlert('Invalid transaction hash format. Should start with 0x and be 64 characters.', 'error');
                    return;
                }
                
                overlay.remove();
                resolve({ 
                    success: true, 
                    txHash: txHash, 
                    explorerUrl: `${CONFIG.EXPLORER_URL}${txHash}`,
                    method: 'manual',
                    manual: true
                });
            };
        });
    }

    // ✅ Create processing modal
    function createProcessingModal() {
        const content = `
            <div class="bsc-modal-header">
                <h2 class="bsc-modal-title">Processing Payment</h2>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-loading">
                    <div class="bsc-loading-spinner"></div>
                    <div class="bsc-loading-text" id="processingStatus">Initializing...</div>
                </div>
            </div>
        `;
        
        return createModal(content);
    }

    function updateProcessingStatus(modal, text) {
        const statusElement = modal.querySelector('#processingStatus');
        if (statusElement) {
            statusElement.textContent = text;
        }
    }

    // ✅ Show success modal
    function showSuccessModal(processingModal, txHash, explorerUrl) {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close" id="successClose">×</button>
                <h2 class="bsc-modal-title">Payment Successful!</h2>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-success">
                    <div class="bsc-success-icon">✅</div>
                    <div class="bsc-success-text">Payment Confirmed</div>
                    <div style="font-size: 14px; color: #6b7280; margin-bottom: 20px;">
                        Transaction has been processed on BSC network
                    </div>
                    <a href="${explorerUrl}" target="_blank" class="bsc-tx-link">
                        View transaction on BscScan →
                    </a>
                </div>
                <button id="successDoneBtn" class="bsc-btn bsc-btn-success bsc-btn-full mt-4">
                    Done
                </button>
            </div>
        `;
        
        // Replace processing modal content
        processingModal.modal.innerHTML = content;
        
        // Close button
        processingModal.modal.querySelector('#successClose').onclick = () => {
            processingModal.overlay.remove();
        };
        
        // Done button
        processingModal.modal.querySelector('#successDoneBtn').onclick = () => {
            processingModal.overlay.remove();
        };
    }

    // ✅ Show error modal
    function showErrorModal(processingModal, errorMessage, amount) {
        const content = `
            <div class="bsc-modal-header">
                <button class="bsc-modal-close" id="errorClose">×</button>
                <h2 class="bsc-modal-title">Payment Failed</h2>
            </div>
            <div class="bsc-modal-body">
                <div class="bsc-error">
                    ${errorMessage}
                </div>
                <button id="errorRetryBtn" class="bsc-btn bsc-btn-primary bsc-btn-full">
                    Try Again
                </button>
                <button id="errorCloseBtn" class="bsc-btn bsc-btn-secondary bsc-btn-full mt-2">
                    Close
                </button>
            </div>
        `;
        
        processingModal.modal.innerHTML = content;
        
        processingModal.modal.querySelector('#errorClose').onclick = () => {
            processingModal.overlay.remove();
        };
        
        processingModal.modal.querySelector('#errorCloseBtn').onclick = () => {
            processingModal.overlay.remove();
        };
        
        processingModal.modal.querySelector('#errorRetryBtn').onclick = () => {
            processingModal.overlay.remove();
            // Re-initiate payment
            setTimeout(() => initiateBSCPayment(amount || window.lastPaymentAmount), 300);
        };
    }

    // ✅ Main payment function
    async function initiateBSCPayment(amount, options = {}) {
        try {
            // Validate amount
            if (!amount || isNaN(amount) || amount <= 0) {
                throw new Error('Invalid payment amount');
            }
            
            // Store last payment amount for retry
            window.lastPaymentAmount = amount;
            
            // Inject styles if not already injected
            injectStyles();
            
            // Show payment modal and get result
            const result = await showPaymentModal(amount, options.recipient);
            
            if (result.success) {
                // Show success notification
                showAlert(`Payment successful! Transaction: ${result.txHash.substring(0, 10)}...`, 'success', 5000);
                
                // Call success callback if provided
                if (typeof options.onSuccess === 'function') {
                    options.onSuccess(result);
                }
                
                // Dispatch success event
                document.dispatchEvent(new CustomEvent('bscPaymentSuccess', {
                    detail: result
                }));
            } else if (result.cancelled) {
                console.log('Payment cancelled by user');
            } else if (result.pendingConfirmation) {
                console.log('Payment pending manual confirmation');
            }
            
            return result;
            
        } catch (error) {
            console.error('Payment initiation error:', error);
            showAlert(`Payment failed: ${error.message}`, 'error', 5000);
            
            // Call error callback if provided
            if (typeof options.onError === 'function') {
                options.onError(error);
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ✅ Update recipient address
    function setRecipientAddress(address) {
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
            CONFIG.RECIPIENT_ADDRESS = address;
            console.log('✅ BSC Recipient address updated:', address);
            return true;
        }
        console.error('Invalid BSC address format');
        return false;
    }

    // ✅ Initialize and expose to global scope
    function initialize() {
        // Inject styles
        injectStyles();
        
        // Expose functions to window
        window.initiateBSCPayment = initiateBSCPayment;
        window.BSCPayments = {
            init: initiateBSCPayment,
            initiate: initiateBSCPayment,
            setRecipient: setRecipientAddress,
            config: CONFIG,
            showAlert: showAlert
        };
        
        // Mark as ready
        window.BSCPaymentsReady = true;
        document.dispatchEvent(new CustomEvent('bscPaymentsReady'));
        
        console.log('✅ BSC USDT Payment System Ready');
    }

    // ✅ Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
