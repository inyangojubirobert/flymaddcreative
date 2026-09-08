// Shared allowlist for Paystack `callback_url` values. This ends up in the
// user's browser after a real payment completes, so an unrestricted
// client-supplied URL here would be an open-redirect / phishing vector -
// only our own website or the mobile app's own deep-link scheme are allowed.
// Used by both pages/api/onedream/create-payment-intent.js (votes) and
// pages/api/catalogue/create-payment-intent.js (marketplace checkout).

export function resolveCallbackUrl(callbackUrl, defaultUrl) {
  if (!callbackUrl) return defaultUrl;
  const isOwnSite = callbackUrl.startsWith(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online');
  const isAppScheme = callbackUrl.startsWith('flymaddcreative://');
  return (isOwnSite || isAppScheme) ? callbackUrl : defaultUrl;
}
