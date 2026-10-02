# Gradle TLS / network fix (Windows)

## Symptom

```
Tag mismatch!
javax.crypto.AEADBadTagException: Tag mismatch
SEC_E_DECRYPT_FAILURE
```

Gradle, curl, and PowerShell downloads fail mid-stream — **not a project bug**.

## Cause

VPN, proxy, or antivirus **HTTPS inspection** corrupts TLS on this PC.

## Fix (pick one)

1. **Disable VPN** and retry build.
2. **Antivirus** → turn off HTTPS/SSL scanning for `java.exe`, `gradlew.bat`, `curl.exe`.
3. **Mobile hotspot** — different network often works immediately.
4. **Offline bootstrap on this PC** (when you cannot fix VPN yet):
   ```powershell
   # One-time: Gradle 8.13 distribution (already at C:\gradle-cache\gradle-8.13-bin.zip)
   powershell -ExecutionPolicy Bypass -File scripts/bootstrap-android-deps.ps1
   powershell -ExecutionPolicy Bypass -File scripts/seed-gradle-cache.ps1
   node scripts/patch-gradle-local-maven.js
   cd android
   .\gradlew :app:assembleDebug
   ```
   Re-run `bootstrap-android-deps.ps1` whenever the build stops on a new `Could not download …` / `Tag mismatch` artifact.
5. After network is fixed, run:
   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.gradle\caches" -ErrorAction SilentlyContinue
   powershell -ExecutionPolicy Bypass -File scripts/bootstrap-gradle-offline.ps1
   cd android
   .\gradlew :app:assembleDebug
   ```

## Work without rebuild (JS-only changes)

Auth/reCAPTCHA fixes are JavaScript — use the installed dev client:

```bash
npx expo start --clear --dev-client
adb reverse tcp:8081 tcp:8081
```

Force-close app → reopen → test OTP.

## Project changes already applied

- `android/build.gradle` — local Maven repo + Crashlytics 3.0.2
- `android/gradle.properties` — TLS 1.2, reduced parallelism
- `scripts/bootstrap-gradle-offline.ps1` — chunked Gradle download + local deps
