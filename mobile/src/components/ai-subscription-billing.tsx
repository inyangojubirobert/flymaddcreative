import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { getAvailablePurchases, useIAP, type ProductSubscription, type Purchase } from 'react-native-iap';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { BASCARDO_LOGO_URL } from '@/constants/bascardo';
import { useAuth } from '@/contexts/AuthContext';
import { getAiOverview, verifyGooglePlayAiSubscription, type AiPlan } from '@/api/ai';
import { ApiError } from '@/lib/api-client';
import { googleSubscriptionManagementUrl, googleSubscriptionRequest, monthlyGoogleOffer } from '@/lib/google-play-subscription';

const PLAN_FEATURES: Record<AiPlan['id'], string[]> = {
  free: ['App and project questions', 'Catalogue guidance', 'Basic recommendations'],
  pro: ['Everything in Free', 'Sales and catalogue analysis', 'Vote and leaderboard insights', 'Marketing recommendations'],
  business: ['Everything in Pro', 'Higher monthly allowance', 'Deeper business strategy', 'Frequent performance reports'],
};

export default function AiSubscriptionScreen() {
  const { participant, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [purchasingProductId, setPurchasingProductId] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const purchaseBusy = useRef(false);
  const verifyingTokens = useRef(new Set<string>());

  function markPurchase(productId: string | null) {
    purchaseBusy.current = !!productId;
    setPurchasingProductId(productId);
  }

  const overviewQuery = useQuery({
    queryKey: ['ai-overview', participant?.id],
    queryFn: () => getAiOverview(token!),
    enabled: !!token,
  });

  const verificationMutation = useMutation({
    mutationFn: (input: { productId: string; purchaseToken: string }) => verifyGooglePlayAiSubscription(token!, input),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['ai-overview'] });
      Alert.alert(result.pendingProductId ? 'Plan change scheduled' : result.status === 'pending' ? 'Payment pending' : 'Subscription updated', result.message);
    },
    onError: (caught) => {
      Alert.alert('Could not verify purchase', caught instanceof ApiError ? caught.message : 'Please try again.');
    },
  });

  const {
    connected,
    subscriptions,
    fetchProducts,
    requestPurchase,
    getActiveSubscriptions,
  } = useIAP({
    onPurchaseSuccess: (purchase) => { void completeGooglePlayPurchase(purchase); },
    onPurchaseError: (error) => {
      markPurchase(null);
      if (!String(error.code).toLowerCase().includes('cancel')) {
        Alert.alert('Purchase not completed', error.message || 'Google Play could not complete the purchase.');
      }
    },
  });

  const storeProductIds = useMemo(() => {
    const products = overviewQuery.data?.storeProducts?.googlePlay;
    return products ? [products.pro, products.business] : [];
  }, [overviewQuery.data?.storeProducts?.googlePlay]);

  useEffect(() => {
    if (connected && storeProductIds.length) {
      void fetchProducts({ skus: storeProductIds, type: 'subs' }).catch(() => {
        Alert.alert('Plans unavailable', 'Google Play could not load prices. Please try again.');
      });
    }
  }, [connected, fetchProducts, storeProductIds]);

  async function completeGooglePlayPurchase(purchase: Purchase) {
    if (!token || !storeProductIds.includes(purchase.productId)) return;
    const purchaseToken = purchase.purchaseToken;
    if (!purchaseToken) {
      markPurchase(null);
      Alert.alert('Verification unavailable', 'Google Play did not return a purchase token. Use Restore purchases to try again.');
      return;
    }
    if (verifyingTokens.current.has(purchaseToken)) return;
    verifyingTokens.current.add(purchaseToken);
    try {
      // The server is the single acknowledgement owner. Pending payments are
      // recorded there, but never acknowledged or granted paid access.
      await verificationMutation.mutateAsync({ productId: purchase.productId, purchaseToken });
    } catch {
      // The mutation displays the verification error; avoid an unhandled promise.
    } finally {
      verifyingTokens.current.delete(purchaseToken);
      markPurchase(null);
    }
  }

  function storeProductForPlan(plan: AiPlan): ProductSubscription | undefined {
    const productId = overviewQuery.data?.storeProducts?.googlePlay?.[plan.id as 'pro' | 'business'];
    return subscriptions.find((subscription) => subscription.id === productId);
  }

  async function confirmPlan(plan: AiPlan) {
    if (!token || !participant || purchaseBusy.current || isRestoring || plan.id === 'free' || plan.id === overviewQuery.data?.plan.id) return;
    if (Platform.OS !== 'android') {
      Alert.alert('Google Play required', 'This build currently supports Bascardo AI subscriptions through Google Play on Android.');
      return;
    }
    const product = storeProductForPlan(plan);
    const offer = monthlyGoogleOffer(product);
    if (!connected || !product || !offer) {
      Alert.alert(
        'Plan unavailable',
        'This monthly subscription is currently unavailable. Please try again later.',
      );
      return;
    }
    markPurchase(product.id);
    try {
      const purchases = (await getAvailablePurchases()).filter((purchase) => storeProductIds.includes(purchase.productId));
      for (const purchase of purchases) {
        if (purchase.purchaseToken) await verifyGooglePlayAiSubscription(token, { productId: purchase.productId, purchaseToken: purchase.purchaseToken });
      }
      // Refetch after verification: catches other devices, website subscriptions,
      // held payments, and a backend that has not received the safety migration.
      const latest = await getAiOverview(token);
      queryClient.setQueryData(['ai-overview', participant.id], latest);
      const prepared = googleSubscriptionRequest(product, purchases, latest, participant.id);
      Alert.alert(
      `Subscribe to ${plan.name}?`,
      `${offer.pricingPhases.pricingPhaseList[0].formattedPrice} per month with ${plan.monthlyCredits} AI credits. ${prepared.deferred ? 'Your Business access continues until the next renewal, when Pro begins.' : purchases.length ? 'This replaces your current plan immediately. Google Play will confirm the prorated charge.' : 'Renews automatically each month. You can cancel through Manage subscription.'}`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => markPurchase(null) },
        {
          text: 'Continue',
          onPress: () => {
            void requestPurchase(prepared.request).catch((error) => {
              markPurchase(null);
              Alert.alert('Purchase not started', error instanceof Error ? error.message : 'Please try again.');
            });
          },
        },
      ],
      { cancelable: true, onDismiss: () => markPurchase(null) },
    );
    } catch (error) {
      markPurchase(null);
      Alert.alert('Purchase not started', error instanceof Error ? error.message : 'Please try again.');
    }
  }

  async function manageGooglePlaySubscription() {
    const googleSubscriptions = overviewQuery.data?.billing?.subscriptions.filter((subscription) => subscription.provider === 'google_play') || [];
    const productId = googleSubscriptions.length === 1 ? googleSubscriptions[0].product_id : null;
    try {
      await Linking.openURL(googleSubscriptionManagementUrl(productId, overviewQuery.data?.billing?.packageName));
    } catch {
      Alert.alert('Could not open Google Play', 'Open Play Store → Payments & subscriptions → Subscriptions to manage or cancel your plan.');
    }
  }

  async function restoreGooglePlayPurchases() {
    if (!token || !connected || !storeProductIds.length || purchaseBusy.current || isRestoring) return;
    setIsRestoring(true);
    try {
      const activeSubscriptions = await getActiveSubscriptions(storeProductIds);
      let restored = 0;
      for (const subscription of activeSubscriptions) {
        const purchaseToken = subscription.purchaseToken || subscription.purchaseTokenAndroid;
        if (!purchaseToken || !storeProductIds.includes(subscription.productId)) continue;
        const result = await verifyGooglePlayAiSubscription(token, {
          productId: subscription.productId,
          purchaseToken,
        });
        if (result.active) restored += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ['ai-overview'] });
      Alert.alert(restored ? 'Purchase restored' : 'No active purchase found', restored ? 'Your Bascardo AI subscription is active again.' : 'Google Play did not return an active Bascardo AI subscription for this account.');
    } catch (caught) {
      Alert.alert('Restore failed', caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setIsRestoring(false);
    }
  }

  const overview = overviewQuery.data;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'AI Subscription' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Image source={{ uri: BASCARDO_LOGO_URL }} style={styles.heroLogo} resizeMode="contain" accessibilityLabel="Bascardo AI logo" />
            </View>
            <ThemedText type="title" style={styles.heroTitle}>Choose your AI allowance</ThemedText>
            <ThemedText style={styles.heroText}>
              Bascardo AI understands your FlyMadd catalogue sales, votes, and leaderboard position while keeping each account&apos;s data private.
            </ThemedText>
          </View>

          {overviewQuery.isLoading ? (
            <ActivityIndicator size="large" color={Palette.blue} style={styles.loading} />
          ) : overviewQuery.isError || !overview ? (
            <Pressable onPress={() => overviewQuery.refetch()} style={styles.errorCard}>
              <Ionicons name="refresh" size={20} color={Palette.red} />
              <ThemedText style={styles.errorText}>Couldn&apos;t load AI plans. Tap to retry.</ThemedText>
            </Pressable>
          ) : (
            <>
              <View style={styles.usageCard}>
                <View style={styles.usageTopRow}>
                  <View>
                    <ThemedText type="small" style={styles.usageEyebrow}>CURRENT PLAN</ThemedText>
                    <ThemedText type="subtitle" style={styles.usageTitle}>{overview.plan.name}</ThemedText>
                  </View>
                  <View style={styles.usagePill}>
                    <ThemedText type="smallBold" style={styles.usagePillText}>{overview.usage.creditsRemaining} left</ThemedText>
                  </View>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.trackFill,
                      { width: `${Math.min((overview.usage.creditsUsed / Math.max(overview.usage.creditsLimit, 1)) * 100, 100)}%` },
                    ]}
                  />
                </View>
                <ThemedText type="small" style={styles.usageCaption}>
                  {overview.usage.creditsUsed} of {overview.usage.creditsLimit} credits used · Resets {new Date(overview.usage.resetsAt).toLocaleDateString()}
                </ThemedText>
              </View>

              <View style={styles.planList}>
                {overview.plans.map((plan) => {
                  const isCurrent = plan.id === overview.plan.id;
                  const isRecommended = plan.id === 'pro';
                  const storeProduct = plan.id === 'free' ? undefined : storeProductForPlan(plan);
                  const monthlyOffer = monthlyGoogleOffer(storeProduct);
                  const storePrice = plan.id === 'free' ? 'Free' : monthlyOffer?.pricingPhases.pricingPhaseList[0].formattedPrice || 'Unavailable';
                  const isPurchasingThisPlan = purchasingProductId === storeProduct?.id;
                  return (
                    <View key={plan.id} style={[styles.planCard, isRecommended && styles.recommendedCard]}>
                      <View style={styles.planHeader}>
                        <View style={styles.planNameRow}>
                          <View style={[styles.planIcon, { backgroundColor: plan.id === 'business' ? Palette.blueSoft : Palette.yellowSoft }]}>
                            <Ionicons name={plan.id === 'business' ? 'briefcase' : plan.id === 'pro' ? 'sparkles' : 'leaf'} size={21} color={plan.id === 'business' ? Palette.blueDark : Palette.yellowInk} />
                          </View>
                          <View>
                            <ThemedText type="subtitle" style={styles.planName}>{plan.name}</ThemedText>
                            {isRecommended ? <ThemedText type="smallBold" style={styles.recommendedText}>RECOMMENDED</ThemedText> : null}
                          </View>
                        </View>
                        <View style={styles.priceWrap}>
                          <ThemedText type="title" style={styles.price}>{storePrice}</ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">/month</ThemedText>
                        </View>
                      </View>

                      <View style={styles.creditBanner}>
                        <Ionicons name="flash" size={17} color={Palette.blue} />
                        <ThemedText type="smallBold" style={styles.creditBannerText}>{plan.monthlyCredits} AI credits every month</ThemedText>
                      </View>

                      <View style={styles.features}>
                        {PLAN_FEATURES[plan.id].map((feature) => (
                          <View key={feature} style={styles.featureRow}>
                            <Ionicons name="checkmark-circle" size={18} color={Palette.green} />
                            <ThemedText type="small" style={styles.featureText}>{feature}</ThemedText>
                          </View>
                        ))}
                      </View>

                      <Pressable
                        onPress={() => void confirmPlan(plan)}
                        disabled={isCurrent || plan.id === 'free' || !monthlyOffer || verificationMutation.isPending || !!purchasingProductId || isRestoring}
                        style={[
                          styles.planButton,
                          isCurrent ? styles.currentButton : plan.id === 'free' ? styles.unavailableButton : styles.upgradeButton,
                        ]}
                      >
                        {isPurchasingThisPlan || (verificationMutation.isPending && plan.id !== 'free' && !isCurrent) ? (
                          <ActivityIndicator color={Palette.white} />
                        ) : (
                          <ThemedText style={[styles.planButtonText, (isCurrent || plan.id === 'free') && styles.planButtonTextMuted]}>
                            {isCurrent ? 'Current plan' : plan.id === 'free' ? 'Included' : `Subscribe with Google Play`}
                          </ThemedText>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          <View style={styles.costCard}>
            <Ionicons name="information-circle" size={22} color={Palette.blue} />
            <View style={styles.costCopy}>
              <ThemedText type="smallBold">How credits work</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.costText}>Normal AI chat costs 1 credit. A full business analysis costs 5 credits. Deleting chats does not reset usage.</ThemedText>
            </View>
          </View>

          <View style={styles.safetyCard}>
            <Ionicons name="shield-checkmark" size={22} color={Palette.green} />
            <View style={styles.costCopy}>
              <ThemedText type="smallBold" style={styles.safetyTitle}>Verified by Google Play</ThemedText>
              <ThemedText type="small" style={styles.safetyText}>Subscriptions renew automatically each month unless cancelled. Use Manage subscription to cancel or update payment details. Access continues until your paid period ends.</ThemedText>
            </View>
          </View>

          {overview?.subscription?.current_period_end ? (
            <ThemedText type="small" themeColor="textSecondary">
              {overview.subscription.pending_product_id ? `Plan change scheduled. ${overview.plan.name} access until` : overview.subscription.auto_renewing ? 'Renews' : 'Access until'} {new Date(overview.subscription.current_period_end).toLocaleDateString()}
            </ThemedText>
          ) : null}

          <Pressable onPress={() => void manageGooglePlaySubscription()} style={styles.restoreButton} accessibilityRole="link">
            <Ionicons name="settings-outline" size={18} color={Palette.blueDark} />
            <ThemedText style={styles.restoreButtonText}>Manage subscription / Cancel</ThemedText>
          </Pressable>

          <Pressable onPress={() => void restoreGooglePlayPurchases()} disabled={!connected || isRestoring || !!purchasingProductId} style={styles.restoreButton}>
            {isRestoring ? <ActivityIndicator color={Palette.blueDark} /> : <Ionicons name="refresh" size={18} color={Palette.blueDark} />}
            <ThemedText style={styles.restoreButtonText}>{isRestoring ? 'Restoring…' : 'Restore Google Play purchase'}</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={18} color={Palette.blue} />
            <ThemedText style={styles.backButtonText}>Back to Bascardo AI</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  hero: { borderRadius: 24, padding: Spacing.four, backgroundColor: Palette.blueDark, alignItems: 'center', gap: Spacing.two, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 5 },
  heroIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: Palette.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  heroLogo: { width: 51, height: 51, borderRadius: 16 },
  heroTitle: { color: Palette.white, fontSize: 25, lineHeight: 31, textAlign: 'center' },
  heroText: { color: '#DBEAFE', textAlign: 'center', lineHeight: 21 },
  loading: { marginVertical: Spacing.four },
  errorCard: { borderRadius: 16, padding: Spacing.three, flexDirection: 'row', gap: Spacing.two, backgroundColor: Palette.redSoft },
  errorText: { color: '#991B1B', flex: 1 },
  usageCard: { borderRadius: 20, padding: Spacing.three, gap: Spacing.two, backgroundColor: Palette.yellowSoft, borderWidth: 1, borderColor: '#FDE68A' },
  usageTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  usageEyebrow: { color: '#92400E', letterSpacing: 1, fontSize: 10 },
  usageTitle: { color: Palette.yellowInk, fontSize: 21 },
  usagePill: { backgroundColor: Palette.white, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  usagePillText: { color: Palette.yellowInk },
  track: { height: 9, borderRadius: 999, backgroundColor: '#FDE68A', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: Palette.yellow, borderRadius: 999 },
  usageCaption: { color: '#92400E' },
  planList: { gap: Spacing.three },
  planCard: { borderRadius: 22, padding: Spacing.three, gap: Spacing.three, backgroundColor: Palette.white, borderWidth: 1, borderColor: Palette.ash, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 9, elevation: 2 },
  recommendedCard: { borderColor: Palette.blue, borderWidth: 2 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  planIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  planName: { color: Palette.slateDark, fontSize: 20 },
  recommendedText: { color: Palette.blue, fontSize: 9, letterSpacing: 0.8 },
  priceWrap: { alignItems: 'flex-end' },
  price: { color: Palette.blueDark, fontSize: 24 },
  creditBanner: { minHeight: 42, borderRadius: 13, backgroundColor: Palette.blueSoft, paddingHorizontal: 12, flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  creditBannerText: { color: Palette.blueDark },
  features: { gap: 10 },
  featureRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  featureText: { color: Palette.slateDark, flex: 1 },
  planButton: { minHeight: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  upgradeButton: { backgroundColor: Palette.blue },
  currentButton: { backgroundColor: Palette.yellowSoft },
  unavailableButton: { backgroundColor: Palette.ashSoft },
  planButtonText: { color: Palette.white, fontWeight: '800' },
  planButtonTextMuted: { color: Palette.slate },
  costCard: { borderRadius: 17, padding: Spacing.three, backgroundColor: Palette.blueSoft, flexDirection: 'row', gap: 12 },
  costCopy: { flex: 1, gap: 3 },
  costText: { lineHeight: 19 },
  safetyCard: { borderRadius: 17, padding: Spacing.three, backgroundColor: '#DCFCE7', flexDirection: 'row', gap: 12 },
  safetyTitle: { color: '#166534' },
  safetyText: { color: '#166534', lineHeight: 19 },
  backButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: Palette.blueSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  backButtonText: { color: Palette.blueDark, fontWeight: '700' },
  restoreButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#FDE68A', backgroundColor: Palette.yellowSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  restoreButtonText: { color: Palette.blueDark, fontWeight: '700' },
});
