// 💳 Paystack Payment Integration for One Dream Initiative
// Add this to your React component or create a separate PaystackPayment.js file

class PaystackPayment {
  constructor(publicKey) {
    this.publicKey = publicKey;
    this.loadPaystackScript();
  }

  // Load Paystack inline script
  loadPaystackScript() {
    if (document.getElementById('paystack-script')) return;
    
    const script = document.createElement('script');
    script.id = 'paystack-script';
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.async = true;
    document.head.appendChild(script);
  }

  // Initialize payment
  async initiatePayment(options) {
    const {
      username,
      amount,
      email,
      firstName = '',
      lastName = '',
      phone = '',
      onSuccess = () => {},
      onCancel = () => {},
      onError = () => {}
    } = options;

    // Wait for Paystack script to load
    await this.waitForPaystack();

    const paystackOptions = {
      key: this.publicKey,
      email: email,
      amount: amount * 100, // Convert to kobo (Paystack uses kobo)
      currency: 'NGN',
      ref: `ODI_${username}_${Date.now()}`, // Unique reference
      
      // Customer information
      customer: {
        email: email,
        first_name: firstName,
        last_name: lastName,
        phone: phone
      },

      // Custom metadata for vote tracking
      metadata: {
        username: username,
        participant_username: username,
        purpose: 'one_dream_initiative_vote',
        vote_amount: amount,
        timestamp: new Date().toISOString()
      },

      callback: function(response) {
        console.log('✅ Paystack payment successful:', response);
        
        // The webhook will handle the actual vote processing
        // Just show success message to user
        onSuccess({
          reference: response.reference,
          message: 'Payment successful! Your vote is being processed.',
          status: 'success'
        });
      },

      onClose: function() {
        console.log('Payment cancelled by user');
        onCancel();
      }
    };

    try {
      const paystack = new PaystackPop();
      paystack.setup(paystackOptions);
      paystack.openIframe();
    } catch (error) {
      console.error('Paystack initialization error:', error);
      onError(error);
    }
  }

  // Wait for Paystack script to load
  waitForPaystack() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50;
      
      const checkPaystack = () => {
        attempts++;
        
        if (typeof PaystackPop !== 'undefined') {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('Paystack failed to load'));
        } else {
          setTimeout(checkPaystack, 100);
        }
      };
      
      checkPaystack();
    });
  }

  // Verify payment status (optional - for extra confirmation)
  async verifyPayment(reference) {
    try {
      const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          'Authorization': `Bearer ${this.secretKey}`, // Note: Don't expose secret key in frontend
          'Content-Type': 'application/json'
        }
      });
      
      return await response.json();
    } catch (error) {
      console.error('Payment verification error:', error);
      return null;
    }
  }
}

// 🚀 Usage Example in React Component:
const PaystackVoteButton = ({ username, email, firstName, lastName }) => {
  const [isProcessing, setIsProcessing] = React.useState(false);
  
  // Initialize Paystack (use your actual public key)
  const paystack = new PaystackPayment('pk_test_your_paystack_public_key');
  
  const handlePaystackPayment = async () => {
    setIsProcessing(true);
    
    await paystack.initiatePayment({
      username: username,
      amount: 2.00, // $2 per vote
      email: email,
      firstName: firstName,
      lastName: lastName,
      
      onSuccess: (response) => {
        alert(`🎉 Payment successful! Reference: ${response.reference}`);
        // Refresh leaderboard or show success message
        window.location.reload();
      },
      
      onCancel: () => {
        alert('Payment cancelled');
        setIsProcessing(false);
      },
      
      onError: (error) => {
        alert('Payment failed. Please try again.');
        console.error('Payment error:', error);
        setIsProcessing(false);
      }
    });
    
    setIsProcessing(false);
  };

  return (
    <button 
      onClick={handlePaystackPayment}
      disabled={isProcessing}
      className="paystack-vote-button"
      style={{
        backgroundColor: '#00C851',
        color: 'white',
        padding: '12px 24px',
        border: 'none',
        borderRadius: '6px',
        fontSize: '16px',
        fontWeight: 'bold',
        cursor: isProcessing ? 'not-allowed' : 'pointer',
        opacity: isProcessing ? 0.6 : 1
      }}
    >
      {isProcessing ? 'Processing...' : '💳 Vote with Paystack (₦800)'}
    </button>
  );
};

// 🎯 Integration Notes:
// 1. Replace 'pk_test_your_paystack_public_key' with your actual Paystack public key
// 2. Set up webhook URL: https://pjtuisyvpvoswmcgxsfs.supabase.co/functions/v1/paystack-webhook
// 3. Add PAYSTACK_WEBHOOK_SECRET to your Supabase environment variables
// 4. Test with Paystack test cards: 4084084084084081 (Visa), 5060666666666666666 (Verve)

export { PaystackPayment, PaystackVoteButton };