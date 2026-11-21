# One Dream: to do

## Any time

1. [ ] **Phone notifications for admin alerts (and later for users).** Admin → Alerts & reminders → Phone notifications shows "This app is not linked to an Expo project yet". **No EAS Build needed**: the local Gradle APK/AAB for Google Play works. Steps:
   1. `cd mobile`, sign in to a free Expo account (`npx eas login`), run `npx eas init`. It only registers the project and writes `extra.eas.projectId` into `app.json`; nothing is built.
   2. Firebase console → new project → add the Android app (the package name in `mobile/app.json`) → download `google-services.json` into `mobile/` and set `android.googleServicesFile` in `app.json`.
   3. Firebase → Project settings → Service accounts → generate a private key, and upload it at expo.dev → this project → Credentials → Android → FCM V1 service account key.
   4. Rebuild the APK/AAB (bump `versionCode` in `mobile/app.json` and `mobile/android/app/build.gradle`).

   Until then admin alerts come through Telegram (Admin → Alerts & reminders) and the in-app full-screen alarm.

2. [ ] **Admin tab**: link each admin's login to their app account (`supabase/add_admin_app_and_alarm.sql`, step 5), then connect the Telegram bot in Admin → Alerts & reminders and send a test.
3. [ ] **Google AdMob ads (not set up yet: no AdMob in the app).**
   You:
   1. admob.google.com → sign in with the same account as Book of Memes (publisher `ca-app-pub-6266232423124941`) → Apps → Add app → Android, "listed on Google Play" → `com.flymaddcreative.onedream`. Note the **app ID** (`ca-app-pub-…~…`).
   2. Ad units → create a **Native advanced** or **Banner** unit for the in-feed ad slots (home, shop, search, category), and a **Rewarded** unit only if we want "watch an ad to unlock". Note each **unit ID** (`ca-app-pub-…/…`).
   3. AdMob → Settings: turn on **impression-level ad revenue**, reporting currency **USD**. Privacy & messaging → create the **GDPR (EU consent) message** for the app.
   4. Send Claude the app ID and unit IDs (they are not secret).

   Claude:
   5. Add `react-native-google-mobile-ads` with the app ID in `mobile/app.json`. AdMob fills an ad slot only when no paid ad, house ad or brand-network ad is using it, so paid advertisers always come first. Web app and website: no AdMob (different product, AdSense).
   6. Show the consent form on first launch where required, and publish `app-ads.txt` at `https://flymaddcreative.vercel.app/app-ads.txt` (must be the developer website in the Play listing).
   7. Rebuild the AAB. Play Console → App content → Ads: already "Yes" (house ads); check the Data safety form lists the advertising ID.

4. [ ] **Brand network**: add product ads (website admin portal → House ads → Our products, or Book of Memes → Our products). They show in all our apps except the product's own.
