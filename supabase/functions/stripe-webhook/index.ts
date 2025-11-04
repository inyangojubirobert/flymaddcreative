import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Stripe webhook signature verification
async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    
    const timestamp = signature.split(',')[0].split('=')[1]
    const expectedSignature = signature.split(',')[1].split('=')[1]
    
    const payload = `${timestamp}.${body}`
    const payloadBytes = encoder.encode(payload)
    
    const signatureBytes = new Uint8Array(
      expectedSignature.match(/.{2}/g)!.map(byte => parseInt(byte, 16))
    )
    
    return await crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes)
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get raw body and signature
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')
    
    if (!signature) {
      return new Response('Missing Stripe signature', { status: 400 })
    }

    // Verify webhook signature
    const isValid = await verifyStripeSignature(body, signature, stripeWebhookSecret)
    if (!isValid) {
      console.error('❌ Invalid Stripe signature')
      return new Response('Invalid signature', { status: 401 })
    }

    const event = JSON.parse(body)
    console.log('🔔 Stripe webhook received:', event.type)

    // Handle payment success events
    if (event.type === 'payment_intent.succeeded' || event.type === 'checkout.session.completed') {
      const paymentData = event.data.object
      
      // Extract custom metadata (should include username)
      const username = paymentData.metadata?.username
      const amount = paymentData.amount_received || paymentData.amount_total
      const transactionId = paymentData.id
      const payerEmail = paymentData.customer_details?.email || paymentData.receipt_email
      const payerName = paymentData.customer_details?.name || paymentData.billing_details?.name
      
      if (!username) {
        console.error('❌ No username in payment metadata')
        return new Response('Missing username in metadata', { status: 400 })
      }

      // Convert cents to dollars
      const amountInDollars = amount / 100

      console.log('💳 Processing Stripe payment:', {
        username,
        amount: amountInDollars,
        transactionId,
        payerEmail
      })

      // Call vote purchase function
      const { data: result, error } = await supabase.rpc('process_vote_purchase', {
        p_username: username,
        p_transaction_id: transactionId,
        p_payment_method: 'stripe',
        p_amount: amountInDollars,
        p_payer_email: payerEmail,
        p_payer_name: payerName,
        p_payment_metadata: {
          stripe_payment_intent: paymentData.id,
          stripe_customer: paymentData.customer,
          payment_method_type: paymentData.payment_method_types?.[0] || 'card'
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

      console.log('✅ Stripe payment processed successfully:', {
        participant: result.participant_name,
        votes_added: result.votes_added,
        amount_paid: result.amount_paid
      })

      return new Response('Payment processed successfully', { status: 200 })
    }

    // Handle other webhook events (logging only)
    console.log(`ℹ️ Received Stripe event: ${event.type} (not processed)`)
    return new Response('Event received', { status: 200 })

  } catch (error) {
    console.error('💥 Stripe webhook error:', error)
    return new Response('Webhook error', { status: 500 })
  }
})