import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

console.log("One Dream Initiative - Test Payment Processor")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables')
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { username, transaction_id, payment_method, amount, payer_email, payer_name } = body

    console.log('Processing payment:', { username, transaction_id, amount, payment_method })

    // Validate payment method
    const validMethods = ['test', 'stripe', 'paystack', 'crypto', 'paypal']
    if (!validMethods.includes(payment_method)) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Invalid payment method. Must be one of: ${validMethods.join(', ')}` 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Call the vote purchase function
    const { data: result, error } = await supabase.rpc('process_vote_purchase', {
      p_username: username,
      p_transaction_id: transaction_id,
      p_payment_method: payment_method,
      p_amount: amount,
      p_payer_email: payer_email || null,
      p_payer_name: payer_name || null,
      p_payment_metadata: null
    })

    if (error) {
      console.error('Database error:', error)
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    console.log('Vote processing result:', result)

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})