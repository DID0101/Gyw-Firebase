/**
 * Production-safe diagnostics (Play Store / release builds).
 * Uses console.error so logs survive app/_layout.tsx console silencing in release.
 *
 * Filter logcat: adb logcat | findstr /i "APP_ENVIRONMENT BUILD_TYPE LANGUAGE_CHANGE TRANSLATION SCREEN_ FIREBASE_"
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { prodDebug } from '@/lib/debug/prodDebug';

type DiagPayload = Record<string, unknown>;

const emit = (tag: string, payload: DiagPayload = {}) => {
  prodDebug(tag, payload);
};

export function logAppEnvironment(): void {
  const executionEnv = Constants.executionEnvironment ?? 'unknown';
  const buildType = __DEV__ ? 'debug' : 'release';
  emit('APP_ENVIRONMENT', {
    buildType,
    __DEV__,
    platform: Platform.OS,
    executionEnvironment: executionEnv,
    appOwnership: Constants.appOwnership ?? null,
    easProjectId: Constants.expoConfig?.extra?.eas?.projectId ?? null,
    version: Constants.expoConfig?.version ?? null,
    nativeAppVersion: Constants.nativeAppVersion ?? null,
    nativeBuildVersion: Constants.nativeBuildVersion ?? null,
  });
  emit('BUILD_TYPE', { buildType, __DEV__, platform: Platform.OS });
}

export function logFirebaseIdentity(): void {
  try {
    const { getApps } = require('firebase/app') as typeof import('firebase/app');
    const apps = getApps();
    const webApp = apps[0];
    const webOptions = webApp?.options;
    emit('FIREBASE_PROJECT', {
      projectId: webOptions?.projectId ?? null,
      authDomain: webOptions?.authDomain ?? null,
      messagingSenderId: webOptions?.messagingSenderId ?? null,
    });
    emit('FIREBASE_APP_ID', {
      webAppId: webOptions?.appId ?? null,
      appCount: apps.length,
    });
    if (Platform.OS !== 'web') {
      try {
        const { getApp } = require('@react-native-firebase/app') as typeof import('@react-native-firebase/app');
        const rnApp = getApp();
        emit('FIREBASE_APP_ID', {
          rnAppId: rnApp?.options?.appId ?? null,
          rnProjectId: rnApp?.options?.projectId ?? null,
          rnPackageName: rnApp?.options?.android?.packageName ?? null,
        });
      } catch (e) {
        emit('FIREBASE_APP_ID', { rnError: String((e as Error)?.message ?? e) });
      }
    }
  } catch (e) {
    emit('FIREBASE_PROJECT', { error: String((e as Error)?.message ?? e) });
  }
}

export function logLanguageChange(from: string, to: string, source: string): void {
  emit('LANGUAGE_CHANGE', { from, to, source });
}

export function logTranslationKeyFound(key: string, lng: string): void {
  if (__DEV__) emit('TRANSLATION_KEY_FOUND', { key, lng });
}

export function logTranslationKeyMissing(key: string, lng: string, ns?: string): void {
  emit('TRANSLATION_KEY_MISSING', { key, lng, ns: ns ?? 'translation' });
}

/** Call from screen mount (useEffect) to trace which routes load in Play builds. */
export function logScreenMounted(screenId: string, extra?: DiagPayload): void {
  emit('SCREEN_MOUNTED', { screenId, ...extra });
}

export function logScreenFailed(screenId: string, error: unknown, extra?: DiagPayload): void {
  emit('SCREEN_FAILED', {
    screenId,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.slice(0, 800) : undefined,
    ...extra,
  });
}

/** Returns true when key resolves to a real translation (not fallback to en missing). */
export function probeTranslationKey(key: string, lng: string): boolean {
  try {
    const i18n = require('@/i18n/config').default as import('i18next').default;
    const bundle = i18n.getResourceBundle(lng, 'translation') as Record<string, unknown> | undefined;
    if (!bundle) return false;
    const parts = key.split('.');
    let cur: unknown = bundle;
    for (const p of parts) {
      if (!cur || typeof cur !== 'object') return false;
      cur = (cur as Record<string, unknown>)[p];
    }
    return typeof cur === 'string' && cur.length > 0;
  } catch {
    return false;
  }
}

export function auditTranslationKeys(keys: string[], lng: string): void {
  for (const key of keys) {
    if (probeTranslationKey(key, lng)) {
      logTranslationKeyFound(key, lng);
    } else {
      logTranslationKeyMissing(key, lng);
    }
  }
}
