// Must be the first import in the app: Hermes doesn't have a full `URL`
// implementation, and both @supabase/supabase-js and the Paystack callback
// parsing in vote/[username].tsx rely on the global URL constructor.
import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemedView } from '@/components/themed-view';
import { UpdateBanner } from '@/components/UpdateBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
          <UpdateBanner />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile/[username]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="vote/[username]" options={{ headerShown: true, presentation: 'modal' }} />
        <Stack.Screen name="catalogue/[username]" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/item/[id]" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/order-chat" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/manage" options={{ headerShown: true, title: 'My Shop' }} />
        <Stack.Screen name="catalogue/my-listings" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/my-orders" options={{ headerShown: true }} />
        <Stack.Screen name="wallet" options={{ headerShown: true }} />
        <Stack.Screen name="messages" options={{ headerShown: true, title: 'Support Messages' }} />
        <Stack.Screen name="ai" options={{ headerShown: true, title: 'Bascardo AI' }} />
        <Stack.Screen name="ai-subscription" options={{ headerShown: true, title: 'AI Subscription' }} />
        <Stack.Screen name="faq" options={{ headerShown: true, title: 'Help & FAQ' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Merchants are a separate account system (own login, own JWT) -
          reachable regardless of whether a participant is logged in, same
          as merchant-login.html on the website isn't gated behind a
          participant session. This whole subtree has its own auth gate,
          see src/app/merchant/_layout.tsx. */}
      <Stack.Screen name="merchant" options={{ headerShown: false }} />
    </Stack>
  );
}
