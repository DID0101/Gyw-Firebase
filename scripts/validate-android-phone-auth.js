#!/usr/bin/env node
/**
 * CI / postinstall guard: phone auth must not re-enable forceRecaptchaFlowForTesting.
 * Run after patch-package. Fails fast before another regression ships.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const errors = [];

const gsPath = path.join(root, 'google-services.json');
if (!fs.existsSync(gsPath)) {
  errors.push('google-services.json missing');
} else {
  const gs = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
  const clients = gs.client || [];
  const hasGyw1 = clients.some(
    (c) => c.client_info?.android_client_info?.package_name === 'com.gyw1.chat'
  );
  if (!hasGyw1) {
    errors.push('google-services.json has no android client for package com.gyw1.chat');
  }
}

const patchPath = path.join(root, 'patches', '@react-native-firebase+auth+23.8.8.patch');
if (!fs.existsSync(patchPath)) {
  errors.push('Missing patches/@react-native-firebase+auth+23.8.8.patch (PhoneAuthOptions fix)');
}

const forbiddenSources = ['lib/rnFirebase.ts', 'lib/phoneAuth.ts'];

const forbiddenPatterns = [
  /forceRecaptchaFlowForTesting\s*=\s*true/,
  /forceRecaptchaFlowForTesting\(true\)/,
];

for (const rel of forbiddenSources) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) continue;
  const text = fs.readFileSync(fp, 'utf8');
  for (const re of forbiddenPatterns) {
    if (re.test(text)) {
      errors.push(`${rel} must not enable forceRecaptchaFlowForTesting (${re})`);
    }
  }
}

const legacyPlugin = path.join(root, 'plugins', 'withAndroidFirebasePhoneAuthDebug.js');
if (fs.existsSync(legacyPlugin)) {
  const legacy = fs.readFileSync(legacyPlugin, 'utf8');
  if (forbiddenPatterns.some((re) => re.test(legacy))) {
    errors.push(
      'plugins/withAndroidFirebasePhoneAuthDebug.js still forces reCAPTCHA — remove plugin from app.json or delete file'
    );
  }
}

const appJsonPath = path.join(root, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const plugins = appJson.expo?.plugins || [];
const usesLegacy = plugins.some(
  (p) => typeof p === 'string' && p.includes('withAndroidFirebasePhoneAuthDebug')
);
const usesStable = plugins.some(
  (p) => typeof p === 'string' && p.includes('withAndroidFirebasePhoneAuthStable')
);
if (usesLegacy) {
  errors.push('app.json still references withAndroidFirebasePhoneAuthDebug — use withAndroidFirebasePhoneAuthStable');
}
if (!usesStable) {
  errors.push('app.json must include ./plugins/withAndroidFirebasePhoneAuthStable');
}

const stableIdx = plugins.findIndex(
  (p) => typeof p === 'string' && p.includes('withAndroidFirebasePhoneAuthStable')
);
const lastAndroidIdx = plugins.reduce(
  (acc, p, i) => (typeof p === 'string' && p.includes('withAndroid') ? i : acc),
  -1
);
if (stableIdx !== -1 && stableIdx !== lastAndroidIdx) {
  errors.push(
    'withAndroidFirebasePhoneAuthStable must be last among ./plugins/withAndroid* in app.json'
  );
}

const androidMainCandidates = [
  path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'gyw1', 'chat', 'MainApplication.kt'),
  path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'gyw1', 'chat', 'MainApplication.java'),
];
for (const mainPath of androidMainCandidates) {
  if (!fs.existsSync(mainPath)) continue;
  const main = fs.readFileSync(mainPath, 'utf8');
  if (
    /forceRecaptchaFlowForTesting\s*\(\s*true\s*\)/.test(main) &&
    !main.includes('GYW_PHONE_AUTH_STABLE_STRIP')
  ) {
    errors.push(
      `${path.relative(root, mainPath)} still forces reCAPTCHA in DEBUG — run: npx expo prebuild (stable plugin strips this)`
    );
  }
}

if (errors.length) {
  console.error('[validate-android-phone-auth] FAILED:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}

console.log('[validate-android-phone-auth] OK — stable phone auth config');
