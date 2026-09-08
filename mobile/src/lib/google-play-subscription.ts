import type { ProductSubscription, Purchase, RequestPurchaseProps } from 'react-native-iap';
import type { AiOverview } from '../api/ai';

// react-native-iap 14.7's native bridge forwards the purchase-level numeric
// modes. Its newer item-level type exists but is not forwarded by that bridge.
const REPLACEMENT_MODE = { CHARGE_PRORATED_PRICE: 2, DEFERRED: 6 } as const;

export function monthlyGoogleOffer(product?: ProductSubscription) {
  if (product?.platform !== 'android') return undefined;
  const offers = product.subscriptionOfferDetailsAndroid.filter((offer) => (
    !offer.offerId && offer.offerToken && offer.pricingPhases.pricingPhaseList.length === 1
    && offer.pricingPhases.pricingPhaseList[0].billingPeriod === 'P1M'
    && offer.pricingPhases.pricingPhaseList[0].recurrenceMode === 1
  ));
  // Fail closed if Console has ambiguous base plans. Never pass all offers for
  // one SKU, or present an introductory price as the recurring monthly price.
  return offers.length === 1 ? offers[0] : undefined;
}

export function googleSubscriptionManagementUrl(productId?: string | null, packageName = 'com.flymaddcreative.onedream') {
  const base = 'https://play.google.com/store/account/subscriptions';
  return productId ? `${base}?sku=${encodeURIComponent(productId)}&package=${encodeURIComponent(packageName)}` : base;
}

export function googleSubscriptionRequest(
  product: ProductSubscription,
  purchases: Purchase[],
  overview: AiOverview,
  participantId: string,
): { request: RequestPurchaseProps; deferred: boolean } {
  if (!overview.billing || overview.billing.integrationVersion < 2) {
    throw new Error('Subscriptions are temporarily unavailable. Please try again later.');
  }
  const products = overview.storeProducts.googlePlay;
  const knownIds = Object.values(products);
  const offer = monthlyGoogleOffer(product);
  if (!offer || !knownIds.includes(product.id)) throw new Error('This monthly plan is currently unavailable.');
  const existing = purchases.filter((purchase) => knownIds.includes(purchase.productId));
  if (existing.some((purchase) => purchase.purchaseState === 'pending')) {
    throw new Error('A Google Play payment is pending. Complete or cancel it before changing plans.');
  }
  const tokens = new Set(existing.map((purchase) => purchase.purchaseToken));
  if (tokens.size > 1) throw new Error('More than one subscription was found. Use Manage subscription to review them before changing plans.');
  const current = existing[0];
  if (current && !current.purchaseToken) throw new Error('Restore your Google Play purchase before changing plans.');
  if (current?.productId === product.id) throw new Error('You already own this plan. Your access has been refreshed.');
  if (overview.billing.subscriptions.some((subscription) => subscription.provider === 'paystack')) {
    throw new Error('You have a website subscription. Manage that subscription on the website before starting Google Play billing.');
  }
  const googleSubscriptions = overview.billing.subscriptions.filter((subscription) => subscription.provider === 'google_play');
  if (googleSubscriptions.some((subscription) => subscription.pending_product_id || ['pending', 'past_due'].includes(subscription.status))) {
    throw new Error('A plan change or payment needs attention. Open Manage subscription before making another purchase.');
  }
  if (googleSubscriptions.length > 1 || (googleSubscriptions.length && !current)) {
    throw new Error('Sign in to the Google Play account holding your subscription, then restore purchases before changing plans.');
  }
  if (current && googleSubscriptions.length && googleSubscriptions[0].product_id !== current.productId) {
    throw new Error('Your subscription is still updating. Restore purchases and try again.');
  }
  const deferred = current?.productId === products.business && product.id === products.pro;
  return {
    deferred,
    request: {
      type: 'subs',
      request: {
        google: {
          skus: [product.id],
          subscriptionOffers: [{ sku: product.id, offerToken: offer.offerToken }],
          obfuscatedAccountIdAndroid: participantId,
          ...(current ? {
            purchaseTokenAndroid: current.purchaseToken,
            replacementModeAndroid: deferred ? REPLACEMENT_MODE.DEFERRED : REPLACEMENT_MODE.CHARGE_PRORATED_PRICE,
          } : {}),
        },
      },
    },
  };
}
