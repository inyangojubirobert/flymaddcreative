// Must be the first import in the app: Hermes doesn't have a full `URL`
// implementation, and both @supabase/supabase-js and the Paystack callback
// parsing in vote/[username].tsx rely on the global URL constructor.
import 'react-native-url-polyfill/auto';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { ActivityIndicator, Platform } from 'react-native';

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { ThemedView } from '@/components/themed-view';
import { UpdateBanner } from '@/components/UpdateBanner';
import { WebAlertHost } from '@/components/web-alert-host';
import { WebShell } from '@/components/web-shell';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadPushNotifications } from '@/lib/push-notifications';

// Web: when a payment window (Paystack) returns to the app, hand the result
// back to the page that opened it and close the window. No-op on native.
WebBrowser.maybeCompleteAuthSession();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// Web: screens are transparent over the website-style page gradient; headers are glass.
const WebNavigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent', card: 'rgba(15, 23, 42, 0.82)', border: 'rgba(255, 255, 255, 0.1)', primary: '#FACC15' },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const navigationTheme = Platform.OS === 'web' ? WebNavigationTheme : colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={navigationTheme}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <WebShell>
              <RootNavigator />
            </WebShell>
            <UpdateBanner />
            <WebAlertHost />
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const notifications = loadPushNotifications();
    if (!notifications) return;
    const subscription = notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string };
      if (data?.type === 'admin_support') router.push('/admin-alerts' as never);
    });
    return () => subscription.remove();
  }, [router]);

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
        <Stack.Screen name="catalogue/order-chat" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/manage" options={{ headerShown: true, title: 'My Shop' }} />
        <Stack.Screen name="catalogue/my-listings" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/my-orders" options={{ headerShown: true }} />
        <Stack.Screen name="catalogue/promotion" options={{ headerShown: true, title: 'External promotion' }} />
        <Stack.Screen name="wallet" options={{ headerShown: true }} />
        <Stack.Screen name="messages" options={{ headerShown: true, title: 'Support Messages' }} />
        <Stack.Screen name="ai" options={{ headerShown: true, title: 'Bascardo AI' }} />
        <Stack.Screen name="ai-subscription" options={{ headerShown: true, title: 'AI Subscription' }} />
        <Stack.Screen name="faq" options={{ headerShown: true, title: 'Help & FAQ' }} />
        <Stack.Screen name="promote/index" options={{ headerShown: true, title: 'Promote' }} />
        <Stack.Screen name="promote/campaign" options={{ headerShown: true, title: 'Campaign' }} />
        <Stack.Screen name="promote/analytics" options={{ headerShown: true, title: 'Campaign analytics' }} />
        <Stack.Screen name="library/index" options={{ headerShown: true, title: 'My Library' }} />
        <Stack.Screen name="library/[licenseId]" options={{ headerShown: true, title: '' }} />
        <Stack.Screen name="catalogue/digital/[itemId]" options={{ headerShown: true, title: 'Sell as digital' }} />
        <Stack.Screen name="catalogue/digital/subscription" options={{ headerShown: true, title: 'Monthly subscription' }} />
        <Stack.Screen name="gifts/index" options={{ headerShown: true, title: 'Dream Coins & Gifts' }} />
        <Stack.Screen name="gifts/send" options={{ headerShown: true, title: 'Send a gift' }} />
        <Stack.Screen name="gifts/recognition/[username]" options={{ headerShown: true, title: 'Appreciation' }} />
        <Stack.Screen name="rewards" options={{ headerShown: true, title: 'Rewards & Recognition' }} />
        <Stack.Screen name="earnings" options={{ headerShown: true, title: 'Earnings & withdrawals' }} />
        <Stack.Screen name="partner/index" options={{ headerShown: true, title: 'Partner programme' }} />
        <Stack.Screen name="partner/discover" options={{ headerShown: true, title: 'Find listings to promote' }} />
        <Stack.Screen name="partner/storefront" options={{ headerShown: true, title: 'My storefront' }} />
        <Stack.Screen name="partner/seller" options={{ headerShown: true, title: 'Sell through partners' }} />
        <Stack.Screen name="partner/engagements" options={{ headerShown: true, title: 'Creative engagements' }} />
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
      <Stack.Screen name="shop/index" options={{ headerShown: true, title: 'Shop' }} />
      <Stack.Screen name="shop/category/[id]" options={{ headerShown: true, title: 'Category' }} />
      <Stack.Screen name="shop/cart" options={{ headerShown: true, title: 'Your cart' }} />
      <Stack.Screen name="catalogue/item/[id]" options={{ headerShown: true }} />
      <Stack.Screen name="m/[handle]" options={{ headerShown: true, title: 'Storefront' }} />
      <Stack.Screen name="merchant" options={{ headerShown: false }} />
      <Stack.Screen name="admin-alerts" options={{ headerShown: true, title: 'Admin alerts' }} />
    </Stack>
  );
}
