# Android Build Notes

- Project: Expo SDK 57 with React Native's new architecture enabled.
- Development machine: Windows with 16 GB RAM.
- Supported development targets: physical arm64-v8a devices and x86_64 emulators.

## Native build memory limit

Building all four Android ABIs can exhaust memory while compiling native C++
dependencies. Keep the release build limited to `arm64-v8a,x86_64` and use two
CMake/Gradle workers on this machine.

The required settings in `gradle.properties` are:

```properties
reactNativeArchitectures=arm64-v8a,x86_64
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
kotlin.compiler.execution.strategy=in-process
```

Build commands from `mobile/android`:

```powershell
$env:GRADLE_USER_HOME = "C:\Users\DELL\flymaddcreative\mobile\.gradle-user-home"
$env:CMAKE_BUILD_PARALLEL_LEVEL = "2"
$env:NODE_ENV = "production"
.\gradlew.bat assembleRelease bundleRelease --no-daemon --max-workers=2 --no-problems-report
```

Using a project-local Gradle user home keeps sandboxed and regular Windows
builds from embedding inaccessible cross-user cache paths in CMake files.

Release outputs:

- APK: `app/build/outputs/apk/release/app-release.apk`
- AAB: `app/build/outputs/bundle/release/app-release.aab`

`--no-problems-report` avoids a generated HTML report that Windows kept locked
during the verified September 6 build. Keep the default incremental caches;
the first build after regeneration takes substantially longer.

## Release signing and regeneration

The installed 1.0.6 app uses the FlyMadd upload certificate with SHA-256:
`8808907bd72631b4ea4ae3ec592a46511fa3620f784c15796e32bbb38b387a69`.
Its original key was `android/app/upload-keystore.jks`, alias `onedream-upload`.
The original key was recovered from `C:\Users\DELL\Downloads\upload-keystore.jks`
and verified against the installed app. The Downloads copy is preserved.

The working key and credentials are now in Git-ignored `mobile/signing/`.
Gradle prefers `mobile/signing/keystore.properties`, with
`storeFile=../signing/upload-keystore.jks` relative to `mobile/android`, alongside
`storePassword`, `keyAlias`, and `keyPassword`. Alternatively point the
`FLYMADD_KEYSTORE_PROPERTIES` environment variable at an external properties
file. Never commit either file. Release builds now fail if this configuration
is missing rather than falling back to Expo's debug signing key.

The completed September 6 APK and AAB, version 1.0.6 (8), have now been signed
with the original key. APK/AAB signature checks, APK alignment, and full
application payload comparisons passed. ADB installed the APK with `-r` and
confirmed 1.0.6 (8), preserving app data. The earlier installed APK copy remains
at `mobile/installed-1.0.5-backup.apk`; it does not include user data or keys.

The incremental signing retry encountered Ninja's 260-character Windows path
limit. Since application payloads were already compiled and unchanged, the
release was completed using `mobile/scripts/sign-android-release.ps1`. This
helper only signs existing outputs; source changes still require compilation.
For the next source rebuild, shorten the Gradle cache path or select a
long-path-capable Ninja toolchain. Do not run prebuild for this path error.
See `mobile/ANDROID_RELEASE.md` for the current handoff and final hashes.

Before ANY Expo prebuild, preserve custom native configuration and signing
material outside `android/`, even when `--clean` is not used. If generated
codegen JNI folders are missing, first try the existing Gradle codegen tasks.
Regenerate only if necessary, then restore the settings and signing checks
above before rebuilding. Never delete the original upload key.

If Windows reports `AccessDeniedException` for a generated dependency JAR,
run `.\gradlew.bat --stop` and rerun the incremental build with
`--no-daemon --max-workers=1`. This avoids competing Gradle/Kotlin processes
without deleting any already compiled native outputs.
