// Stripe Checkout Session Creation (Node.js/Express)
// This would typically be part of your backend server

const express = require('express');
const stripe = require('stripe')('sk_test_your_stripe_secret_key'); // Replace with your secret key

const app = express();
app.use(express.json());

// Create checkout session endpoint
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { username, voteCount, amount } = req.body;

    // Validate inputs
    if (!username || !voteCount || voteCount < 1) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${voteCount} Votes for ${username}`,
              description: 'One Dream Initiative - Vote Purchase',
            },
            unit_amount: amount, // Amount in cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        username: username, // CRITICAL: This is how votes are attributed
        vote_count: voteCount.toString(),
      },
      mode: 'payment',
      success_url: `${req.headers.origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/payment-cancelled`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Payment success page
app.get('/payment-success', async (req, res) => {
  const { session_id } = req.query;
  
  if (!session_id) {
    return res.redirect('/payment-cancelled');
  }

  try {
    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    if (session.payment_status === 'paid') {
      // Payment successful - webhook will handle vote processing
      res.send(`
        <html>
          <head><title>Payment Success</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: green;">✅ Payment Successful!</h1>
            <p>Your votes for <strong>${session.metadata.username}</strong> are being processed.</p>
            <p>Vote Count: <strong>${session.metadata.vote_count}</strong></p>
            <p>Amount Paid: <strong>$${(session.amount_total / 100).toFixed(2)}</strong></p>
            <a href="/" style="color: blue;">Return to Home</a>
          </body>
        </html>
      `);
    } else {
      res.redirect('/payment-cancelled');
    }
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.redirect('/payment-cancelled');
  }
});

// Payment cancelled page
app.get('/payment-cancelled', (req, res) => {
  res.send(`
    <html>
      <head><title>Payment Cancelled</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: red;">❌ Payment Cancelled</h1>
        <p>Your payment was cancelled. No votes were processed.</p>
        <a href="/" style="color: blue;">Try Again</a>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: https://your-domain.com/webhook`);
});

// Export for serverless deployment (Vercel, Netlify, etc.)
module.exports = app;