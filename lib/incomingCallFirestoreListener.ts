/**
 * While the app is open, FCM may not surface a full-screen / notification reliably.
 * Listen for ringing calls where the current user is the receiver and navigate to CallScreen.
 *
 * Requires a composite index on `calls`: receiverId + status (Firestore will prompt on first run).
 */
import { Platform } from 'react-native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

let rnFirestoreMod: typeof import('@react-native-firebase/firestore') | null = null;
if (Platform.OS !== 'web') {
  try {
    rnFirestoreMod = require('@react-native-firebase/firestore');
  } catch {
    /* optional */
  }
}

const MAX_CALL_AGE_MS = 3 * 60 * 1000;

function createdAtToMs(data: Record<string, unknown>): number | null {
  const c = data?.createdAt as { toMillis?: () => number; seconds?: number } | undefined;
  if (!c) return null;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (typeof c.seconds === 'number') return c.seconds * 1000;
  return null;
}

function shouldHandleIncomingCall(data: Record<string, unknown>, receiverUid: string): boolean {
  if (String(data?.status) !== 'ringing') return false;
  if (String(data?.receiverId) !== receiverUid) return false;
  if (data?.isRandom === true) return false;
  const ms = createdAtToMs(data);
  if (ms == null) return true;
  return Date.now() - ms < MAX_CALL_AGE_MS;
}

export type IncomingRingingCallback = (callId: string) => void;

/**
 * Subscribe to ringing calls addressed to this user. Invokes callback once per new/updated match.
 */
export function subscribeIncomingRingingCalls(receiverUid: string, onIncoming: IncomingRingingCallback): () => void {
  if (!receiverUid) return () => {};

  const lastSeen = new Map<string, number>();
  const dedupe = (callId: string) => {
    const now = Date.now();
    const prev = lastSeen.get(callId);
    if (prev != null && now - prev < 4000) return false;
    lastSeen.set(callId, now);
    return true;
  };

  if (Platform.OS !== 'web' && hasRnFirebase && rnFirestoreMod) {
    const rnDb = getRnFirestore();
    const q = rnFirestoreMod.query(
      rnFirestoreMod.collection(rnDb, 'calls'),
      rnFirestoreMod.where('receiverId', '==', receiverUid),
      rnFirestoreMod.where('status', '==', 'ringing')
    );

    return rnFirestoreMod.onSnapshot(
      q,
      (snapshot: { docChanges: () => { type: string; doc: { id: string; data: () => Record<string, unknown> } }[] }) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === 'removed') continue;
          const d = change.doc.data();
          if (!shouldHandleIncomingCall(d, receiverUid)) continue;
          const id = change.doc.id;
          console.error('⏰ FIRESTORE CALL DETECTED at', Date.now(), {
            callId: id,
            source: 'incomingCallFirestoreListener/native',
          });
          if (dedupe(id)) onIncoming(id);
        }
      },
      (err: unknown) => {
        if (__DEV__) console.warn('[incomingCallFirestoreListener] native snapshot error', err);
      }
    );
  }

  const q = query(
    collection(db, 'calls'),
    where('receiverId', '==', receiverUid),
    where('status', '==', 'ringing')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'removed') continue;
        const d = change.doc.data() as Record<string, unknown>;
        if (!shouldHandleIncomingCall(d, receiverUid)) continue;
        const id = change.doc.id;
        console.error('⏰ FIRESTORE CALL DETECTED at', Date.now(), {
          callId: id,
          source: 'incomingCallFirestoreListener/web',
        });
        if (dedupe(id)) onIncoming(id);
      }
    },
    (err) => {
      if (__DEV__) console.warn('[incomingCallFirestoreListener] web snapshot error', err);
    }
  );
}
