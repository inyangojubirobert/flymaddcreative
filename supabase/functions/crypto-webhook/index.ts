import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CryptoWebhook {
  event: string
  data: {
    id: string
    amount: string
    currency: string
    status: string
    metadata: {
      username: string
      payer_email?: string
      payer_name?: string
    }
    transaction_hash?: string
    confirmations?: number
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const payload: CryptoWebhook = await req.json()
    
    console.log('🔔 Crypto webhook received:', {
      event: payload.event,
      id: payload.data.id,
      amount: payload.data.amount,
      currency: payload.data.currency,
      status: payload.data.status
    })

    // Only process confirmed payments
    if (payload.data.status !== 'confirmed' && payload.data.status !== 'completed') {
      console.log('❌ Crypto payment not confirmed, status:', payload.data.status)
      return new Response('Payment not confirmed', { status: 200 })
    }

    // Ensure minimum confirmations for crypto
    if (payload.data.confirmations && payload.data.confirmations < 3) {
      console.log('❌ Insufficient confirmations:', payload.data.confirmations)
      return new Response('Insufficient confirmations', { status: 200 })
    }

    const { id, amount, currency, metadata } = payload.data
    const { username, payer_email, payer_name } = metadata

    if (!username) {
      console.error('❌ No username in crypto payment metadata')
      return new Response('Missing username in metadata', { status: 400 })
    }

    // Convert crypto amount to USD (you may need to implement exchange rate conversion)
    let amountInUSD: number
    
    if (currency.toLowerCase() === 'usdc' || currency.toLowerCase() === 'usdt') {
      // Stablecoins - direct 1:1 conversion
      amountInUSD = parseFloat(amount)
    } else {
      // For other cryptocurrencies, you'd need to fetch current exchange rate
      // For now, assuming the amount is already in USD equivalent
      amountInUSD = parseFloat(amount)
    }

    console.log('₿ Processing crypto payment:', {
      username,
      amount: amountInUSD,
      currency,
      transactionId: id,
      hash: payload.data.transaction_hash
    })

    // Call vote purchase function
    const { data: result, error } = await supabase.rpc('process_vote_purchase', {
      p_username: username,
      p_transaction_id: id,
      p_payment_method: 'crypto',
      p_amount: amountInUSD,
      p_payer_email: payer_email || null,
      p_payer_name: payer_name || null,
      p_payment_metadata: {
        cryptocurrency: currency,
        transaction_hash: payload.data.transaction_hash,
        confirmations: payload.data.confirmations,
        original_amount: amount,
        original_currency: currency
      }
    })

    if (error) {
      console.error('❌ Database error:', error)
      return new Response('Database error', { status: 500 })
    }

    if (!result.success) {
      console.error('❌ Vote processing failed:', result.error)
      return new Response(result.error, { status: 400 })
    }

    console.log('✅ Crypto payment processed successfully:', {
      participant: result.participant_name,
      votes_added: result.votes_added,
      amount_paid: result.amount_paid,
      currency
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Crypto payment processed successfully',
        votes_added: result.votes_added,
        participant: result.participant_name
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('💥 Crypto webhook error:', error)
    return new Response('Webhook error', { status: 500 })
  }
})