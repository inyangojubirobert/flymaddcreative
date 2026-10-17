import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getAvailablePurchases, useIAP, type Purchase } from 'react-native-iap';

import { verifyCoinPurchase, type CoinPackage } from '@/api/gifts';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';

// Google Play consumable purchases for Dream Coin packages (Android only).
// Separate from ads/boosts (promo-billing.tsx) and the AI subscription.
//
// Quantity: Google Play Billing has no API to request a quantity - when
// multi-quantity is enabled for a product in Play Console, the buyer picks
// it in Google's own purchase sheet. The server reads the verified quantity
// from Google and credits quantity x coins per unit; the app never sends a
// quantity. "Buy" is enabled only for products Google Play returns, so a
// product not yet created in Play Console can't be bought.

export type CoinStore = {
  ready: boolean;
  busyPackageId: string | null;
  priceFor: (pkg: CoinPackage) => string | null;
  buy: (pkg: CoinPackage) => void;
};

export function CoinStoreProvider({ packages, onCredited, children }: {
  packages: CoinPackage[];
  onCredited: () => void;
  children: (store: CoinStore) => React.ReactNode;
}) {
  const { token, participant } = useAuth();
  const [busyPackageId, setBusy] = useState<string | null>(null);
  const verifying = useRef(new Set<string>());

  const byProduct = useMemo(() => {
    const map = new Map<string, CoinPackage>();
    for (const pkg of packages) if (pkg.purchasable) map.set(pkg.google_play_product_id, pkg);
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
    // Credit any purchase that was paid but not yet verified (app closed,
    // network lost, or a pending payment that has since completed).
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
      const result = await verifyCoinPurchase(token, { productId: purchase.productId, purchaseToken });
      if (result.pending) {
        if (interactive) Alert.alert('Payment pending', 'Google Play is still processing this payment. Your coins appear once it completes.');
        return;
      }
      // The server already consumed it; this just clears it on the device.
      await finishTransaction({ purchase, isConsumable: true }).catch(() => {});
      onCredited();
      if (interactive) {
        const units = result.quantity && result.quantity > 1 ? ` (${result.quantity} packs)` : '';
        Alert.alert('Dream Coins added', `${(result.total_coins ?? 0).toLocaleString()} coins${units} added to your balance.`);
      }
    } catch (error) {
      if (interactive) Alert.alert('Could not confirm purchase', error instanceof ApiError ? error.message : 'Open Dream Coins again shortly - purchases are confirmed automatically.');
    } finally {
      verifying.current.delete(purchaseToken);
      setBusy(null);
    }
  }

  function product(pkg: CoinPackage) {
    return products.find((p) => p.id === pkg.google_play_product_id);
  }

  const store: CoinStore = {
    ready: connected,
    busyPackageId,
    priceFor: (pkg) => product(pkg)?.displayPrice ?? null,
    buy: (pkg) => {
      const item = product(pkg);
      if (!participant || !item) {
        Alert.alert('Not available', 'This coin package is not available on Google Play right now.');
        return;
      }
      Alert.alert(
        `Buy ${pkg.coins_per_unit.toLocaleString()} Dream Coins?`,
        `${item.displayPrice} per pack through Google Play. If Google Play offers a quantity, you get ${pkg.coins_per_unit.toLocaleString()} coins for each pack. `
          + 'Dream Coins are for sending appreciation gifts only: they have no cash value and cannot be withdrawn, transferred or used for votes or prizes.',
        [
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
        ],
      );
    },
  };

  return <>{children(store)}</>;
}
