/**
 * Random (Omegle-style) video chat matchmaking.
 * - Queue in Firestore (randomQueue)
 * - Matchmaking via Cloud Function tryMatch
 * - Listen for incoming random call when waiting
 *
 * On native: uses React Native Firebase Firestore (shares auth with native auth).
 * On web: uses web SDK Firestore.
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { app, db, functions, httpsCallable } from '@/lib/firebase';
import { Platform } from 'react-native';
import { hasNativeFirestore } from '@/lib/firestoreNative';
import { getRnAuth, getRnFirestore } from '@/lib/rnFirebase';

const QUEUE_COLLECTION = 'randomQueue';
const HEARTBEAT_INTERVAL_MS = 12000; // 12 seconds
const AUDIT = __DEV__;

function audit(op: string, phase: 'before' | 'after' | 'error', extra?: Record<string, unknown>) {
  if (!AUDIT) return;
  let nativeUid: string | null = null;
  const projectId = app?.options?.projectId ?? 'unknown';
  if (Platform.OS !== 'web') {
    const rnAuth = getRnAuth();
    nativeUid = rnAuth?.currentUser?.uid ?? null;
  }
  console.log(`[DiscoverAudit] ${op} ${phase}`, JSON.stringify({
    op,
    phase,
    projectId,
    sdk: hasNativeFirestore ? 'RN_Firebase' : 'Web_SDK',
    nativeAuthUid: nativeUid,
    ...extra,
  }));
}

/** Add current user to the random queue. Uses UID as document ID (one entry per user).
 * Returns queue doc id (userId) for leaveQueue. */
export async function joinQueue(
  userId: string,
  preferences: { video: boolean } = { video: true }
): Promise<string> {
  const path = `${QUEUE_COLLECTION}/${userId}`;
  const clientTimeMs = Date.now();
  audit('joinQueue_setDoc', 'before', {
    userId,
    path,
    clientTimeMs,
    clientTimeIso: new Date(clientTimeMs).toISOString(),
  });

  try {
    if (hasNativeFirestore) {
      const { doc, setDoc, serverTimestamp, Timestamp } = require('@react-native-firebase/firestore');
      const db = getRnFirestore();
      const ref = doc(db, QUEUE_COLLECTION, userId);
      const ts = Timestamp.now();
      audit('joinQueue_setDoc', 'heartbeat', {
        lastSeenWrittenMs: ts?.toMillis?.() ?? clientTimeMs,
      });
      await setDoc(ref, {
        userId,
        status: 'waiting',
        createdAt: serverTimestamp(),
        lastSeen: Timestamp.now(),
        preferences,
      });
    } else {
      const ts = Timestamp.now();
      audit('joinQueue_setDoc', 'heartbeat', {
        lastSeenWrittenMs: ts?.toMillis?.() ?? clientTimeMs,
      });
      const ref = doc(db, QUEUE_COLLECTION, userId);
      await setDoc(ref, {
        userId,
        status: 'waiting',
        createdAt: serverTimestamp(),
        lastSeen: ts,
        preferences,
      });
    }
    audit('joinQueue_setDoc', 'after', { path });
    return userId;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    audit('joinQueue_setDoc', 'error', { path, errorCode: e?.code, errorMessage: e?.message });
    throw err;
  }
}

/** Update lastSeen timestamp for heartbeat (keeps user in queue). */
export async function updateQueueHeartbeat(queueDocId: string): Promise<void> {
  const clientTimeMs = Date.now();
  let lastSeenWrittenMs: number | null = null;
  if (hasNativeFirestore) {
    const { Timestamp } = require('@react-native-firebase/firestore');
    const ts = Timestamp.now();
    lastSeenWrittenMs = ts?.toMillis?.() ?? clientTimeMs;
  } else {
    const ts = Timestamp.now();
    lastSeenWrittenMs = ts?.toMillis?.() ?? clientTimeMs;
  }
  audit('updateQueueHeartbeat', 'before', {
    queueDocId,
    clientTimeMs,
    lastSeenWrittenMs,
    clientTimeIso: new Date(clientTimeMs).toISOString(),
  });
  try {
    if (hasNativeFirestore) {
      const { doc, updateDoc, Timestamp } = require('@react-native-firebase/firestore');
      const db = getRnFirestore();
      const ref = doc(db, QUEUE_COLLECTION, queueDocId);
      await updateDoc(ref, { lastSeen: Timestamp.now() });
    } else {
      const d = doc(db, QUEUE_COLLECTION, queueDocId);
      await updateDoc(d, { lastSeen: Timestamp.now() });
    }
    audit('updateQueueHeartbeat', 'after', {
      queueDocId,
      lastSeenWrittenMs,
    });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    audit('updateQueueHeartbeat', 'error', { queueDocId, errorCode: e?.code, errorMessage: e?.message });
    throw err;
  }
}

/** Start heartbeat interval. Returns cleanup function. */
export function startQueueHeartbeat(
  queueDocId: string,
  intervalMs: number = HEARTBEAT_INTERVAL_MS
): () => void {
  const interval = setInterval(() => {
    updateQueueHeartbeat(queueDocId).catch((err) => {
      console.warn('Heartbeat update failed:', err);
    });
  }, intervalMs);
  return () => clearInterval(interval);
}

/** Remove user from queue (e.g. cancel search). */
export async function leaveQueue(queueDocId: string): Promise<void> {
  audit('leaveQueue_deleteDoc', 'before', { queueDocId });
  try {
    if (hasNativeFirestore) {
      const { doc, deleteDoc } = require('@react-native-firebase/firestore');
      const db = getRnFirestore();
      const ref = doc(db, QUEUE_COLLECTION, queueDocId);
      await deleteDoc(ref);
    } else {
      const d = doc(db, QUEUE_COLLECTION, queueDocId);
      await deleteDoc(d);
    }
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    audit('leaveQueue_deleteDoc', 'error', { queueDocId, errorCode: e?.code, errorMessage: e?.message });
    throw err;
  }
}

type TryMatchData =
  | { matched: true; callId: string; otherUserId: string }
  | { matched: false }
  | { visibleQueueSize: number; visibleDocIds: string[] };

/** Invoke tryRandomMatch via proper callable SDK. Native: @react-native-firebase/functions. Web: firebase/functions. */
export async function tryMatch(
  userId: string,
  queueDocId: string
): Promise<{ matched: true; callId: string; otherUserId: string } | { matched: false }> {
  audit('tryMatch_callable', 'before', {
    userId,
    queueDocId,
    sdk: Platform.OS === 'web' ? 'Web' : 'RN_Firebase',
    callableRegion: 'us-central1',
  });

  let data: TryMatchData;
  try {
    if (Platform.OS === 'web') {
      const tryMatchFn = httpsCallable<
        { queueDocId: string; userId: string },
        TryMatchData
      >(functions, 'tryRandomMatch');
      const response = await tryMatchFn({ queueDocId, userId });
      data = response.data;
      if (__DEV__) {
        audit('tryMatch_callable', 'raw_response', {
          responseData: response.data,
          dataKeys: data != null ? Object.keys(data as object) : [],
        });
      }
    } else {
      // RN Firebase httpsCallable has a known issue not attaching auth token. Use REST with explicit token.
      const { getApp, getApps } = require('@react-native-firebase/app');
      const { getAuth, getIdToken } = require('@react-native-firebase/auth');

      const rnApp = getApp();
      const auth = getAuth(rnApp);

      if (__DEV__) {
        console.log('APPS COUNT', getApps().length);
        audit('tryMatch_callable', 'auth_check', {
          currentUserUid: auth?.currentUser?.uid ?? null,
        });
      }

      if (!auth.currentUser) {
        throw new Error('No authenticated user before tryRandomMatch');
      }

      const idToken = await getIdToken(auth.currentUser, true);
      if (__DEV__) {
        audit('tryMatch_callable', 'token_refresh', { success: !!idToken });
      }

      const projectId = rnApp?.options?.projectId ?? app?.options?.projectId ?? 'gyw1-146d7';
      const url = `https://us-central1-${projectId}.cloudfunctions.net/tryRandomMatch`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ data: { queueDocId, userId } }),
      });

      const rawText = await res.text();
      if (__DEV__ && (res.status !== 200 || !rawText.startsWith('{'))) {
        console.warn('[tryMatch] Non-JSON response', {
          status: res.status,
          statusText: res.statusText,
          bodyPreview: rawText.slice(0, 200),
        });
      }
      let json: { result?: TryMatchData; error?: { code?: string; message?: string } };
      try {
        json = JSON.parse(rawText);
      } catch {
        throw Object.assign(new Error(`Callable returned non-JSON (status ${res.status})`), {
          code: res.status === 401 ? 'unauthenticated' : 'internal',
        });
      }
      if (json.error) {
        const err = json.error;
        throw Object.assign(new Error(err.message ?? 'Callable failed'), { code: err.code });
      }
      data = json.result;

      if (__DEV__) {
        audit('tryMatch_callable', 'raw_response', {
          responseData: data,
          dataKeys: data != null ? Object.keys(data as object) : [],
        });
      }
    }

    if (data == null || typeof data !== 'object') {
      audit('tryMatch_callable', 'invalid_data', { data });
      return { matched: false };
    }

    const visData = data as { visibleQueueSize?: number; visibleDocIds?: string[] };
    if (typeof visData.visibleQueueSize === 'number' && Array.isArray(visData.visibleDocIds)) {
      audit('tryMatch_callable', 'visibility_proof', {
        visibleQueueSize: visData.visibleQueueSize,
        visibleDocIds: visData.visibleDocIds,
        userId,
      });
      return { matched: false };
    }

    audit('tryMatch_callable', 'after', { matched: (data as { matched?: boolean }).matched });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    audit('tryMatch_callable', 'error', { errorCode: e?.code, errorMessage: e?.message });
    throw err;
  }

  const d = data as { matched?: boolean; callId?: string; otherUserId?: string };
  if (d.matched === true && d.callId && d.otherUserId) {
    return { matched: true, callId: d.callId, otherUserId: d.otherUserId };
  }
  return { matched: false };
}

/** Subscribe to random session (Omegle-style). Fires when user is matched - as caller OR receiver.
 * Both users get the same session and navigate instantly. No ringing, no accept/reject. */
export function listenForRandomSession(
  userId: string,
  onSession: (callId: string) => void,
  onError?: (err: Error) => void
): () => void {
  audit('listenForRandomSession', 'before', { userId });

  const fireSession = (callId: string) => {
    audit('listenForRandomSession', 'session_found', { callId });
    onSession(callId);
  };

  if (hasNativeFirestore) {
    const { collection, query, where, limit, onSnapshot } = require('@react-native-firebase/firestore');
    const db = getRnFirestore();
    const callsRef = collection(db, 'calls');
    const qCaller = query(
      callsRef,
      where('callerId', '==', userId),
      where('isRandom', '==', true),
      where('status', 'in', ['ringing', 'active']),
      limit(1)
    );
    const qReceiver = query(
      callsRef,
      where('receiverId', '==', userId),
      where('isRandom', '==', true),
      where('status', 'in', ['ringing', 'active']),
      limit(1)
    );
    const unsubCaller = onSnapshot(
      qCaller,
      (snap: any) => {
        const docs = snap.docs ?? [];
        const first = docs[0];
        if (first) fireSession(first.id);
      },
      (err: any) => {
        audit('listenForRandomSession', 'error', { errorCode: (err as any)?.code });
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
    const unsubReceiver = onSnapshot(
      qReceiver,
      (snap: any) => {
        const docs = snap.docs ?? [];
        const first = docs[0];
        if (first) fireSession(first.id);
      },
      (err: any) => {
        audit('listenForRandomSession', 'error', { errorCode: (err as any)?.code });
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
    return () => {
      unsubCaller();
      unsubReceiver();
    };
  }

  const callsRef = collection(db, 'calls');
  const qCaller = query(
    callsRef,
    where('callerId', '==', userId),
    where('isRandom', '==', true),
    where('status', 'in', ['ringing', 'active']),
    limit(1)
  );
  const qReceiver = query(
    callsRef,
    where('receiverId', '==', userId),
    where('isRandom', '==', true),
    where('status', 'in', ['ringing', 'active']),
    limit(1)
  );
  const unsubCaller = onSnapshot(
    qCaller,
    (snapshot) => {
      const first = snapshot.docs[0];
      if (first) fireSession(first.id);
    },
    (err) => {
      audit('listenForRandomSession', 'error', { errorCode: (err as any)?.code });
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  );
  const unsubReceiver = onSnapshot(
    qReceiver,
    (snapshot) => {
      const first = snapshot.docs[0];
      if (first) fireSession(first.id);
    },
    (err) => {
      audit('listenForRandomSession', 'error', { errorCode: (err as any)?.code });
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  );
  return () => {
    unsubCaller();
    unsubReceiver();
  };
}
