# FlyMadd Android release handoff

## Current status — September 6, 2026

Version 1.0.6 (version code 8) compiled as both APK and AAB, including native
shop management, product media/details, order/payment views, home/profile UI
changes, and Bascardo Google Play Billing integration.

**The connected device was updated successfully to 1.0.6 (8).** Its original
key was recovered from `C:\Users\DELL\Downloads\upload-keystore.jks` and its
certificate exactly matched the installed app. Both completed artifacts were
signed with that key, resolving the earlier `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
The update preserved app data; no uninstall was needed. ADB confirmed the
installed version and successfully started the activity. No startup errors
were found in the checked app logs; visual review was limited by the locked
phone screen.

Original certificate SHA-256:
`8808907bd72631b4ea4ae3ec592a46511fa3620f784c15796e32bbb38b387a69`

Original alias: `onedream-upload`.

The Downloads key remains untouched. The working copy and its properties are
in the Git-ignored `mobile/signing/` folder, outside generated native source.
The installed APK and certificate cannot recreate the private signing key.
`installed-1.0.5-backup.apk` is a copy of the installed package only; it does
not contain user data. No app uninstall or data clearing was performed.

Signing configuration history was found in VS Code User/History. Its passwords
are deliberately not copied into this document. Release signing support has
been restored to `android/app/build.gradle`, with a guard that rejects release
tasks when the upload key is unavailable.
An offline `:app:assembleRelease --dry-run` confirmed that guard stops with
the expected missing-key error before release packaging.

## Signing configuration

Gradle now prefers `mobile/signing/keystore.properties`, whose key path is
resolved relative to `mobile/android`:

```properties
storeFile=../signing/upload-keystore.jks
storePassword=YOUR_EXISTING_STORE_PASSWORD
keyAlias=onedream-upload
keyPassword=YOUR_EXISTING_KEY_PASSWORD
```

`FLYMADD_KEYSTORE_PROPERTIES` can select a different properties file; legacy
`android/keystore.properties` is the fallback. Never commit the properties or
private key. Keep a separate secure backup of the original key.

## Verified build method

The repo and VS Code build notes agree on two ABIs and limited memory usage.
The following additions resolved this machine's cache permissions, compiler
locks, and locked optional HTML report:

```properties
reactNativeArchitectures=arm64-v8a,x86_64
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
kotlin.compiler.execution.strategy=in-process
```

From `mobile/android`:

```powershell
$env:GRADLE_USER_HOME = 'C:\Users\DELL\flymaddcreative\mobile\.gradle-user-home'
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NODE_ENV = 'production'
.\gradlew.bat assembleRelease bundleRelease --no-daemon --max-workers=2 --no-problems-report
```

This completed the original full 1.0.6 build. A subsequent incremental retry
hit the Ninja bundled with CMake 3.22.1's 260-character Windows path limit in the long Gradle cache
path. A future source rebuild needs a shorter cache path or a long-path-capable
Ninja toolchain; do not regenerate native source to fix this compiler path issue.

Because only signing changed after the completed build, the final release used
the already compiled APK/AAB through this helper from the repository root:

```powershell
.\mobile\scripts\sign-android-release.ps1
```

The helper preserves copies of its input artifacts, signs using the original
key, verifies both signatures and the expected certificate, verifies APK
16 KB page alignment, and compares SHA-256 hashes of every application ZIP
entry before replacing the release output files. Only signature metadata may
change. It does not compile source: build first whenever application code changes.

Final artifact SHA-256:

- APK: `35C6F3396978596B27D2F3D5B2AA267981358F4C371AA56F220CABF9745EDCC9`
- AAB: `36FEA0D70766303771E0B6514B295DB2CD5794CD30B2B77452FE49EB68352181`

Outputs relative to `mobile/android`:

- `app/build/outputs/apk/release/app-release.apk`
- `app/build/outputs/bundle/release/app-release.aab`

Keep incremental outputs to avoid repeating the full native build. Do not
interrupt Gradle. Before running Expo prebuild again, back up all native
customizations and signing material outside `android/`, even without `--clean`.

After verifying the release certificate, use `adb install --no-streaming -r`
with the APK. On this phone the copy completes quickly, but Play Protect may
ask for a scan confirmation. Verify versionName/versionCode with `dumpsys
package com.flymaddcreative.onedream`. This release embeds JavaScript and does
not require Metro at runtime.

The server and database prerequisites for the new features are documented in
`../docs/BASCARDO_PAYMENT_SETUP.md`.
