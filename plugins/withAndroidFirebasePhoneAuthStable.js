/**
 * Stable Android Firebase Phone Auth (survives expo prebuild + native feature plugins).
 */
const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');
const { FIREBASE_BOM } = require('./firebaseSdkVersions');

const STRIP_MARKER = 'GYW_PHONE_AUTH_STABLE_STRIP';
const NATIVE_LOG_MARKER = 'GYW_PHONE_AUTH_NATIVE_LOG';
const LIFECYCLE_MARKER = 'GYW_AUTH_LIFECYCLE_TRACER';
const DIAG_PACKAGE_MARKER = 'GYW_PHONE_AUTH_DIAG_PACKAGE';

const AUTH_KOTLIN_FILES = [
  'AuthLifecycleTracer.kt',
  'PhoneAuthBootstrap.kt',
  'PhoneAuthDiagnosticsModule.kt',
  'PhoneAuthDiagnosticsPackage.kt',
];

function copyAuthNativeSources(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';
      const destDir = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...androidPackage.split('.')
      );
      fs.mkdirSync(destDir, { recursive: true });
      const srcDir = path.join(projectRoot, 'plugins', 'android-native', 'com', 'gyw1', 'chat');
      for (const f of AUTH_KOTLIN_FILES) {
        const srcPath = path.join(srcDir, f);
        if (!fs.existsSync(srcPath)) continue;
        let text = fs.readFileSync(srcPath, 'utf8');
        text = text.replace(/^package com\.gyw1\.chat$/m, `package ${androidPackage}`);
        fs.writeFileSync(path.join(destDir, f), text);
      }
      return cfg;
    },
  ]);
}

function stripForceRecaptchaFromMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const androidPackage = cfg.android?.package ?? 'com.gyw1.chat';

    const patterns = [
      /\s*if\s*\(\s*BuildConfig\.DEBUG\s*\)\s*\{[^}]*forceRecaptchaFlowForTesting\s*\(\s*true\s*\)[^}]*\}/gs,
      /\s*if\s*\(\s*BuildConfig\.DEBUG\s*\)\s*\{[^}]*setForceRecaptchaFlowForTesting\s*\(\s*true\s*\)[^}]*\}/gs,
    ];
    for (const re of patterns) {
      contents = contents.replace(re, `\n    // ${STRIP_MARKER}: removed forceRecaptchaFlowForTesting(true)\n`);
    }

    if (!contents.includes('AuthLifecycleTracer')) {
      const imports = `import ${androidPackage}.AuthLifecycleTracer\nimport ${androidPackage}.PhoneAuthDiagnosticsPackage\n`;
      contents = contents.replace(/^package .+\n/m, (m) => `${m}\n${imports}`);
    }

    if (!contents.includes(NATIVE_LOG_MARKER)) {
      const kotlinLog = `
    // ${NATIVE_LOG_MARKER}
    try {
      val gms = com.google.android.gms.common.GoogleApiAvailability.getInstance()
      val gmsCode = gms.isGooglePlayServicesAvailable(this)
      android.util.Log.i("AUTH_PHONE", "AUTH_FIREBASE_INIT package=${androidPackage}")
      android.util.Log.i("AUTH_PHONE", "AUTH_NATIVE_FORCE_RECAPTCHA=not_forced_by_main_application")
      android.util.Log.i("AUTH_PHONE", "AUTH_PLAY_SERVICES_STATUS code=$gmsCode")
    } catch (_: Throwable) { }
`;
      const isKotlin =
        cfg.modResults.language === 'kotlin' ||
        /override fun onCreate|class MainApplication\s*:\s*Application/.test(contents);
      if (isKotlin) {
        contents = contents.replace(/super\.onCreate\(\)/, `super.onCreate()${kotlinLog}`);
      }
    }

    if (!contents.includes(LIFECYCLE_MARKER)) {
      const tracerBlock = `
    // ${LIFECYCLE_MARKER}
    try {
      AuthLifecycleTracer.register(this)
    } catch (_: Throwable) { }
`;
      contents = contents.replace(/super\.onCreate\(\)/, `super.onCreate()${tracerBlock}`);
    }

    if (!contents.includes(DIAG_PACKAGE_MARKER)) {
      if (contents.includes('val packages = PackageList(this).packages')) {
        contents = contents.replace(
          /(val packages = PackageList\(this\)\.packages\s*\n)/,
          `$1            // ${DIAG_PACKAGE_MARKER}\n            packages.add(PhoneAuthDiagnosticsPackage())\n`
        );
      }
    }

    cfg.modResults.contents = contents;
    return cfg;
  });
}

function addFirebaseAuthDep(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    const browserDep = 'implementation "androidx.browser:browser:1.8.0"';
    const securityCryptoDep = 'implementation "androidx.security:security-crypto:1.1.0-alpha06"';
    const playIntegrityDep = 'implementation "com.google.android.play:integrity:1.4.0"';
    if (!gradle.includes(browserDep)) {
      gradle = gradle.replace(
        /implementation "com\.google\.firebase:firebase-auth"/,
        (m) => `${m}\n    ${browserDep} // gyw-phone-auth-recaptcha-custom-tabs`
      );
    }
    if (!gradle.includes('androidx.security:security-crypto')) {
      gradle = gradle.replace(
        /implementation "com\.google\.firebase:firebase-auth"/,
        (m) => `${m}\n    ${securityCryptoDep} // gyw-phone-auth-firebear-crypto`
      );
    }
    if (!gradle.includes('com.google.android.play:integrity')) {
      gradle = gradle.replace(
        /implementation "com\.google\.firebase:firebase-auth"/,
        (m) => `${m}\n    ${playIntegrityDep} // gyw-phone-auth-play-integrity`
      );
    }
    if (!gradle.includes('com.google.firebase:firebase-auth')) {
      const patched = gradle.replace(
        /implementation\s+platform\("com\.google\.firebase:firebase-bom:[^"]+"\)/,
        (m) => `${m}\n    implementation "com.google.firebase:firebase-auth"`
      );
      if (patched !== gradle) gradle = patched;
    }
    gradle = gradle.replace(
      /implementation platform\("com\.google\.firebase:firebase-bom:[^"]+"\)/g,
      `implementation platform("com.google.firebase:firebase-bom:${FIREBASE_BOM}")`
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
}

/** MainActivity lock-screen flags break RecaptchaActivity Keystore on some OEMs (Tecno/Oppo). */
function removeMainActivityLockScreenFlags(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const main = (app.activity || []).find((a) => a.$?.['android:name'] === '.MainActivity');
    if (main?.$) {
      delete main.$['android:showWhenLocked'];
      delete main.$['android:turnScreenOn'];
    }
    return cfg;
  });
}

/**
 * singleTask on RecaptchaActivity + MainActivity causes task-stack conflicts; Recaptcha needs standard.
 */
function fixFirebaseAuthActivityLaunchModes(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    for (const act of app.activity || []) {
      const name = String(act.$?.['android:name'] || '');
      if (
        name.includes('RecaptchaActivity') ||
        name.includes('GenericIdpActivity')
      ) {
        act.$['android:launchMode'] = 'standard';
        act.$['android:taskAffinity'] = '';
        const existingReplace = String(act.$['tools:replace'] || '');
        const parts = new Set(
          existingReplace.split(',').map((s) => s.trim()).filter(Boolean),
        );
        parts.add('android:launchMode');
        parts.add('android:taskAffinity');
        act.$['tools:replace'] = [...parts].join(',');
      }
    }
    return cfg;
  });
}

function ensurePhoneAuthPackageQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const root = manifest.manifest;
    root.queries = root.queries || [];
    const marker = 'com.google.android.gms';
    const hasQueries = root.queries.some((q) => JSON.stringify(q).includes(marker));
    if (!hasQueries) {
      root.queries.push({
        package: [
          { $: { 'android:name': 'com.google.android.gms' } },
          { $: { 'android:name': 'com.android.chrome' } },
          { $: { 'android:name': 'com.google.android.webview' } },
        ],
        intent: [
          {
            action: [
              {
                $: {
                  'android:name': 'android.support.customtabs.action.CustomTabsService',
                },
              },
            ],
          },
        ],
      });
    }
    return cfg;
  });
}

function ensureFirebaseAuthActivities(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.activity = app.activity || [];

    const ensureActivity = (name, scheme) => {
      const existing = app.activity.find((activity) => activity.$?.['android:name'] === name);
      if (existing) {
        existing.$['android:launchMode'] = 'standard';
        existing.$['android:taskAffinity'] = '';
        const existingReplace = String(existing.$['tools:replace'] || '');
        const parts = new Set(
          existingReplace.split(',').map((s) => s.trim()).filter(Boolean),
        );
        parts.add('android:launchMode');
        parts.add('android:taskAffinity');
        existing.$['tools:replace'] = [...parts].join(',');
        return;
      }
      app.activity.push({
        $: {
          'android:name': name,
          'android:excludeFromRecents': 'true',
          'android:exported': 'true',
          'android:launchMode': 'standard',
          'android:taskAffinity': '',
          'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
          'tools:node': 'merge',
          'tools:replace': 'android:launchMode,android:taskAffinity',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            category: [
              { $: { 'android:name': 'android.intent.category.DEFAULT' } },
              { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
            ],
            data: [
              {
                $: {
                  'android:scheme': scheme,
                  'android:host': 'firebase.auth',
                  'android:path': '/',
                },
              },
            ],
          },
        ],
      });
    };

    ensureActivity('com.google.firebase.auth.internal.GenericIdpActivity', 'genericidp');
    ensureActivity('com.google.firebase.auth.internal.RecaptchaActivity', 'recaptcha');
    return cfg;
  });
}

module.exports = function withAndroidFirebasePhoneAuthStable(config) {
  config = copyAuthNativeSources(config);
  config = stripForceRecaptchaFromMainApplication(config);
  config = addFirebaseAuthDep(config);
  config = ensurePhoneAuthPackageQueries(config);
  config = ensureFirebaseAuthActivities(config);
  config = fixFirebaseAuthActivityLaunchModes(config);
  config = removeMainActivityLockScreenFlags(config);
  return config;
};

module.exports.STRIP_MARKER = STRIP_MARKER;
module.exports.FIREBASE_BOM = FIREBASE_BOM;
