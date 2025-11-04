import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface PaymentData {
  transaction_id: string
  username: string
  amount: number
  payment_method: string
  payer_email?: string
  payer_name?: string
  status: string
  metadata?: Record<string, any>
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Parse webhook payload
    const payload = await req.json() as { data: PaymentData }
    const data = payload.data
    
    console.log('🔔 Payment webhook received:', {
      transaction_id: data.transaction_id,
      username: data.username,
      amount: data.amount,
      payment_method: data.payment_method
    })

    // Only process completed payments
    if (data.status !== 'completed' && data.status !== 'succeeded') {
      console.log('❌ Payment not completed, status:', data.status)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment not completed'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      )
    }

    // Validate required fields
    const { transaction_id, username, amount, payment_method } = data
    
    if (!transaction_id || !username || !amount || !payment_method) {
      console.log('❌ Missing required fields')
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Missing required fields: transaction_id, username, amount, payment_method' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      )
    }

    // Call the secure vote purchase function
    console.log('🎯 Processing vote purchase...')
    const { data: result, error } = await supabase.rpc('process_vote_purchase', {
      p_username: username,
      p_transaction_id: transaction_id,
      p_payment_method: payment_method,
      p_amount: amount,
      p_payer_email: data.payer_email || null,
      p_payer_name: data.payer_name || null,
      p_payment_metadata: data.metadata || null
    })

    if (error) {
      console.error('❌ Database error:', error)
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Database error: ' + error.message 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      )
    }

    if (!result?.success) {
      console.log('❌ Vote processing failed:', result?.error)
      return new Response(
        JSON.stringify(result || { success: false, error: 'Unknown error' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      )
    }

    // Success! Log the result
    console.log('✅ Vote processing successful:', {
      participant: result.participant_name,
      votes_added: result.votes_added,
      amount_paid: result.amount_paid
    })

    // Return success response
    return new Response(
      JSON.stringify({
        ...result,
        webhook_processed_at: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('💥 Unexpected error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})