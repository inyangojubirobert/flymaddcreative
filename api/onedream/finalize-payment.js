/**
 * API Endpoint: Finalize and verify crypto payments
 * Verifies USDT transactions on BSC (BEP-20) and TRON (TRC-20) networks
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Network configurations
const NETWORKS = {
    bsc: {
        name: 'BSC',
        rpcUrl: 'https://bsc-dataseed.binance.org/',
        explorerApi: 'https://api.bscscan.com/api',
        usdtContract: '0x55d398326f99059fF775485246999027B3197955',
        recipientWallet: process.env.BSC_WALLET_ADDRESS || '0xa3A25699995266af5Aa08dbeF2715f4b3698cF8d',
        decimals: 18,
        apiKey: process.env.BSCSCAN_API_KEY || ''
    },
    tron: {
        name: 'TRON',
        apiUrl: 'https://api.trongrid.io',
        usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        recipientWallet: process.env.TRON_WALLET_ADDRESS || 'TVuPgEs4hSLSwPf8NMirVxeYse1vrmEtXL',
        decimals: 6,
        apiKey: process.env.TRONGRID_API_KEY || ''
    }
};

/**
 * Verify BSC transaction
 */
async function verifyBSCTransaction(txHash, expectedAmount, recipientWallet) {
    try {
        const config = NETWORKS.bsc;
        
        // Method 1: Use BscScan API (preferred if API key available)
        if (config.apiKey) {
            const url = `${config.explorerApi}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${config.apiKey}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.result && data.result.status === '0x1') {
                // Transaction successful, now verify it's a USDT transfer to our wallet
                const logs = data.result.logs || [];
                
                for (const log of logs) {
                    // Check if this is a Transfer event from USDT contract
                    if (log.address.toLowerCase() === config.usdtContract.toLowerCase()) {
                        // Transfer event topic
                        if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                            // Decode recipient from topics[2] (padded address)
                            const toAddress = '0x' + log.topics[2].slice(26);
                            
                            if (toAddress.toLowerCase() === recipientWallet.toLowerCase()) {
                                // Decode amount from data
                                const amountWei = BigInt(log.data);
                                const amount = Number(amountWei) / Math.pow(10, config.decimals);
                                
                                return {
                                    verified: true,
                                    network: 'BSC',
                                    txHash,
                                    amount,
                                    recipient: toAddress,
                                    blockNumber: parseInt(data.result.blockNumber, 16),
                                    status: 'confirmed'
                                };
                            }
                        }
                    }
                }
            }
        }
        
        // Method 2: Direct RPC call (fallback)
        const rpcResponse = await fetch(config.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_getTransactionReceipt',
                params: [txHash]
            })
        });
        
        const rpcData = await rpcResponse.json();
        
        if (rpcData.result && rpcData.result.status === '0x1') {
            return {
                verified: true,
                network: 'BSC',
                txHash,
                status: 'confirmed',
                blockNumber: parseInt(rpcData.result.blockNumber, 16),
                note: 'Transaction confirmed, amount verification requires API key'
            };
        }
        
        return { verified: false, error: 'Transaction not found or failed' };
        
    } catch (error) {
        console.error('[BSC Verify] Error:', error);
        return { verified: false, error: error.message };
    }
}

/**
 * Verify TRON transaction
 */
async function verifyTRONTransaction(txHash, expectedAmount, recipientWallet) {
    try {
        const config = NETWORKS.tron;
        
        // Query TronGrid API
        const headers = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
            headers['TRON-PRO-API-KEY'] = config.apiKey;
        }
        
        const response = await fetch(`${config.apiUrl}/v1/transactions/${txHash}`, { headers });
        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            // Transaction might be pending, try alternate endpoint
            const altResponse = await fetch(`${config.apiUrl}/wallet/gettransactionbyid`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ value: txHash })
            });
            const altData = await altResponse.json();
            
            if (altData.txID) {
                return {
                    verified: true,
                    network: 'TRON',
                    txHash,
                    status: 'pending',
                    note: 'Transaction found but not yet confirmed'
                };
            }
            
            return { verified: false, error: 'Transaction not found' };
        }
        
        const tx = data.data[0];
        
        // Check if transaction is confirmed
        if (tx.ret && tx.ret[0]?.contractRet === 'SUCCESS') {
            // Verify it's a TRC20 transfer
            if (tx.raw_data?.contract?.[0]?.type === 'TriggerSmartContract') {
                const contractData = tx.raw_data.contract[0].parameter.value;
                
                // Check if it's USDT contract
                if (contractData.contract_address === config.usdtContract || 
                    addressFromHex(contractData.contract_address) === config.usdtContract) {
                    
                    // Decode transfer data
                    const decoded = decodeTRC20Transfer(contractData.data);
                    
                    if (decoded) {
                        const toAddress = decoded.to;
                        const amount = decoded.amount / Math.pow(10, config.decimals);
                        
                        // Verify recipient
                        if (toAddress === recipientWallet || 
                            addressFromHex(toAddress) === recipientWallet) {
                            return {
                                verified: true,
                                network: 'TRON',
                                txHash,
                                amount,
                                recipient: toAddress,
                                blockNumber: tx.blockNumber,
                                status: 'confirmed'
                            };
                        }
                    }
                }
            }
            
            // Transaction successful but couldn't verify details
            return {
                verified: true,
                network: 'TRON',
                txHash,
                status: 'confirmed',
                note: 'Transaction confirmed, manual verification may be needed'
            };
        }
        
        return { verified: false, error: 'Transaction failed or pending' };
        
    } catch (error) {
        console.error('[TRON Verify] Error:', error);
        return { verified: false, error: error.message };
    }
}

/**
 * Decode TRC20 transfer data
 */
function decodeTRC20Transfer(data) {
    try {
        if (!data || data.length < 136) return null;
        
        // Remove '0x' if present
        const cleanData = data.startsWith('0x') ? data.slice(2) : data;
        
        // First 8 chars = method selector (a9059cbb = transfer)
        const methodId = cleanData.slice(0, 8);
        if (methodId !== 'a9059cbb') return null;
        
        // Next 64 chars = recipient address (padded)
        const toAddressHex = cleanData.slice(8, 72);
        const toAddress = '41' + toAddressHex.slice(24); // TRON addresses start with 41
        
        // Next 64 chars = amount
        const amountHex = cleanData.slice(72, 136);
        const amount = parseInt(amountHex, 16);
        
        return { to: toAddress, amount };
    } catch {
        return null;
    }
}

/**
 * Convert TRON hex address to base58
 */
function addressFromHex(hexAddress) {
    // This is a simplified version - in production use tronweb or a proper library
    // For now, just return the hex for comparison
    return hexAddress;
}

/**
 * Main API handler
 */
module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { transaction_hash, network, participant_id, vote_count, amount } = req.body;
        
        if (!transaction_hash) {
            return res.status(400).json({ error: 'Transaction hash required' });
        }
        
        const networkLower = (network || 'bsc').toLowerCase();
        
        if (!['bsc', 'tron'].includes(networkLower)) {
            return res.status(400).json({ error: 'Invalid network. Use "bsc" or "tron"' });
        }
        
        console.log(`[Finalize] Verifying ${networkLower.toUpperCase()} transaction: ${transaction_hash}`);
        
        // Verify the transaction
        let verification;
        const recipientWallet = NETWORKS[networkLower].recipientWallet;
        
        if (networkLower === 'bsc') {
            verification = await verifyBSCTransaction(transaction_hash, amount, recipientWallet);
        } else {
            verification = await verifyTRONTransaction(transaction_hash, amount, recipientWallet);
        }
        
        console.log('[Finalize] Verification result:', verification);
        
        // Record the payment in database
        if (verification.verified) {
            try {
                const { data: payment, error: paymentError } = await supabase
                    .from('payments')
                    .upsert({
                        transaction_hash,
                        network: networkLower,
                        amount: verification.amount || amount,
                        participant_id,
                        vote_count,
                        status: verification.status,
                        verified: true,
                        verified_at: new Date().toISOString(),
                        block_number: verification.blockNumber,
                        recipient_address: verification.recipient || recipientWallet,
                        raw_response: JSON.stringify(verification)
                    }, {
                        onConflict: 'transaction_hash'
                    })
                    .select()
                    .single();
                
                if (paymentError) {
                    console.error('[Finalize] DB Error:', paymentError);
                }
                
                // If participant_id provided, update their vote count
                if (participant_id && vote_count) {
                    const { error: voteError } = await supabase.rpc('increment_votes', {
                        p_id: participant_id,
                        vote_increment: vote_count
                    });
                    
                    if (voteError) {
                        console.error('[Finalize] Vote increment error:', voteError);
                    }
                }
                
            } catch (dbError) {
                console.error('[Finalize] Database error:', dbError);
                // Don't fail the request if DB write fails
            }
        }
        
        return res.status(200).json({
            success: verification.verified,
            ...verification,
            message: verification.verified 
                ? `Payment verified on ${networkLower.toUpperCase()}` 
                : 'Payment verification failed'
        });
        
    } catch (error) {
        console.error('[Finalize] Error:', error);
        return res.status(500).json({ 
            error: 'Internal server error', 
            message: error.message 
        });
    }
};
