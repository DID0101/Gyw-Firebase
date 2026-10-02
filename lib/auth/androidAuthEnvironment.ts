/**
 * Android Phone Auth environment — startup validation only.
 * Do NOT enable forceRecaptchaFlowForTesting here; it skips Play Integrity and
 * causes auth/missing-client-identifier when reCAPTCHA/Keystore fails.
 */

import { Platform } from 'react-native';

import { getRnApp, getRnAuth, hasRnFirebase } from '@/lib/rnFirebase';

/** Must match app.json android.package and google-services.json client entry. */
export const EXPECTED_ANDROID_PACKAGE = 'com.gyw1.chat';

export type AndroidAuthEnvironmentReport = {
  platform: string;
  hasRnFirebase: boolean;
  projectId?: string;
  mobileSdkAppId?: string;
  /** True if forceRecaptchaFlowForTesting was left on — unstable for real numbers. */
  forceRecaptchaEnabled: boolean;
  configurationStable: boolean;
  environmentValid: boolean;
  warnings: string[];
};

function readForceRecaptchaFlag(): boolean {
  if (Platform.OS !== 'android' || !hasRnFirebase) return false;
  try {
    const auth = getRnAuth();
    const settings = auth?.settings as { forceRecaptchaFlowForTesting?: boolean } | undefined;
    return settings?.forceRecaptchaFlowForTesting === true;
  } catch {
    return false;
  }
}

export function inspectAndroidAuthEnvironment(): AndroidAuthEnvironmentReport {
  const warnings: string[] = [];

  if (Platform.OS !== 'android') {
    return {
      platform: Platform.OS,
      hasRnFirebase: false,
      forceRecaptchaEnabled: false,
      configurationStable: true,
      environmentValid: true,
      warnings,
    };
  }

  if (!hasRnFirebase) {
    warnings.push('RN Firebase app/auth not initialized — use a dev build (expo run:android)');
    return {
      platform: 'android',
      hasRnFirebase: false,
      forceRecaptchaEnabled: false,
      configurationStable: false,
      environmentValid: false,
      warnings,
    };
  }

  const opts = getRnApp()?.options ?? {};
  const forceRecaptchaEnabled = readForceRecaptchaFlag();

  if (forceRecaptchaEnabled) {
    warnings.push(
      'forceRecaptchaFlowForTesting is ON — skips Play Integrity; real numbers often fail with missing-client-identifier'
    );
  }

  let appCount = 1;
  try {
    const { getApps } = require('@react-native-firebase/app');
    appCount = getApps()?.length ?? 0;
    if (appCount !== 1) {
      warnings.push(`Expected 1 FirebaseApp, found ${appCount}`);
    }
  } catch {
    /* ignore */
  }

  const configurationStable = !forceRecaptchaEnabled && appCount === 1;
  const environmentValid = hasRnFirebase && configurationStable;

  return {
    platform: 'android',
    hasRnFirebase: true,
    projectId: opts.projectId as string | undefined,
    mobileSdkAppId: opts.appId as string | undefined,
    forceRecaptchaEnabled,
    configurationStable,
    environmentValid,
    warnings,
  };
}

/** One-line structured log for logcat / Metro (safe in prod — no secrets). */
export function logAndroidAuthEnvironment(phase = 'AUTH_INIT'): void {
  if (Platform.OS !== 'android') return;
  const r = inspectAndroidAuthEnvironment();
  try {
    console.log(
      `[AUTH_PHONE] ${phase}`,
      JSON.stringify({
        AUTH_ENVIRONMENT_VALID: r.environmentValid,
        AUTH_CONFIGURATION_STABLE: r.configurationStable,
        AUTH_FIREBASE_APP: r.mobileSdkAppId ?? null,
        AUTH_PROJECT: r.projectId ?? null,
        AUTH_FORCE_RECAPTCHA: r.forceRecaptchaEnabled,
        AUTH_EXPECTED_PACKAGE: EXPECTED_ANDROID_PACKAGE,
        warnings: r.warnings,
      })
    );
  } catch {
    console.log(`[AUTH_PHONE] ${phase} environmentValid=${r.environmentValid}`);
  }
}
