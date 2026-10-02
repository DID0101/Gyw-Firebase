#!/usr/bin/env node
/**
 * Post-prebuild audit: native Firebase Phone Auth integrity.
 * Run: node scripts/audit-android-phone-auth.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const androidRoot = path.join(root, 'android');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const expectedPackage = appJson.expo?.android?.package ?? 'com.gyw1.chat';

const nativeAudit = { ok: true, findings: [] };
const pluginAudit = { ok: true, findings: [] };
const prebuildAudit = { ok: true, findings: [] };

function fail(bucket, msg) {
  bucket.ok = false;
  bucket.findings.push(msg);
}

// ── Phase 1: Native ───────────────────────────────────────────────────────────
if (!fs.existsSync(androidRoot)) {
  fail(nativeAudit, 'android/ missing — run: npx expo prebuild --platform android');
} else {
  const appGradle = path.join(androidRoot, 'app', 'build.gradle');
  if (fs.existsSync(appGradle)) {
    const g = fs.readFileSync(appGradle, 'utf8');
    if (!g.includes("applicationId '" + expectedPackage + "'") && !g.includes(`applicationId "${expectedPackage}"`)) {
      fail(nativeAudit, `applicationId mismatch (expected ${expectedPackage})`);
    }
    if (!g.includes("namespace '" + expectedPackage + "'") && !g.includes(`namespace "${expectedPackage}"`)) {
      fail(nativeAudit, `namespace mismatch (expected ${expectedPackage})`);
    }
    if (!g.includes("com.google.gms.google-services")) {
      fail(nativeAudit, 'google-services plugin not applied on app module');
    }
    if (!g.includes('firebase-auth')) {
      fail(nativeAudit, 'firebase-auth dependency missing from app/build.gradle');
    }
    const bomMatch = g.match(/firebase-bom:([^"]+)"/);
    if (bomMatch) {
      nativeAudit.findings.push(`firebase-bom:${bomMatch[1]}`);
    }
  }

  const mainAppDir = path.join(androidRoot, 'app', 'src', 'main', 'java', ...expectedPackage.split('.'));
  const mainKt = path.join(mainAppDir, 'MainApplication.kt');
  const mainJava = path.join(mainAppDir, 'MainApplication.java');
  const mainPath = fs.existsSync(mainKt) ? mainKt : fs.existsSync(mainJava) ? mainJava : null;
  if (!mainPath) {
    fail(nativeAudit, 'MainApplication not found');
  } else {
    const main = fs.readFileSync(mainPath, 'utf8');
    const forcesRecaptcha =
      /forceRecaptchaFlowForTesting\s*\(\s*true\s*\)/.test(main) &&
      !main.includes('GYW_PHONE_AUTH_STABLE_STRIP');
    if (forcesRecaptcha) {
      fail(
        nativeAudit,
        'CRITICAL: MainApplication still calls forceRecaptchaFlowForTesting(true) — run prebuild (stable plugin must be last in app.json)'
      );
    }
    if (!main.includes('GYW_PHONE_AUTH_STABLE_STRIP') && !main.includes('GYW_PHONE_AUTH_NATIVE_LOG')) {
      nativeAudit.findings.push('warn: stable plugin markers absent in MainApplication — re-run prebuild');
    }
  }

  const manifestPath = path.join(androidRoot, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifestPath)) {
    const m = fs.readFileSync(manifestPath, 'utf8');
    if (!m.includes('RecaptchaActivity')) {
      fail(nativeAudit, 'RecaptchaActivity missing from merged AndroidManifest.xml');
    }
    if (!m.includes('com.google.android.gms')) {
      fail(nativeAudit, '<queries> for Play Services missing (Android 11+ package visibility)');
    }
    const mainBlock = m.match(/android:name="\.MainActivity"[^>]*>/);
    if (mainBlock && /showWhenLocked|turnScreenOn/.test(mainBlock[0])) {
      fail(
        nativeAudit,
        'AUTH_MANIFEST_CONFLICT: MainActivity has showWhenLocked/turnScreenOn (breaks Recaptcha Keystore on OEM devices)'
      );
    }
    const recaptchaBlock = m.match(/RecaptchaActivity"[^>]*>/);
    if (recaptchaBlock && /launchMode="singleTask"/.test(recaptchaBlock[0])) {
      fail(
        nativeAudit,
        'AUTH_MANIFEST_CONFLICT: RecaptchaActivity launchMode=singleTask (use standard via stable plugin)'
      );
    }
    nativeAudit.findings.push('AUTH_MANIFEST_CONFLICT_RESULT=pass');
  }
}

// ── Phase 2: Plugins ────────────────────────────────────────────────────────
const pluginsDir = path.join(root, 'plugins');
for (const name of fs.readdirSync(pluginsDir)) {
  if (!name.startsWith('withAndroid')) continue;
  const fp = path.join(pluginsDir, name);
  const text = fs.readFileSync(fp, 'utf8');
  if (
    name !== 'withAndroidFirebasePhoneAuthStable.js' &&
    /firebaseAuthSettings\.forceRecaptchaFlowForTesting\s*\(\s*true\s*\)/.test(text)
  ) {
    fail(pluginAudit, `${name} injects forceRecaptchaFlowForTesting(true)`);
  }
}

const appPlugins = appJson.expo?.plugins ?? [];
const stableIdx = appPlugins.findIndex(
  (p) => typeof p === 'string' && p.includes('withAndroidFirebasePhoneAuthStable')
);
const lastAndroidPluginIdx = appPlugins.reduce(
  (acc, p, i) => (typeof p === 'string' && p.includes('withAndroid') ? i : acc),
  -1
);
if (stableIdx === -1) {
  fail(pluginAudit, 'withAndroidFirebasePhoneAuthStable not in app.json plugins');
} else if (stableIdx !== lastAndroidPluginIdx) {
  fail(
    pluginAudit,
    'withAndroidFirebasePhoneAuthStable must be the LAST ./plugins/withAndroid* entry (runs MainApplication strip last)'
  );
}

// ── Phase 3: Prebuild stability ─────────────────────────────────────────────
const patchPath = path.join(root, 'patches', '@react-native-firebase+auth+23.8.8.patch');
if (!fs.existsSync(patchPath)) {
  fail(prebuildAudit, 'Missing @react-native-firebase/auth PhoneAuthOptions patch');
}
const authModule = path.join(
  root,
  'node_modules/@react-native-firebase/auth/android/src/main/java/io/invertase/firebase/auth/ReactNativeFirebaseAuthModule.java'
);
if (fs.existsSync(authModule)) {
  const authSrc = fs.readFileSync(authModule, 'utf8');
  if (!authSrc.includes('PhoneAuthOptions')) {
    fail(prebuildAudit, 'PhoneAuthOptions patch not applied — run: npm install');
  }
} else {
  prebuildAudit.findings.push('warn: auth native module not found (node_modules)');
}

const gsPath = path.join(root, 'google-services.json');
if (fs.existsSync(gsPath)) {
  const gs = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
  const client = (gs.client || []).find(
    (c) => c.client_info?.android_client_info?.package_name === expectedPackage
  );
  if (!client) {
    fail(prebuildAudit, `google-services.json has no client for ${expectedPackage}`);
  } else {
    const oauth = (client.oauth_client || []).filter((o) => o.client_type === 1);
    prebuildAudit.findings.push(`google-services oauth certs for ${expectedPackage}: ${oauth.length}`);
  }
}

function printResult(title, bucket) {
  console.log(`\n=== ${title} ===`);
  console.log(bucket.ok ? 'PASS' : 'FAIL');
  for (const f of bucket.findings) {
    console.log(`  - ${f}`);
  }
}

printResult('AUTH_NATIVE_AUDIT_RESULT', nativeAudit);
printResult('AUTH_PLUGIN_REGRESSION_RESULT', pluginAudit);
printResult('AUTH_PREBUILD_STABILITY_RESULT', prebuildAudit);

const allOk = nativeAudit.ok && pluginAudit.ok && prebuildAudit.ok;
if (!allOk) process.exit(1);
console.log('\nAll phone auth audits passed.');
