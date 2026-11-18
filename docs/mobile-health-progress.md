# Mobile health integration — 2026-10-21

## Implemented locally

- Capacitor 8 projects: `frontend/android`, `frontend/ios`; application ID `online.lifehapp.app`.
- Read-only steps and sleep through `@capgo/capacitor-health`. No Capgo cloud account or OTA service.
- Explicit metric selection and consent before OS authorization and upload. No health data goes to OpenAI.
- Seven local calendar days refreshed on foreground and on demand. No background delivery promised.
- Native aggregated steps; independent calendar-day requests handle DST boundaries. Sleep intervals are clipped and merged to avoid duplicate watch/phone records. Awake/in-bed stages are excluded. Android sessions without stages are duration estimates.
- Imported sleep is measured per calendar day, not attributed entirely to wake-up date. Manual sleep has priority for its date in the home chart.
- Missing data remains null. HealthKit intentionally cannot distinguish denied read access from absent data.
- The phone timezone must match the Life Hub profile timezone.
- Backend migration `0011_device_health`, account-scoped snapshots, rotating connection credential and optimistic revision. Repeated uploads never increment totals. Disconnect invalidates pending uploads; reconnect invalidates older devices.
- One active provider per account. Older provider records remain available in account export; only the selected provider appears in the UI. Delete imported data removes all provider snapshots.
- Health screen, home steps widget and sleep overview. Browser can display imported data but cannot read OS health stores.
- Export includes imported values and connection status, excludes the connection credential. Account deletion covers both new tables.

## Build and rollout

From repository root: `pnpm --dir frontend run mobile:sync` builds the React app and copies assets into both native projects.
Android: JDK 21, Android SDK platform 36, then `frontend/android/gradlew.bat -p frontend/android assembleDebug`. Set JAVA_HOME for this shell only and SDK path via ignored `frontend/android/local.properties`.
iPhone: open `frontend/ios/App/App.xcodeproj` on macOS with Xcode, choose a signing team/provisioning profile for the bundle ID and HealthKit entitlement, build on a real device. Windows cannot run this build. A cloud macOS build still requires Apple signing setup.

Native API requests target `https://lifehapp.online`; Capacitor native HTTP is enabled. Deploy the backend and migrate through 0011 before testing sync against production. None of these changes have been deployed in this task.
Native authentication must be verified on devices. Email/password uses the existing API. Web Google login/calendar callbacks are not a verified native OAuth flow; native OAuth/deep-link handling remains a separate required check before claiming the wrapper is a complete replacement for the web app. Session credentials remain session-only as in the existing web security design.

## Remaining device checks

- Install Android debug APK on the user's phone; verify Health Connect availability, partial permission, denial, revocation, real steps and sleep, resume, reconnect and disconnect.
- Build/sign on macOS and repeat with HealthKit on iPhone. No Mac is currently available.
- Check voice, photo picker, safe areas, navigation and login in each native WebView.
- Before store release: signed release builds, actual app icons, app privacy disclosures, store health permissions declarations and privacy-policy publication. The packaged rationale page is `frontend/public/privacypolicy.html`.
- Server deployment/access and real-device synchronization have not been verified. Do not present native scaffolding or mock data as successful hardware sync.

## Verification

- Frontend: 70 tests passed; production build and Capacitor Android/iOS sync passed.
- Backend health/product/migration group: 15 passed, one PostgreSQL locking test skipped (no test PostgreSQL configured).
- Chat/dashboard/media regression group: 24 passed.
- Browser: local synthetic account, health connection card renders; web correctly has no native connect button.
- Final health tests: 6 passed, including export without credential and manual-sleep priority. TypeScript checks and final production asset sync passed. Mobile-width browser check (390 px) has no horizontal overflow.

### Local toolchain

Portable Temurin 21 downloaded from the official Adoptium API to `%TEMP%/lifehub-jdk21/jdk-21.0.12.1+1`; no system Java setting changed. Gradle 8.14.3 wrapper downloaded successfully. Android SDK is at `%LOCALAPPDATA%/Android/Sdk`. The project's Cyrillic Windows path requires `android.overridePathCheck=true` (set in the project; no NDK sources). ADB currently reports no attached devices.

Android build verification: SDK Build Tools 35 and Platform 36 installed using the existing accepted SDK licenses. Merged manifest contains only health READ_STEPS and READ_SLEEP permissions; no health write permission. Health Connect Kotlin compilation passed. APK packaged successfully at `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (6,682,747 bytes). APK ZIP integrity and debug signature verified; packaged index and privacy page match the current source/build. Actual APK permission dump confirms only READ_STEPS / READ_SLEEP for health.

Device data must already exist in Apple Health / Health Connect from a phone, watch or source app. Life Hub reads the stores; it does not independently measure steps or infer sleep from motion.

The APK is a development build, not a store release. The production health API is not deployed yet, so installation alone does not enable real synchronization. No physical device was available through ADB during this task.
