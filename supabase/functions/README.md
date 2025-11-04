# 🚀 One Dream Initiative - Supabase Edge Functions

This directory contains the production-ready Edge Functions for processing vote payments securely.

## 📁 Functions Overview

### 1. `process-vote-payment/`

**Generic payment webhook handler**

- Handles payments from any gateway (Stripe, Crypto, PayPal, etc.)
- Validates payment confirmation
- Processes votes securely via database function
- Returns real-time updates

### 2. `stripe-webhook/`

**Stripe-specific webhook handler**

- Handles Stripe payment_intent.succeeded events
- Verifies webhook signatures for security
- Extracts payment data and metadata
- Processes credit card and other Stripe payments

### 3. `crypto-webhook/`

**Cryptocurrency payment handler**

- Handles Bitcoin, Ethereum, USDC payments
- Waits for blockchain confirmations
- Supports multiple crypto currencies
- Handles exchange rate conversion

## 🔧 Environment Variables Required

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe (for stripe-webhook)
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Optional: Add API keys for crypto payment providers
COINBASE_API_KEY=your_coinbase_key
BLOCKCHAIN_API_KEY=your_blockchain_key
```

## 🛠️ Deployment Commands

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-id

# Deploy all functions
supabase functions deploy process-vote-payment
supabase functions deploy stripe-webhook
supabase functions deploy crypto-webhook

# Set environment variables
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

## 🎯 Webhook URLs (After Deployment)

```
Generic Payment: https://your-project.supabase.co/functions/v1/process-vote-payment
Stripe Webhook: https://your-project.supabase.co/functions/v1/stripe-webhook
Crypto Webhook: https://your-project.supabase.co/functions/v1/crypto-webhook
```

## 📝 Usage Examples

### Stripe Integration

1. Create Stripe Checkout with metadata:

```javascript
const session = await stripe.checkout.sessions.create({
  payment_method_types: ["card"],
  line_items: [
    {
      price_data: {
        currency: "usd",
        product_data: { name: "Votes for John Doe" },
        unit_amount: 1000, // $10.00 = 5 votes
      },
      quantity: 1,
    },
  ],
  metadata: {
    username: "johndoe", // CRITICAL: Include username
  },
  success_url: "https://yoursite.com/success",
  cancel_url: "https://yoursite.com/cancel",
});
```

2. Configure webhook endpoint in Stripe Dashboard:
   - URL: `https://your-project.supabase.co/functions/v1/stripe-webhook`
   - Events: `payment_intent.succeeded`, `checkout.session.completed`

### Generic Payment Integration

```javascript
// For custom payment gateways
fetch("https://your-project.supabase.co/functions/v1/process-vote-payment", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "payment.completed",
    data: {
      transaction_id: "txn_12345",
      username: "johndoe",
      amount: 10.0,
      currency: "USD",
      payment_method: "paypal",
      payer_email: "supporter@email.com",
      payer_name: "Generous Supporter",
      status: "completed",
    },
  }),
});
```

### Crypto Payment Integration

```javascript
// For crypto payment providers (Coinbase, BitPay, etc.)
const cryptoWebhook = {
  event: "payment.confirmed",
  data: {
    id: "crypto_12345",
    amount: "10.00",
    currency: "USDC",
    status: "confirmed",
    confirmations: 6,
    transaction_hash: "0x123...",
    metadata: {
      username: "johndoe",
      payer_email: "crypto@supporter.com",
    },
  },
};
```

## 🔒 Security Features

- ✅ **Signature Verification** (Stripe webhooks)
- ✅ **Service Role Authentication** (Database access)
- ✅ **Transaction ID Validation** (Prevent duplicates)
- ✅ **Amount Validation** (Must be multiple of $2)
- ✅ **Status Verification** (Only confirmed payments)
- ✅ **CORS Protection** (Configurable origins)

## 📊 Response Format

### Success Response

```json
{
  "success": true,
  "payment_id": "uuid-payment-id",
  "participant_name": "John Doe",
  "votes_added": 5,
  "amount_paid": 10.0,
  "vote_price": 2.0,
  "message": "Successfully added 5 votes for John Doe!",
  "webhook_processed_at": "2025-11-04T12:00:00Z"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Payment amount must be a multiple of $2.00"
}
```

## 🔍 Monitoring & Logs

View function logs in real-time:

```bash
supabase functions logs process-vote-payment
supabase functions logs stripe-webhook
supabase functions logs crypto-webhook
```

## 🎯 Production Checklist

- [ ] Deploy database schema (`onedream-database-setup.sql`)
- [ ] Deploy all Edge Functions
- [ ] Set environment variables
- [ ] Configure webhook URLs in payment providers
- [ ] Test with small payments first
- [ ] Monitor logs for errors
- [ ] Set up alerts for failed payments

## 🚨 Important Notes

1. **Always include username in payment metadata** - This is how votes are attributed
2. **Test webhook endpoints** before going live
3. **Monitor failed payments** and implement retry logic
4. **Keep webhook secrets secure** - Never expose in client code
5. **Validate amounts** - System only accepts multiples of $2.00

## 📞 Support

If you encounter issues:

1. Check function logs in Supabase dashboard
2. Verify webhook URLs are correctly configured
3. Ensure environment variables are set
4. Test with small amounts first
5. Check database permissions and RLS policies
