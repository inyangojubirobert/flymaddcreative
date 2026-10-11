import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getAvailablePurchases, useIAP, type Purchase } from 'react-native-iap';

import { verifyAdPurchase, type AdPackage } from '@/api/ads';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';

// Google Play one-time purchases for advertising & boost packages.
// Mounted on Android when the server reports packages with a Play product id.
// "Buy" is enabled per package only when Google Play returns that product
// (anything not yet created in Play Console shows "Awaiting Google Play
// configuration"). Entitlements are granted only by the server after it
// verifies the purchase with Google.
// Separate from the AI subscription flow (ai-subscription-billing.tsx).

export type PromoStore = {
  ready: boolean;
  busyPackageId: string | null;
  priceFor: (pkg: AdPackage) => string | null;
  buy: (pkg: AdPackage) => void;
};

export function PromoStoreProvider({ packages, onGranted, children }: {
  packages: AdPackage[];
  onGranted: () => void;
  children: (store: PromoStore) => React.ReactNode;
}) {
  const { token, participant } = useAuth();
  const [busyPackageId, setBusy] = useState<string | null>(null);
  const verifying = useRef(new Set<string>());

  const byProduct = useMemo(() => {
    const map = new Map<string, AdPackage>();
    for (const pkg of packages) if (pkg.purchasable && pkg.google_play_product_id) map.set(pkg.google_play_product_id, pkg);
    return map;
  }, [packages]);
  const skus = useMemo(() => [...byProduct.keys()], [byProduct]);

  const { connected, products, fetchProducts, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: (purchase) => { void complete(purchase, true); },
    onPurchaseError: (error) => {
      setBusy(null);
      if (!String(error.code).toLowerCase().includes('cancel')) {
        Alert.alert('Purchase not completed', error.message || 'Google Play could not complete the purchase.');
      }
    },
  });

  useEffect(() => {
    if (!connected || !skus.length) return;
    void fetchProducts({ skus, type: 'in-app' }).catch(() => {});
    // Finish any purchase that was paid but not yet verified (app closed, network lost).
    void getAvailablePurchases()
      .then((owned) => owned.filter((p) => byProduct.has(p.productId)).forEach((p) => void complete(p, false)))
      .catch(() => {});
  }, [connected, skus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function complete(purchase: Purchase, interactive: boolean) {
    if (!token || !byProduct.has(purchase.productId)) return;
    const purchaseToken = purchase.purchaseToken;
    if (!purchaseToken || verifying.current.has(purchaseToken)) return;
    verifying.current.add(purchaseToken);
    try {
      const result = await verifyAdPurchase(token, { productId: purchase.productId, purchaseToken });
      if (result.pending) {
        if (interactive) Alert.alert('Payment pending', 'Google Play is still processing this payment. Your package appears once it completes.');
        return;
      }
      // The server already consumed it; this just clears it on the device.
      await finishTransaction({ purchase, isConsumable: true }).catch(() => {});
      onGranted();
      if (interactive) Alert.alert('Package ready', 'Create your campaign from "Your packages".');
    } catch (error) {
      if (interactive) Alert.alert('Could not confirm purchase', error instanceof ApiError ? error.message : 'Open Promote again shortly - purchases are confirmed automatically.');
    } finally {
      verifying.current.delete(purchaseToken);
      setBusy(null);
    }
  }

  function product(pkg: AdPackage) {
    return products.find((p) => p.id === pkg.google_play_product_id);
  }

  const store: PromoStore = {
    ready: connected,
    busyPackageId,
    priceFor: (pkg) => product(pkg)?.displayPrice ?? null,
    buy: (pkg) => {
      const item = product(pkg);
      if (!participant || !item) {
        Alert.alert('Not available', 'This package is not available on Google Play right now.');
        return;
      }
      // Google Play charges the Play Console price. If it is in USD it must
      // match what we show; otherwise the local Play price is shown to confirm.
      if (item.currency === 'USD' && typeof item.price === 'number' && Math.abs(item.price - pkg.price_usd) > 0.01) {
        Alert.alert('Temporarily unavailable', 'The price of this package is being updated. Please try again later.');
        return;
      }
      Alert.alert(`Buy ${pkg.name}?`, `${item.displayPrice} through Google Play. You can create the campaign right after purchase.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            setBusy(pkg.id);
            void requestPurchase({
              type: 'in-app',
              request: { google: { skus: [item.id], obfuscatedAccountIdAndroid: participant.id } },
            }).catch((error) => {
              setBusy(null);
              Alert.alert('Purchase not started', error instanceof Error ? error.message : 'Please try again.');
            });
          },
        },
      ]);
    },
  };

  return <>{children(store)}</>;
}
