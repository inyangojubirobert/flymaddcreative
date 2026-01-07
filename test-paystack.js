// Test Paystack Integration
const fetch = require('node-fetch');

async function testPaystackIntegration() {
  console.log('🧪 Testing Paystack Integration...\n');
  
  // Test 1: Create Payment Intent
  console.log('📝 Test 1: Creating Paystack Payment Intent');
  try {
    const response = await fetch('http://localhost:3000/api/onedream/create-payment-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        participant_id: 1,
        vote_count: 1,
        payment_method: 'paystack'
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Payment intent created successfully');
      console.log('   Authorization URL:', data.authorization_url);
      console.log('   Reference:', data.reference);
      console.log('   Amount:', `$${data.amount}`);
      return data.reference;
    } else {
      console.log('❌ Failed to create payment intent');
      console.log('   Error:', data.error);
      console.log('   Details:', data.details);
    }
  } catch (error) {
    console.log('❌ Request failed:', error.message);
  }
  
  console.log('\n');
}

testPaystackIntegration();
