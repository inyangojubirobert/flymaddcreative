import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts"

console.log("One Dream Initiative - Paystack Webhook Handler")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Verify Paystack webhook signature
async function verifyPaystackSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    )
    
    const expectedSignature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(payload)
    )
    
    const expectedHex = Array.from(new Uint8Array(expectedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    
    return signature === expectedHex
  } catch (error) {
    console.error('Signature verification failed:', error)
    return false
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const paystackSecret = Deno.env.get('PAYSTACK_WEBHOOK_SECRET')!
    
    if (!supabaseUrl || !supabaseServiceKey || !paystackSecret) {
      throw new Error('Missing required environment variables')
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get webhook signature
    const signature = req.headers.get('x-paystack-signature')
    if (!signature) {
      console.log('❌ Missing Paystack signature')
      return new Response(
        JSON.stringify({ success: false, error: 'Missing signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get webhook payload
    const rawPayload = await req.text()
    
    // Verify webhook signature
    const isValidSignature = await verifyPaystackSignature(
      rawPayload, 
      signature, 
      paystackSecret
    )
    
    if (!isValidSignature) {
      console.log('❌ Invalid Paystack signature')
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid signature' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      )
    }

    // Parse webhook payload
    const webhook = JSON.parse(rawPayload)
    const { event, data } = webhook
    
    console.log('🔔 Paystack webhook received:', {
      event,
      reference: data?.reference,
      status: data?.status,
      amount: data?.amount
    })

    // Only process successful charge events
    if (event !== 'charge.success') {
      console.log('ℹ️ Ignoring non-charge event:', event)
      return new Response(
        JSON.stringify({ success: true, message: 'Event ignored' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Validate required fields
    const { reference, status, amount, customer, metadata } = data
    
    if (status !== 'success') {
      console.log('❌ Payment not successful, status:', status)
      return new Response(
        JSON.stringify({ success: false, error: 'Payment not successful' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Extract voting information from metadata
    const username = metadata?.username || metadata?.participant_username
    if (!username) {
      console.log('❌ Missing username in payment metadata')
      return new Response(
        JSON.stringify({ success: false, error: 'Missing username in payment metadata' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Convert amount from kobo to naira (Paystack uses kobo)
    const amountInNaira = amount / 100

    // Process the vote purchase
    console.log('🎯 Processing Paystack vote purchase...')
    const { data: result, error } = await supabase.rpc('process_vote_purchase', {
      p_username: username,
      p_transaction_id: reference,
      p_payment_method: 'paystack',
      p_amount: amountInNaira,
      p_payer_email: customer?.email || null,
      p_payer_name: customer?.first_name && customer?.last_name 
        ? `${customer.first_name} ${customer.last_name}` 
        : null,
      p_payment_metadata: {
        paystack_reference: reference,
        gateway_response: data?.gateway_response,
        channel: data?.channel,
        currency: data?.currency,
        metadata: metadata
      }
    })

    if (error) {
      console.error('❌ Database error:', error)
      return new Response(
        JSON.stringify({ success: false, error: 'Database error: ' + error.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    if (!result?.success) {
      console.log('❌ Vote processing failed:', result?.error)
      return new Response(
        JSON.stringify(result || { success: false, error: 'Unknown error' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Success!
    console.log('✅ Paystack vote processing successful:', {
      participant: result.participant_name,
      votes_added: result.votes_added,
      amount_paid: result.amount_paid,
      reference: reference
    })

    return new Response(
      JSON.stringify({
        ...result,
        webhook_processed_at: new Date().toISOString(),
        paystack_reference: reference
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('💥 Paystack webhook error:', error)
    
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})