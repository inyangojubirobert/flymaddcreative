import { Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { MerchantAuthProvider, useMerchantAuth } from '@/contexts/MerchantAuthContext';
import { ThemedView } from '@/components/themed-view';

// Merchants are a completely separate account system from participants
// (own JWT, own login/register, own backend tables) - this whole section
// gets its own auth provider and its own login/register gate, independent
// of the participant session the rest of the app is gated on.
export default function MerchantLayout() {
  return (
    <MerchantAuthProvider>
      <MerchantNavigator />
    </MerchantAuthProvider>
  );
}

function MerchantNavigator() {
  const { token, isLoading } = useMerchantAuth();

  if (isLoading) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="dashboard" options={{ title: 'Merchant Dashboard' }} />
        <Stack.Screen name="withdraw" options={{ title: 'Withdraw Tokens' }} />
        <Stack.Screen name="edit-profile" options={{ title: 'Edit Profile' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="login" options={{ title: 'Merchant Login' }} />
        <Stack.Screen name="register" options={{ title: 'Become a Merchant' }} />
      </Stack.Protected>
    </Stack>
  );
}
