/**
 * In DEBUG builds only:
 *   1. Ensures `implementation "com.google.firebase:firebase-auth"` is on the :app classpath.
 *
 * IMPORTANT:
 * - Do NOT inject setAppVerificationDisabledForTesting or forceRecaptchaFlowForTesting.
 *   Those are testing-only switches and they break real phone numbers / app verification.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

function addFirebaseAuthDep(config) {
  return withAppBuildGradle(config, (cfg) => {
    const gradle = cfg.modResults.contents;
    if (gradle.includes('com.google.firebase:firebase-auth')) {
      return cfg;
    }
    const patched = gradle.replace(
      /implementation\s+platform\("com\.google\.firebase:firebase-bom:[^"]+"\)/,
      (m) => `${m}\n    implementation "com.google.firebase:firebase-auth"`,
    );
    if (patched === gradle) {
      console.warn(
        '[withAndroidFirebasePhoneAuthDebug] Could not add firebase-auth — add it manually under the Firebase BOM in android/app/build.gradle',
      );
      return cfg;
    }
    cfg.modResults.contents = patched;
    return cfg;
  });
}

module.exports = function withAndroidFirebasePhoneAuthDebug(config) {
  config = addFirebaseAuthDep(config);
  return config;
};
