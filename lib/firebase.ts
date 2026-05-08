import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
import { FirebaseStorage, getStorage } from 'firebase/storage';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { Firestore, initializeFirestore, persistentLocalCache, getFirestore } from 'firebase/firestore';

// Firebase configuration
// TODO: Replace these values with your new Firebase project configuration
// Get these from: Firebase Console > Project Settings > General > Your apps > Web app
const firebaseConfig = {
  apiKey: "AIzaSyCn7SzfpJ2BOTmmKmoxWR0fNBnHG6Xw0Pw",
  authDomain: "gyw1-146d7.firebaseapp.com",
  projectId: "gyw1-146d7",
  storageBucket: "gyw1-146d7.firebasestorage.app",
  messagingSenderId: "1039699232254",
  appId: "1:1039699232254:web:65f4b901c63fc347786caf"
};

// Validate Firebase config
if (!firebaseConfig.apiKey || !firebaseConfig.projectId || firebaseConfig.apiKey === "YOUR_API_KEY_HERE") {
  console.warn('⚠️ Firebase configuration is missing. Please update lib/firebase.ts with your Firebase project credentials.');
  console.warn('Get your config from: Firebase Console > Project Settings > General > Your apps > Web app');
}

// Initialize Firebase
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
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
} catch (error: any) {
  // If auth is already initialized, get the existing instance
  if (error.code === 'auth/already-initialized') {
    auth = getAuth(app);
  } else {
    // Fallback: use getAuth (will show warning but still works)
    console.warn('Could not initialize Auth with persistence:', error.message);
    auth = getAuth(app);
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
} catch {
  // initializeFirestore throws if already initialized (e.g. hot reload); fall back gracefully.
  db = getFirestore(app);
}

// Initialize Storage
const storage: FirebaseStorage = getStorage(app);

// Initialize Functions (for callable, e.g. random matchmaking)
// On native: use RN Firebase (same app as Auth) via rnFirebase
let functions: ReturnType<typeof getFunctions>;
if (Platform.OS !== 'web') {
  try {
    const { getRnFunctions } = require('@/lib/rnFirebase');
    functions = getRnFunctions();
  } catch {
    functions = getFunctions(app);
  }
} else {
  functions = getFunctions(app);
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

export { app, auth, db, storage, functions, connectFunctionsEmulator };
export { httpsCallableImpl as httpsCallable };

