import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { EarningsView } from '@/components/earnings-view';
import { useAuth } from '@/contexts/AuthContext';

// Earnings & payouts for a One Dream account: gifts received, affiliate and
// reseller sales, and (when linked) the merchant account's referral earnings.
export default function EarningsScreen() {
  const { token } = useAuth();
  return (
    <ThemedView style={{ flex: 1 }}>
      <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
        {token ? <EarningsView token={token} /> : null}
      </SafeAreaView>
    </ThemedView>
  );
}
