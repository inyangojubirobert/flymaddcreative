/**
 * ONE DREAM INITIATIVE – PAYMENT ROUTER
 * Routes vote payment to correct provider.
 * Updated to use standalone BSC and TRON payment systems.
 */

console.log('🔀 vote-payments.js loaded - Standalone Router');

async function processVotePayment() {
    switch (window.selectedPaymentMethod) {
        case 'paystack':
            if (typeof window.processPaystackPayment !== 'function') {
                throw new Error('Paystack not available');
            }
            return await window.processPaystackPayment();

        case 'crypto':
            // 🎯 NEW: Route to appropriate standalone crypto payment system
            return await handleCryptoPayment();

        default:
            throw new Error('Invalid payment method');
    }
}

/**
 * Handle crypto payment - automatically detects and routes to BSC or TRON
 */
async function handleCryptoPayment() {
    // Get current participant and vote details
    const participantId = window.currentParticipant?.id;
    const voteCount = window.selectedVoteAmount || 1;
    const amount = window.selectedCost || (voteCount * 2);
    
    if (!participantId) {
        throw new Error('No participant selected');
    }

    // 🎯 DETECT NETWORK: Default to BSC, but could add network selector later
    const selectedNetwork = window.selectedCryptoNetwork || 'BSC'; // 'BSC' or 'TRON'
    
    console.log(`[Crypto] Processing ${selectedNetwork} payment:`, {
        participantId,
        voteCount,
        amount
    });

    // Route to appropriate standalone payment system
    if (selectedNetwork === 'BSC') {
        // ✅ Use standalone BSC Payments
        if (typeof window.BSCPayments?.initiate !== 'function') {
            throw new Error('BSC payment module not loaded');
        }
        
        const result = await window.BSCPayments.initiate(amount, {
            recipient: window.BSC_CONFIG?.RECIPIENT_ADDRESS,
            participantId: participantId,
            voteCount: voteCount,
            onSuccess: (data) => {
                console.log('[BSC] Payment successful:', data);
            },
            onError: (error) => {
                console.error('[BSC] Payment failed:', error);
            }
        });
        
        // Transform result to match expected format
        return {
            success: result.success,
            txHash: result.txHash,
            payment_intent_id: result.txHash || result.paymentId,
            payment_amount: amount,
            participant_id: participantId,
            vote_count: voteCount,
            network: 'BSC',
            cancelled: result.cancelled,
            pendingConfirmation: result.pendingConfirmation
        };
        
    } else if (selectedNetwork === 'TRON') {
        // ✅ Use standalone TRON Payments
        if (typeof window.TRONPayments?.initiate !== 'function') {
            throw new Error('TRON payment module not loaded');
        }
        
        const result = await window.TRONPayments.initiate(amount, {
            recipient: window.TRON_CONFIG?.RECIPIENT_ADDRESS,
            participantId: participantId,
            voteCount: voteCount,
            onSuccess: (data) => {
                console.log('[TRON] Payment successful:', data);
            },
            onError: (error) => {
                console.error('[TRON] Payment failed:', error);
            }
        });
        
        // Transform result to match expected format
        return {
            success: result.success,
            txHash: result.txHash,
            payment_intent_id: result.txHash || result.paymentId,
            payment_amount: amount,
            participant_id: participantId,
            vote_count: voteCount,
            network: 'TRON',
            cancelled: result.cancelled,
            pendingConfirmation: result.pendingConfirmation
        };
    }
    
    throw new Error(`Unsupported network: ${selectedNetwork}`);
}

/**
 * Optional: Add network selector UI
 */
function showNetworkSelector() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4';
        overlay.innerHTML = `
            <div class="bg-white rounded-2xl p-6 max-w-sm w-full text-center">
                <h3 class="text-xl font-bold mb-4 text-gray-900">Choose Network</h3>
                <div class="space-y-3">
                    <button id="selectBSC" class="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all">
                        <span>🟡</span> BSC (BEP-20) - USDT
                    </button>
                    <button id="selectTRON" class="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all">
                        <span>🔴</span> TRON (TRC-20) - USDT
                    </button>
                    <button id="cancelNetwork" class="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 py-3 rounded-xl mt-2 transition-colors">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        overlay.querySelector('#selectBSC').onclick = () => {
            overlay.remove();
            resolve('BSC');
        };
        
        overlay.querySelector('#selectTRON').onclick = () => {
            overlay.remove();
            resolve('TRON');
        };
        
        overlay.querySelector('#cancelNetwork').onclick = () => {
            overlay.remove();
            resolve(null);
        };
        
        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

// Export functions
window.processVotePayment = processVotePayment;
window.handleCryptoPayment = handleCryptoPayment;
window.showNetworkSelector = showNetworkSelector;

console.log('✅ vote-payments.js router ready - BSC & TRON standalone');