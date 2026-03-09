/**
 * React Native Firebase - single app instance, fully modular API.
 * All services (auth, firestore, functions) use the SAME app to avoid UNAUTHENTICATED.
 */

import { Platform } from 'react-native';

let rnApp: any = null;
let rnAuth: any = null;
let rnFirestore: any = null;
let rnFunctions: any = null;
let rnStorage: any = null;

if (Platform.OS !== 'web') {
  try {
    const { getApp } = require('@react-native-firebase/app');
    const { getAuth } = require('@react-native-firebase/auth');
    const { getFirestore } = require('@react-native-firebase/firestore');
    const { getFunctions } = require('@react-native-firebase/functions');
    const { getStorage } = require('@react-native-firebase/storage');

    rnApp = getApp();
    rnAuth = getAuth(rnApp);
    rnFirestore = getFirestore(rnApp);
    rnFunctions = getFunctions(rnApp, 'us-central1');
    rnStorage = getStorage(rnApp);

    if (__DEV__) {
      const { getApps } = require('@react-native-firebase/app');
      const apps = getApps();
      console.log('APPS COUNT', apps?.length ?? 0);
      if ((apps?.length ?? 0) !== 1) {
        console.warn('[rnFirebase] Expected exactly 1 app. Multiple apps can cause UNAUTHENTICATED in callables.');
      }
    }
  } catch (e) {
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
