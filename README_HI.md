# UZRAN Marketplace — Android (Capacitor) project

यह ZIP मौजूदा UZRAN full-stack starter को Android APK बनाने योग्य Capacitor project में बदलने की तैयारी करता है। इसमें वही ग्राहक storefront, seller panel, owner/admin, products, cart, COD orders और Razorpay server-side endpoints रखे गए हैं।

## क्या तैयार है
- Capacitor 7 configuration: App ID `in.uzran.marketplace`, App name `UZRAN`, web assets folder `www/`।
- `public/runtime-config.js` से API URL configurable है। Android release में API को deployed HTTPS URL पर भेजना होगा; localhost default नहीं है।
- `npm run build:web` storefront को `www/` में कॉपी करता है।
- Android app के लिए icon और splash placeholders `resources/icon.png` तथा `resources/splash.png` में हैं।
- Backend में Capacitor Android origins (`https://localhost`, `http://localhost`) के लिए configurable CORS handling जोड़ी गई है। Production API domain को `.env` के `CORS_ORIGINS` में exact origin के रूप में जोड़ें।
- Server-side Razorpay order creation और signature verification code सुरक्षित रखा गया है; Razorpay secret server `.env` में ही रहेगा।

## APK बनाने के लिए आवश्यक चीजें
1. कंप्यूटर पर Node.js 20+, Android Studio, Android SDK और Android SDK Platform Tools install करें। इस ZIP में अभी Android native platform folder generated नहीं है; नीचे दिए `cap add android` command से Capacitor इसे बनाएगा।
2. ZIP extract करके project folder में terminal खोलें:
   ```bash
   npm install
   npm run build:web
   npx cap add android
   npx cap sync android
   npx cap open android
   ```
3. Android Studio में Gradle sync पूरा होने दें। SDK license/updates मांगे तो स्वीकार करें।
4. `Build > Build Bundle(s) / APK(s) > Build APK(s)` चुनें। Debug APK सामान्यतः यहां बनेगा:
   `android/app/build/outputs/apk/debug/app-debug.apk`
5. Signed release के लिए Android Studio में `Build > Generate Signed Bundle / APK` चुनें, नया keystore सुरक्षित जगह बनाएं और passwords को चैट/ZIP में न रखें। Release APK सामान्यतः `android/app/build/outputs/apk/release/` में बनेगा।

## Live API URL सेट करना (बहुत जरूरी)
1. `public/runtime-config.js` खोलें और placeholder बदलें:
   ```js
   window.UZRAN_CONFIG = {
     API_BASE_URL: "https://api.your-real-domain.in"
   };
   ```
   केवल domain origin दें; अंत में `/api` न जोड़ें। HTTPS जरूरी है।
2. Server deploy करने के बाद `.env` में `NODE_ENV=production`, मजबूत `SESSION_SECRET`, मजबूत `ADMIN_PASSWORD`, `DEV_OTP=false` और `CORS_ORIGINS` में `https://localhost,http://localhost,https://your-site-domain.in` सहित आवश्यक exact origins रखें।
3. API server deploy/update करने के बाद:
   ```bash
   npm run cap:sync
   ```
   फिर Android Studio में build करें।

## App icon / splash बदलना
- Placeholder assets: `resources/icon.png` (1024×1024) और `resources/splash.png` (2732×2732)। इन्हें final brand artwork से बदलें।
- फिर `npx capacitor-assets generate --android` चलाएँ (assets CLI package `@capacitor/assets` dependencies में शामिल है), और `npx cap sync android` चलाएँ।

## अभी बाकी / इसे production-ready न मानें
- Final API domain और hosting/server deployment; HTTPS certificate और production database/backups/monitoring।
- Real SMS OTP provider, DLT/template/consent setup और production OTP delivery।
- Razorpay Key ID/Secret को केवल server environment में जोड़ना; browser checkout UI, webhook signature verification, idempotency, refunds/reconciliation और end-to-end payment tests अभी बाकी हैं। अभी ONLINE checkout को live ग्राहकों के लिए enable न करें।
- Production session store/Redis, CSRF/session hardening, rate-limit review, security audit, privacy policy, terms, return/refund policy, seller agreement, shipping/tracking, GST/invoice, payout/commission flows।
- Final logo/splash, app screenshots, Play Store listing, privacy/data-safety declarations और release signing keystore।
- Android SDK/Android Studio build इस environment में नहीं चलाया गया; इसलिए कोई APK या signed APK तैयार होने का दावा नहीं है।

## Backend चलाना (PC/server)
```bash
cp .env.example .env
npm install
npm start
```
Development OTP केवल `DEV_OTP=true` और non-production mode में server terminal पर print होता है। Production में इसे बंद करके SMS provider जोड़ें।

**सुरक्षा:** `.env`, Razorpay secret और signing keystore को ZIP, Git या चैट में साझा न करें। यह starter है, audited production marketplace नहीं।

## सिर्फ Android फोन से APK बनाना (कंप्यूटर के बिना)

इस ZIP में `.github/workflows/build-android-apk.yml` GitHub Actions cloud build workflow शामिल है। इससे APK GitHub के सर्वर पर बनेगा; फोन में Android Studio लगाने की जरूरत नहीं है।

1. ZIP को फोन में डाउनलोड करके Extract करें।
2. GitHub अकाउंट बनाएं/लॉगिन करें और नया **Public** या **Private** repository बनाएं, नाम `uzran-android` रखें।
3. Extract किए गए `UZRAN_Android_Project` फोल्डर के अंदर की सभी फाइलें और `.github` छिपा फोल्डर repository के root में अपलोड करें। ध्यान दें: `.github/workflows/build-android-apk.yml` भी जरूर अपलोड हो। यदि मोबाइल ब्राउज़र hidden files न दिखाए, GitHub का मोबाइल वेब/डेस्कटॉप साइट मोड या GitHub मोबाइल ऐप इस्तेमाल करें।
4. Repository में **Actions** टैब खोलें → **Build UZRAN Android APK** → **Run workflow** दबाएं। पहली बार GitHub Actions enable करने की अनुमति मांगे तो enable करें।
5. Build पूरा होने पर workflow run खोलें। नीचे **Artifacts** में `UZRAN-debug-APK` डाउनलोड करें। ZIP खोलकर `app-debug.apk` फोन में इंस्टॉल करें। Android में जरूरत पड़ने पर इस स्रोत से install की अनुमति दें।

यह cloud workflow केवल **debug/test APK** बनाता है, Play Store के लिए signed release APK/AAB नहीं। GitHub पर source code रखने से पहले `.env` या कोई secret key अपलोड न करें। Razorpay Secret और SMS credentials GitHub source में न रखें। यह APK बनाने की प्रक्रिया है; लाइव API server/domain और वास्तविक SMS/Razorpay credentials अलग से configure करने होंगे।
