/**
 * Persists FCM registration tokens to `users/{uid}/fcmTokens/{docId}` for Cloud Function `onCallCreated`.
 *
 * Best practices (reduces stale / invalid tokens server-side):
 * - Keep `setupFcmTokenForUser` mounted while signed in; `onTokenRefresh` must write here.
 * - Foreground: `refreshFcmTokenOnAppForeground` (AuthContext) bumps `updatedAt` / `lastActiveAt` via `getToken` + write.
 * - Do not call `deleteToken()` except sign-out or user disables notifications; rotation is handled by the SDK + onTokenRefresh.
 * - Optional: use `refreshFcmTokenToFirestore` from dev tools after reinstall.
 * - Each successful subdoc write also merges `fcmTokenUpdatedAt` / `fcmTokenSubdocId` on `users/{uid}` so
 *   Console metadata matches reality (Cloud Functions **only** read `users/{uid}/fcmTokens/*`).
 *
 * Expo Go: not supported.
 */
import { Platform } from 'react-native';

import { getRnAuth, getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

/** Firestore doc id under fcmTokens — suffix-based; sanitize for doc id rules. */
function tokenDocId(token: string): string {
  return token.slice(-25).replace(/[^a-zA-Z0-9]/g, '_');
}

/** Ensures ID token is fresh so Firestore security rules see request.auth.uid. */
async function ensureFirestoreAuthForWrite(): Promise<void> {
  if (Platform.OS === 'web' || !hasRnFirebase) return;
  try {
    const u = getRnAuth()?.currentUser;
    if (u) await u.getIdToken(true);
  } catch {
    /* ignore */
  }
}

/**
 * Minimum length to persist registration tokens. Must stay in sync with
 * `FCM_MIN_STORED_TOKEN_LEN` in `functions/src/callPush.ts` (currently 140).
 * Some OEMs (e.g. broken GMS caches) return ~142-char tokens; refusing 140–149
 * leaves `users/{uid}/fcmTokens` empty while `onCallCreated` expects subdocs here.
 */
export const FCM_MIN_PERSIST_TOKEN_LEN = 140;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withFirestoreWriteRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const delayMs = 400 * 2 ** attempt;
      console.error(`[fcmTokenService] ${label} attempt ${attempt + 1} failed, retry in ${delayMs}ms`, e);
      if (attempt < 2) await sleep(delayMs);
    }
  }
  throw last;
}

/** Save a token you already obtained (e.g. bootstrap) — same path as setupFcmTokenForUser writes. */
export async function persistFcmTokenString(uid: string, token: string): Promise<void> {
  if (Platform.OS === 'web' || !hasRnFirebase || !token) return;
  if (token.length < FCM_MIN_PERSIST_TOKEN_LEN) {
    console.error('❌ [fcmTokenService] FCM TOKEN INVALID length:', token.length);
    return;
  }
  await writeToken(uid, token);
}

async function writeToken(uid: string, token: string): Promise<void> {
  if (!token || token.length < FCM_MIN_PERSIST_TOKEN_LEN) {
    console.error('❌ [fcmTokenService] writeToken skipped — length:', token?.length ?? 0);
    return;
  }
  await ensureFirestoreAuthForWrite();
  const fs = require('@react-native-firebase/firestore');
  const db = getRnFirestore();
  const ref = fs.doc(db, 'users', uid, 'fcmTokens', tokenDocId(token));
  const now = new Date().toISOString();
  await withFirestoreWriteRetry('fcmTokens subdoc setDoc', () =>
    fs.setDoc(ref, {
      token,
      tokenLength: token.length,
      platform: Platform.OS,
      active: true,
      updatedAt: now,
      lastActiveAt: now,
    })
  );
  await withFirestoreWriteRetry('users fcmTokenUpdatedAt merge', () =>
    fs.setDoc(
      fs.doc(db, 'users', uid),
      {
        fcmTokenUpdatedAt: now,
        fcmTokenSubdocId: tokenDocId(token),
        fcmTokenPlatform: Platform.OS,
      },
      { merge: true }
    )
  );
  console.error(
    '📤 TOKEN SAVED TO FIRESTORE uid=' + uid + ' len=' + token.length + ' docId=' + tokenDocId(token)
  );
}

/** Request permission (iOS), fetch token, store in Firestore, subscribe to token refresh. */
export function setupFcmTokenForUser(uid: string): () => void {
  if (Platform.OS === 'web' || !hasRnFirebase) {
    return () => {};
  }

  let unsubscribeRefresh: (() => void) | undefined;

  const run = async () => {
    try {
      const messaging = require('@react-native-firebase/messaging').default;
      await messaging().requestPermission();

      const token = await messaging().getToken();
      console.error('🔑 CURRENT FCM TOKEN:', token);
      if (token) {
        await writeToken(uid, token);
      }

      unsubscribeRefresh = messaging().onTokenRefresh(async (newToken: string) => {
        try {
          console.error('🔑 CURRENT FCM TOKEN (refresh):', newToken);
          await writeToken(uid, newToken);
        } catch (e) {
          if (__DEV__) console.warn('[fcmTokenService] onTokenRefresh write failed', e);
        }
      });
    } catch (e) {
      if (__DEV__) console.warn('[fcmTokenService] setup failed', e);
    }
  };

  void run();

  return () => {
    try {
      unsubscribeRefresh?.();
    } catch {
      /* ignore */
    }
  };
}

/** Remove current device token doc before sign-out. */
export async function removeCurrentFcmTokenDoc(uid: string): Promise<void> {
  if (Platform.OS === 'web' || !hasRnFirebase) return;
  try {
    await ensureFirestoreAuthForWrite();
    const messaging = require('@react-native-firebase/messaging').default;
    const fs = require('@react-native-firebase/firestore');
    const token = await messaging().getToken();
    if (!token) return;
    const db = getRnFirestore();
    await fs.deleteDoc(fs.doc(db, 'users', uid, 'fcmTokens', tokenDocId(token)));
  } catch (e) {
    if (__DEV__) console.warn('[fcmTokenService] remove token failed', e);
  }
}

/** Diagnostics: current device registration token (logs with 🔑). */
export async function getCurrentFcmTokenForDiagnostics(): Promise<string | null> {
  if (Platform.OS === 'web' || !hasRnFirebase) return null;
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const token = await messaging().getToken();
    console.error('🔑 CURRENT FCM TOKEN (diagnostics getToken):', token);
    return token && token.length > 0 ? token : null;
  } catch (e) {
    console.error('🔑 CURRENT FCM TOKEN ERROR:', e);
    return null;
  }
}

export type FirestoreFcmTokenDoc = { docId: string; token: string; platform?: string };

/** Load stored tokens under users/{uid}/fcmTokens (for mismatch checks vs device token). */
export async function listFirestoreFcmTokenDocs(uid: string): Promise<FirestoreFcmTokenDoc[]> {
  if (Platform.OS === 'web' || !hasRnFirebase) return [];
  try {
    await ensureFirestoreAuthForWrite();
    const fs = require('@react-native-firebase/firestore');
    const db = getRnFirestore();
    const snap = await fs.getDocs(fs.collection(db, 'users', uid, 'fcmTokens'));
    const out: FirestoreFcmTokenDoc[] = [];
    snap.forEach((d: { id: string; data: () => Record<string, unknown> }) => {
      const data = d.data();
      const t = typeof data.token === 'string' ? data.token : '';
      if (t) out.push({ docId: d.id, token: t, platform: data.platform as string | undefined });
    });
    return out;
  } catch (e) {
    if (__DEV__) console.warn('[fcmTokenService] listFirestoreFcmTokenDocs', e);
    return [];
  }
}

/** Force re-fetch token and upsert Firestore (debug “Refresh token” button). */
export async function refreshFcmTokenToFirestore(uid: string): Promise<void> {
  if (Platform.OS === 'web' || !hasRnFirebase) return;
  const token = await getCurrentFcmTokenForDiagnostics();
  if (token) await writeToken(uid, token);
}

/** Throttled `getToken` + Firestore upsert when app returns to foreground (keeps `updatedAt` fresh). */
const FOREGROUND_TOKEN_TOUCH_MIN_MS = 4 * 60 * 60 * 1000;
let lastForegroundTokenTouchAt = 0;

export async function refreshFcmTokenOnAppForeground(uid: string): Promise<void> {
  if (Platform.OS === 'web' || !hasRnFirebase || !uid) return;
  const now = Date.now();
  if (now - lastForegroundTokenTouchAt < FOREGROUND_TOKEN_TOUCH_MIN_MS) return;
  lastForegroundTokenTouchAt = now;
  try {
    const messaging = require('@react-native-firebase/messaging').default;
    const token = await messaging().getToken();
    if (token) await writeToken(uid, token);
  } catch (e) {
    if (__DEV__) console.warn('[fcmTokenService] refreshFcmTokenOnAppForeground failed', e);
  }
}
