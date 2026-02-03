'use client';

import { useEffect } from 'react';

export default function PaymentLoader({ bscWallet, tronWallet }) {
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.processCryptoPayment) {
      const script = document.createElement('script');
      script.src = '/js/crypto-payments.js';
      script.dataset.bscWallet = bscWallet;
      script.dataset.tronWallet = tronWallet;
      script.async = true;
      document.body.appendChild(script);
    }
  }, [bscWallet, tronWallet]);

  return null;
}
