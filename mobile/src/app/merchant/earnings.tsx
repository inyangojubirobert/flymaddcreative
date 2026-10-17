import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { EarningsView } from '@/components/earnings-view';
import { useMerchantAuth } from '@/contexts/MerchantAuthContext';

// Merchant earnings: 10% of gifts received by people you referred (for 12
// months from their registration) and seller / buyer referral rewards.
export default function MerchantEarningsScreen() {
  const { token } = useMerchantAuth();
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        {token ? <EarningsView token={token} /> : null}
      </SafeAreaView>
    </ThemedView>
  );
}
