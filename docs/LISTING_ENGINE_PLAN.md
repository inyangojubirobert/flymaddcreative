# Dynamic product & service listing engine: proposed changes (revision 4, for review)

Status: architecture approved in principle. The migration is NOT applied to production, and no application code has been changed for the engine. Payment security issues are documented separately in `docs/PAYMENT_SECURITY_FINDINGS.md` and are not fixed by this work. Revision 4 changes, security review, permission matrix, archive strategy and the dry-run procedure are in `docs/LISTING_ENGINE_REV4.md`.

## Database (not executed on production)

1. `supabase/review_catalogue_items_rls.sql`: read-only audit. The listing lockdown it verified is already applied.
2. `supabase/add_dynamic_listing_engine.sql` (revision 4): additive and rerunnable. It refuses to run if the lockdown is missing or if any listing has a status other than active/paused/deleted.
3. `supabase/rollback_dynamic_listing_engine.sql`: archives engine data into a private schema, verifies it, then drops the engine.
4. `supabase/dry_run_dynamic_listing_engine.sql`: generated from the two files above; runs everything in a transaction that is always rolled back.

## What is publishable vs. draft-only

The current checkout charges one unit at `price_usd` for any non-deleted listing. It does no stock, availability, scope or quantity checks. So `catalogue_items` holds only configurations where that is a complete and correct sale.

| Configuration | Status |
|---|---|
| Product, fixed price | Publishable (this is how all current listings already work) |
| Product, price per unit (one unit bought) | Publishable |
| Service, fixed price or per session, with a written scope (what is included) and terms (where, when, how) that the seller confirms are the complete offering | Publishable |
| Service without a confirmed complete scope | Draft only |
| Per project, hourly, daily, per night, per person, per area, monthly retainer, "other" pricing | Draft only |
| Request a quote (no price) | Draft only |
| Limited stock / stock quantity, preorder, made to order, out of stock | Draft only |
| Minimum or maximum order quantities, price ranges, pricing options / variants | Draft only |
| Condition, brand, SKU, fulfilment, delivery areas, estimated dispatch days, service modes, area, typical duration, experience, category attributes | Publishable, informational only, and labelled as such. Not enforced by checkout. |

Remaining exposure, not addressed here: a published listing that a seller pauses can still be bought by calling the payment endpoints directly (`docs/PAYMENT_SECURITY_FINDINGS.md`, item 3). The app must never describe paused or draft listings as protected from purchase.

## Proposed file changes (only after the migration and RLS review are approved)

Server:

- `pages/api/catalogue/items.js`:
  - Allow the new fields.
  - Validate the price as `Number.isFinite`, greater than 0, rounded to cents (no arbitrary upper cap).
  - Check that the pricing model is active and checkout-compatible.
  - For services, require scope, terms and the seller's confirmation.
  - Check category acceptance and validate attributes against their definitions ("Other" via `custom_label`).
  - Confirming a flagged listing's type sets `type_reviewed_at`.
  - If a confirmed type makes the listing non-publishable, offer "move to drafts". This soft-deletes the live row and creates a draft, so no ID is reused.
  - Map database `23514` errors to 400 and `42501` to 403.
  - Product/service details and attributes are written only for a listing owned by the logged-in seller (the database does not check this for details and attributes, so the API must).
- `pages/api/catalogue/drafts.js` (new): seller-owned CRUD on drafts, computing `blocking_reasons`. Publishing is allowed only when no blocking reason remains, and it sets `published_item_id`.
  - Every read, update and delete is filtered by the logged-in seller's `seller_username`; the client never supplies it.
  - `published_item_id` may only be set to a listing whose `seller_username` equals the draft's. The database enforces this for every role (error 42501 or 23503 maps to 403/404), so the API check is the first line of defence and the trigger is the backstop.
  - A listing's `seller_username` is never changed through the API; the database refuses it while another seller's draft is linked.
- `pages/api/catalogue/categories.js`: return `listing_types` and `suggested_listing_type`. Seller-created categories accept both types, with no suggestion.

Mobile:

- `mobile/src/api/catalogue.ts`: new types, the drafts API and the configuration reads.
- `mobile/src/app/catalogue/my-listings.tsx`: the dynamic form. It has these steps:
  1. listing type (pre-selected from `suggested_listing_type`, always changeable);
  2. category;
  3. pricing model and unit ("Other / specify");
  4. product or service fields;
  5. for services, scope, terms and a confirmation checkbox;
  6. category attributes;
  7. preview.

  Non-publishable configurations show "Saved as draft: not yet supported by checkout". It also adds a confirm-type prompt for flagged listings.
- `mobile/src/app/catalogue/item/[id].tsx`: show `$X / unit`, a display-only `≈ ₦Y` estimate, the service scope and terms, informational details and attributes. Purchase buttons stay unchanged for published listings.
- `mobile/src/app/shop/index.tsx` and `mobile/src/app/shop/category/[id].tsx`: show the price unit on cards; the Products/Services toggle can filter by `listing_type`.

Website (already done and deployed as the security fix):

- `public/user-dashboard.html` and `public/js/supabase-config.js` save and delete through `/api/catalogue/items` with the existing `onedream_token`, and the form has a category picker.
- The lockdown that removed anon/authenticated write access on `catalogue_items` has been applied.

Not touched: `create-payment-intent.js`, `verify-order.js`, `orders.js`, `order-action.js`, `admin/orders.js`, `lib/verifyCryptoTx.js`, `lib/currency.js`, `lib/aiPayments.js`, wallet, boost and subscription code, and `catalogue_orders` / `usdt_payments`.
