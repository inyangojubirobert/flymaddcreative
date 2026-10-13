// Web stand-in for react-native-iap (aliased in metro.config.js for web only).
// The real module loads a native (Nitro) bridge as soon as it is imported,
// which crashes any web page that imports it. Google Play billing doesn't
// exist on the web: the web app pays by card (Paystack) instead, so this
// reports "not connected" and never sells anything.

export function useIAP(_options?: unknown) {
  return {
    connected: false,
    products: [] as never[],
    subscriptions: [] as never[],
    fetchProducts: async (_request?: unknown) => {},
    requestPurchase: async (_request?: unknown) => {
      throw new Error('Google Play purchases are only available in the Android app');
    },
    finishTransaction: async (_request?: unknown) => {},
  };
}

export async function getAvailablePurchases(): Promise<never[]> {
  return [];
}
