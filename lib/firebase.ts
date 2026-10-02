import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { Firestore, initializeFirestore, persistentLocalCache, getFirestore } from 'firebase/firestore';
import { prodDebug, prodDebugError } from '@/lib/debug/prodDebug';
import { markFirebaseInit } from '@/lib/debug/runtimeDiagnostics';
import { firebasePublicConfig } from '@/lib/firebasePublicConfig';

const firebaseConfig = firebasePublicConfig;

// Validate Firebase config
if (!firebaseConfig.apiKey || !firebaseConfig.projectId || firebaseConfig.apiKey === "YOUR_API_KEY_HERE") {
  console.warn('⚠️ Firebase configuration is missing. Please update lib/firebase.ts with your Firebase project credentials.');
  console.warn('Get your config from: Firebase Console > Project Settings > General > Your apps > Web app');
}

// Initialize Firebase
let app: FirebaseApp;
markFirebaseInit('APP_INIT_START', {
  appName: '[DEFAULT]',
  projectId: firebaseConfig.projectId,
  platform: Platform.OS,
});
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  markFirebaseInit('APP_INIT_COMPLETE', {
    appName: app.name,
    projectId: app.options.projectId ?? null,
    appId: app.options.appId ?? null,
  });
  prodDebug('FIREBASE_WEB_INIT', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
} else {
  app = getApps()[0];
  markFirebaseInit('APP_REUSE', {
    appName: app.name,
    appCount: getApps().length,
    projectId: app.options.projectId ?? null,
    appId: app.options.appId ?? null,
  });
  prodDebug('FIREBASE_WEB_REUSE', {
    appCount: getApps().length,
    projectId: app.options.projectId ?? null,
    appId: app.options.appId ?? null,
  });
}

// Initialize Auth with AsyncStorage persistence
let auth: Auth;
try {
  // Use type assertion to access getReactNativePersistence (exists at runtime in Firebase v11)
  const authModule = require('firebase/auth') as typeof import('firebase/auth') & {
    getReactNativePersistence: (storage: typeof AsyncStorage) => any;
  };
  
  auth = initializeAuth(app, {
    persistence: authModule.getReactNativePersistence(AsyncStorage),
  });
  markFirebaseInit('AUTH_INIT_COMPLETE', { provider: 'web', appName: app.name });
} catch (error: any) {
  // If auth is already initialized, get the existing instance
  if (error.code === 'auth/already-initialized') {
    auth = getAuth(app);
    markFirebaseInit('AUTH_INIT_COMPLETE', { provider: 'web_reuse', appName: app.name });
  } else {
    prodDebugError('FIREBASE_AUTH_INIT_FAILED', error);
    // Fallback: use getAuth (will show warning but still works)
    console.warn('Could not initialize Auth with persistence:', error.message);
    auth = getAuth(app);
    markFirebaseInit('AUTH_INIT_COMPLETE', { provider: 'web_fallback', appName: app.name });
  }
}

// Initialize Firestore.
// On web: enable persistent local cache so repeat chat opens are near-instant.
// On native: @react-native-firebase/firestore has offline cache enabled by default;
// this web SDK instance is only used on web or as a fallback when the native SDK is absent.
let db: Firestore;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache(),
  });
  prodDebug('FIRESTORE_WEB_INIT', { localCache: 'persistentLocalCache' });
  markFirebaseInit('FIRESTORE_INIT_COMPLETE', { provider: 'web', appName: app.name });
} catch {
  // initializeFirestore throws if already initialized (e.g. hot reload); fall back gracefully.
  db = getFirestore(app);
  prodDebug('FIRESTORE_WEB_REUSE');
  markFirebaseInit('FIRESTORE_INIT_COMPLETE', { provider: 'web_reuse', appName: app.name });
}

// Initialize Storage
const storage: FirebaseStorage = getStorage(app);
markFirebaseInit('STORAGE_INIT_COMPLETE', { provider: 'web', appName: app.name });

// Initialize Functions (for callable, e.g. random matchmaking)
// On native: use RN Firebase (same app as Auth) via rnFirebase
let functions: ReturnType<typeof getFunctions>;
if (Platform.OS !== 'web') {
  try {
    const { getRnFunctions } = require('@/lib/rnFirebase');
    functions = getRnFunctions();
    prodDebug('FUNCTIONS_INIT', { provider: 'native', region: 'us-central1', available: !!functions });
    markFirebaseInit('FUNCTIONS_INIT_COMPLETE', { provider: 'native', region: 'us-central1', available: !!functions });
  } catch {
    functions = getFunctions(app);
    prodDebug('FUNCTIONS_INIT', { provider: 'web_fallback', region: 'default' });
    markFirebaseInit('FUNCTIONS_INIT_COMPLETE', { provider: 'web_fallback', region: 'default' });
  }
} else {
  functions = getFunctions(app);
  prodDebug('FUNCTIONS_INIT', { provider: 'web', region: 'default' });
  markFirebaseInit('FUNCTIONS_INIT_COMPLETE', { provider: 'web', region: 'default' });
}

// Web SDK httpsCallable expects web Functions instance; RN Firebase Functions has different structure.
// Use RN Firebase's httpsCallable on native to avoid "functionsInstance._url is not a function".
const httpsCallableImpl =
  Platform.OS !== 'web'
    ? (() => {
        try {
          return require('@react-native-firebase/functions').httpsCallable;
        } catch {
          return httpsCallable;
        }
      })()
    : httpsCallable;

markFirebaseInit('FIREBASE_READY', {
  provider: Platform.OS === 'web' ? 'web' : 'web_fallback',
  appName: app.name,
  platform: Platform.OS,
  hasAuth: !!auth,
  hasFirestore: !!db,
  hasFunctions: !!functions,
  hasStorage: !!storage,
});

export { app, auth, db, storage, functions, connectFunctionsEmulator };
export { httpsCallableImpl as httpsCallable };

