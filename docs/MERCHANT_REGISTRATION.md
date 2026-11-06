# Merchant Registration

How merchants sign up for the One Dream referral program on the website (desktop and mobile browsers) and in the web app at `/app`. It also lists the problems found in October 2026 and how each one was fixed.

## What a merchant is

A merchant is a referrer. Merchant accounts are separate from participant accounts: they have their own table (`referral_merchants`), their own password and their own JWT.

After signing up, a merchant gets a referral link like this:

```
https://www.flymaddcreative.online/registration.html?ref=MERCH-XXXXXXXX
```

When a participant registers through that link, the participant row stores `referred_by_merchant_link_id`. When that participant's vote is confirmed, `lib/merchantRewards.js` credits the merchant with tokens. The default is 50 tokens per vote (`MERCHANT_REWARD_TOKENS_PER_VOTE`). The merchant can then withdraw the tokens to a wallet from the dashboard.

## Entry points

| Surface | File | Calls |
|---|---|---|
| Website (desktop and mobile browser) | `public/merchant-register.html` | `POST /api/merchants/register` |
| Web app `/app` and APK | `mobile/src/app/merchant/register.tsx` → `MerchantAuthContext` → `mobile/src/api/merchants.ts` | `POST /api/merchants/register` |
| Legacy path | `pages/api/merchant/register.js` | Re-exports the same handler |

Links to the website page appear in `Onedream.html` (three CTAs) and `merchant-login.html`. In the app, the screen is reached from `/merchant/login` → "Become a merchant".

## Flow

1. **The client validates the form.** It checks that the name, email and password are filled in, that the email is valid, that the password has at least 8 characters, and that the password and its confirmation match. The website also requires the terms box to be ticked.
2. **The server (`pages/api/merchants/register.js`) handles the request:**
   1. It validates the same fields again, rejecting non-string input and names that are too long.
   2. It lowercases and trims the email, then checks it against `referral_merchants`. A duplicate returns **409** "Email already registered. Please log in instead."
   3. It hashes the password with bcrypt (10 rounds) and inserts the merchant with `status='active'` and a balance of 0. A unique-constraint race (`23505`) also returns 409.
   4. It makes sure a referral link exists. If a DB trigger already created one, it reuses that link. Otherwise it creates a `MERCH-XXXXXXXX` link, retrying if the code collides.
   5. It signs a 7-day JWT `{ id, email, type: 'merchant' }` with `getJwtSecret()`, using the same payload as `/api/merchants/login`.
   6. It responds with **201**:
      ```json
      {
        "success": true,
        "merchant": { "id": "…", "merchant_name": "…", "email": "…", "…": "…", "token": "<jwt>", "referral_link": "<full_link>" },
        "referral_link": { "id": "…", "link_code": "MERCH-…", "full_link": "…", "is_active": true }
      }
      ```
3. **The client signs the merchant in:**
   - **Website:** stores `merchantToken`, `merchantId`, `merchantEmail` and `merchantName` in localStorage. These are the keys `merchant-login.html` writes and `merchant-dashboard.html` reads. It then shows the referral link with a Copy button and a "Go to Dashboard" button.
   - **App:** stores the token and a snapshot of the merchant in secure storage. The `Stack.Protected` guard in `merchant/_layout.tsx` then switches to the dashboard.

Every request after this (dashboard, create or toggle link, withdraw, edit profile) sends `Authorization: Bearer <token>`. `lib/merchantAuth.js` checks that the token belongs to the merchant id in the URL.

## Problems found and fixed

| # | Where | Problem | Effect | Fix |
|---|---|---|---|---|
| 1 | `pages/api/merchants/register.js` | The response had no token | App and `/app` registration: the token was `undefined`, so the new merchant was never signed in | The endpoint now signs and returns `merchant.token` |
| 2 | `public/merchant-register.html` → `pages/api/merchant/register.js` | The website used a separate legacy copy of the endpoint, which signed `{ merchantId }` and fell back to a hard-coded secret | Tokens could not be used with the merchant routes; a new merchant had to log in again | The website now calls `/api/merchants/register`, and the legacy file re-exports the canonical handler |
| 3 | `pages/api/merchants/register.js` | It relied on a DB trigger to create the referral link | With no trigger, a new merchant had no link and the success screen showed the placeholder text "Referral link generated", which the Copy button copied | The endpoint creates the link when the trigger has not, and the website hides the link box if no link comes back |
| 4 | Both register endpoints | The duplicate-email check used `.single()` | A database error or a duplicate row skipped the check and the request fell through to the insert | Uses `.limit(1).maybeSingle()` and treats errors as failures |
| 5 | Both register endpoints | Status codes and error fields were inconsistent (400 vs 409, `message` vs `error`) | Error messages differed between the website and the app | Always `{ success:false, error }`; duplicates return 409 |
| 6 | Merchant routes under `pages/api/merchants/[id]/*` and `links/[linkId]` | The ownership check in `lib/merchantAuth.js` existed, but no route called it | Merchant tokens were never actually checked | All five routes now call `requireMerchantOwnership` / `requireMerchant`, and a link toggle is limited to the merchant's own links. Both clients already sent the header |
| 7 | `pages/api/merchants/login.js` | Fell back to a hard-coded JWT secret | The secret did not match the verifier if the environment variable was missing | Uses `getJwtSecret()` |
| 8 | `merchant-register.html` | `copyReferralLink()` relied on the global `event` | Fragile in some browsers | The button passes itself in, and there is a fallback when the clipboard is unavailable |
| 9 | `merchant-register.html` | `response.json()` threw on non-JSON 5xx responses | The user saw "Unable to connect to server" for a server error | Parses safely and shows the server's message |
| 10 | `merchant-register.html` | The Terms and Privacy links were `#`, and an `alert()` was shown for the unticked terms box | Dead links, inconsistent UX | Links to `/privacy-policy.html` and shows the error inline |
| 11 | `mobile/.../merchant/register.tsx` | No email-format check, no password confirmation, and a double tap could submit twice | Typos only showed up on the server, and a merchant could lock themselves out with a mistyped password | Adds a confirm-password field, an email check and a guard against double submits; also lowercases the email and sets `autoComplete` |

## Follow-up fixes (second pass)

- **Terms:** added `public/merchant-program.html`, which states the program rules: how referrals earn, the 50-token minimum withdrawal, what is not allowed, and a link to the privacy policy. The website checkbox and the app screen link to it. The owner should review the wording.
- **Legacy routers removed:** `pages/api/merchantRoutes.js`, `pages/api/merchants/[...slug].js` and `pages/api/merchant/index.js` are deleted. They duplicated register, login, dashboard, withdraw and profile without the ownership checks, and no client called them. `/api/merchant/register` still works through its re-export.
- **Rate limit:** register allows 5 attempts per IP per 10 minutes and login allows 10, both through `checkRateLimit` in `lib/onedreamHelpers.js`. The limit is per serverless instance, so it slows scripts but does not hard-cap them.

## Still open

- **Merchant compensation is not live.** The 50-token reward is never credited, the tokens have no value, and a merchant withdrawal pays nothing. See [MERCHANT_COMPENSATION_REVIEW.md](MERCHANT_COMPENSATION_REVIEW.md) for the review and the recommended USD commission model (needs owner approval).
- **No email verification.** The project has no email provider (no Resend, SendGrid or nodemailer). Pick one before adding verification.
- **Sessions issued by the old website endpoint will be rejected.** Their token payload was `{ merchantId }`, so the dashboard clears the session and sends the merchant to log in once.

## Testing checklist

- [ ] A 6th sign-up from the same IP within 10 minutes gets 429.
- [ ] Website: register a new email → the success card shows a `MERCH-` link, Copy works, and "Go to Dashboard" opens the dashboard already signed in.
- [ ] Website: register the same email again → "Email already registered. Please log in instead."
- [ ] `/app` → Merchant → Become a merchant: mismatched passwords are blocked; a valid sign-up lands on the dashboard and the link shows there.
- [ ] Dashboard calls without a token, or with another merchant's token, return 401/403.
- [ ] A participant who registers via `registration.html?ref=MERCH-…` sets `referred_by_merchant_link_id`.
