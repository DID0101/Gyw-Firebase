/**
 * React Native Firebase - single app instance, fully modular API.
 * All services (auth, firestore, functions) use the SAME app to avoid UNAUTHENTICATED.
 */

import { Platform } from 'react-native';
import { markAppStart, markAppStartFail } from '@/lib/debug/appStartupMarkers';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { markFirebaseInit } from '@/lib/debug/runtimeDiagnostics';

let rnApp: any = null;
let rnAuth: any = null;
let rnFirestore: any = null;
let rnFunctions: any = null;
let rnStorage: any = null;

if (Platform.OS !== 'web') {
  try {
    try {
      const { logStartupStep } = require('@/lib/debug/releaseStartupTrace') as typeof import('@/lib/debug/releaseStartupTrace');
      logStartupStep('STEP_2_FIREBASE_INIT', { phase: 'rnFirebase_begin' });
    } catch {
      /* non-fatal */
    }
    markFirebaseInit('RN_APP_INIT_START', { provider: 'native' });
    const { getApp } = require('@react-native-firebase/app');
    const { getAuth } = require('@react-native-firebase/auth');
    const { getFirestore } = require('@react-native-firebase/firestore');
    const { getFunctions } = require('@react-native-firebase/functions');
    const { getStorage } = require('@react-native-firebase/storage');

    rnApp = getApp();
    markAppStart(2, { provider: 'native', appName: rnApp?.name ?? '[DEFAULT]' });
    markFirebaseInit('RN_APP_INIT_COMPLETE', {
      appName: rnApp?.name ?? '[DEFAULT]',
      projectId: rnApp?.options?.projectId ?? null,
      appId: rnApp?.options?.appId ?? null,
      packageName: rnApp?.options?.android?.packageName ?? null,
    });
    rnAuth = getAuth(rnApp);
    if (__DEV__ && Platform.OS === 'android') {
      try {
        const { ensureRealNumberVerificationEnabled } = require('@/lib/auth/androidPhoneAuthDev') as typeof import('@/lib/auth/androidPhoneAuthDev');
        ensureRealNumberVerificationEnabled();
      } catch {
        /* non-fatal */
      }
    }
    markAppStart(6, { provider: 'native', ok: !!rnAuth });
    markFirebaseInit('AUTH_INIT_COMPLETE', { provider: 'native', appName: rnApp?.name ?? '[DEFAULT]' });
    try {
      const { logStartupStep } = require('@/lib/debug/releaseStartupTrace') as typeof import('@/lib/debug/releaseStartupTrace');
      logStartupStep('STEP_6_AUTH_INIT', { provider: 'native', ok: !!rnAuth });
    } catch {
      /* non-fatal */
    }
    rnFirestore = getFirestore(rnApp);
    markAppStart(7, { provider: 'native', ok: !!rnFirestore });
    markFirebaseInit('FIRESTORE_INIT_COMPLETE', { provider: 'native', appName: rnApp?.name ?? '[DEFAULT]' });
    try {
      const { logStartupStep } = require('@/lib/debug/releaseStartupTrace') as typeof import('@/lib/debug/releaseStartupTrace');
      logStartupStep('STEP_7_FIRESTORE_INIT', { provider: 'native', ok: !!rnFirestore });
    } catch {
      /* non-fatal */
    }
    rnFunctions = getFunctions(rnApp, 'us-central1');
    markFirebaseInit('FUNCTIONS_INIT_COMPLETE', { provider: 'native', region: 'us-central1', appName: rnApp?.name ?? '[DEFAULT]' });
    rnStorage = getStorage(rnApp);
    markFirebaseInit('STORAGE_INIT_COMPLETE', { provider: 'native', appName: rnApp?.name ?? '[DEFAULT]' });
    markFirebaseInit('FIREBASE_READY', {
      provider: 'native',
      appName: rnApp?.name ?? '[DEFAULT]',
      hasAuth: !!rnAuth,
      hasFirestore: !!rnFirestore,
      hasFunctions: !!rnFunctions,
      hasStorage: !!rnStorage,
    });

    prodDebug('RN_FIREBASE_INIT', {
      appId: rnApp?.options?.appId ?? null,
      projectId: rnApp?.options?.projectId ?? null,
      storageBucket: rnApp?.options?.storageBucket ?? null,
      packageName: rnApp?.options?.android?.packageName ?? null,
      hasAuth: !!rnAuth,
      hasFirestore: !!rnFirestore,
      hasFunctions: !!rnFunctions,
      hasStorage: !!rnStorage,
    });

    if (__DEV__) {
      const { getApps } = require('@react-native-firebase/app');
      const apps = getApps();
      if ((apps?.length ?? 0) !== 1) {
        console.warn('[rnFirebase] Expected exactly 1 app. Multiple apps can cause UNAUTHENTICATED in callables.');
      }
    }
  } catch (e) {
    markAppStartFail(2, e, { provider: 'native' });
    markFirebaseInit('RN_APP_INIT_FAILED', { provider: 'native' });
    prodDebugError('RN_FIREBASE_INIT_FAILED', e);
    if (__DEV__) console.warn('[rnFirebase] init failed:', e);
  }
}

export function getRnApp() {
  return rnApp;
}

export function getRnAuth() {
  return rnAuth;
}

export function getRnFirestore() {
  return rnFirestore;
}

export function getRnFunctions() {
  return rnFunctions;
}

export function getRnStorage() {
  return rnStorage;
}

export const hasRnFirebase = Platform.OS !== 'web' && !!rnApp;
