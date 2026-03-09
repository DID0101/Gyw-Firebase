/**
 * Push token registration for incoming call notifications.
 * Stores FCM token in Firestore users/{userId}.fcmToken for Cloud Function to send notifications.
 *
 * Requires @react-native-firebase/messaging for FCM token on both platforms.
 * Install: npm install @react-native-firebase/messaging
 * Then call registerPushToken() after user signs in.
 *
 * On native, uses React Native Firebase Firestore (same auth as sign-in) to avoid
 * "Missing or insufficient permissions" from Web SDK Firestore.
 */
import { deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

function getMessaging() {
  try {
    return require('@react-native-firebase/messaging').default;
  } catch {
    return null;
  }
}

/** Use native Firestore when on native (same auth as RN Firebase sign-in). */
function getDbForWrite() {
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rn = require('@react-native-firebase/firestore');
    return { db: getRnFirestore(), setDoc: rn.setDoc, updateDoc: rn.updateDoc, deleteField: rn.deleteField, doc: rn.doc };
  }
  return { db, setDoc, updateDoc, deleteField: () => deleteField(), doc };
}

/**
 * Get FCM token and store in Firestore.
 * Call after user signs in (e.g. in AuthContext or home layout).
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (!userId) return;

  let token: string | null = null;

  const messaging = getMessaging();
  if (messaging) {
    try {
      token = await messaging().getToken();
    } catch (err) {
      if (__DEV__) console.warn('[pushToken] getToken failed:', err);
    }
  }

  if (!token) {
    // FCM token unavailable: use EAS dev build (not Expo Go), run npm install, rebuild
    return;
  }

  const { db: writeDb, setDoc: writeSetDoc, doc: writeDoc } = getDbForWrite();
  try {
    await writeSetDoc(writeDoc(writeDb, 'users', userId), { fcmToken: token }, { merge: true });
    if (__DEV__) console.log('[pushToken] Registered for user', userId);
  } catch (err) {
    if (__DEV__) console.error('[pushToken] Failed to store token:', err);
  }
}

/**
 * Remove FCM token on sign out.
 */
export async function clearPushToken(userId: string): Promise<void> {
  if (!userId) return;
  const { db: writeDb, updateDoc: writeUpdateDoc, deleteField: writeDeleteField, doc: writeDoc } = getDbForWrite();
  try {
    await writeUpdateDoc(writeDoc(writeDb, 'users', userId), { fcmToken: writeDeleteField() });
  } catch (_) {}
}
