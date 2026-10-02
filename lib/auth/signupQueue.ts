/**
 * Signup / profile-write queue — flushed first on reconnect.
 */
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreNative';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  replaceQueue,
  type QueueItem,
} from '@/lib/reliability/StorageManager';
import { retry } from '@/lib/reliability/RetryManager';
import { logAuthReliability, logFirebase, logQueue } from '@/lib/reliability/reliabilityLog';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';
import { markQueueItemInFlight, clearQueueItemInFlight } from '@/lib/reliability/QueueSyncManager';

export type SignupQueuePayload = {
  kind: 'profile_write';
  uid: string;
  data: Record<string, unknown>;
};

const MAX_ATTEMPTS = 8;

async function userDocExists(uid: string): Promise<boolean> {
  try {
    if (Platform.OS !== 'web' && hasRnFirebase) {
      const rnFs = require('@react-native-firebase/firestore');
      const snap = await rnFs.getDoc(rnFs.doc(getRnFirestore(), 'users', uid));
      return !!snap.exists;
    }
    const { doc, getDoc } = await import('firebase/firestore');
    return (await getDoc(doc(db, 'users', uid))).exists();
  } catch {
    return false;
  }
}

async function rawWriteUserDoc(uid: string, data: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rnFs = require('@react-native-firebase/firestore');
    await rnFs.setDoc(rnFs.doc(getRnFirestore(), 'users', uid), sanitizeForFirestore(data));
  } else {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', uid), data);
  }
  logFirebase('PROFILE_WRITE_OK', { uid: uid.slice(0, 8), durationMs: Date.now() - started });
}

export async function enqueueSignupProfileWrite(
  uid: string,
  data: Record<string, unknown>
): Promise<void> {
  const payload: SignupQueuePayload = { kind: 'profile_write', uid, data };
  await addToQueue('pendingSignups', uid, payload);
  logAuthReliability('SIGNUP_QUEUED', { uid: uid.slice(0, 8) });
}

export async function flushSignupQueue(): Promise<void> {
  const items = await getQueue<SignupQueuePayload>('pendingSignups');
  if (items.length === 0) return;
  logQueue('FLUSH_START', { queue: 'pendingSignups', count: items.length });
  const remaining: QueueItem<SignupQueuePayload>[] = [];

  for (const item of items) {
    const flightKey = `signup:${item.id}`;
    if (!markQueueItemInFlight(flightKey)) continue;
    const payload = item.payload;
    try {
      if (payload.kind === 'profile_write') {
        const exists = await userDocExists(payload.uid);
        if (exists) {
          await removeFromQueue('pendingSignups', item.id);
          logAuthReliability('SIGNUP_SKIP_DUPLICATE', { uid: payload.uid.slice(0, 8) });
          continue;
        }
        await retry(() => rawWriteUserDoc(payload.uid, payload.data), {
          label: 'flush_signup_profile',
          maxRetries: 4,
          timeoutMs: 30_000,
        });
        await removeFromQueue('pendingSignups', item.id);
        logQueue('FLUSH_ITEM_OK', { queue: 'pendingSignups', id: item.id });
      }
    } catch (err) {
      captureReliabilityError('signup', err, { id: item.id, attempts: item.attempts });
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        logQueue('FLUSH_ITEM_DROPPED', { queue: 'pendingSignups', id: item.id, attempts });
      } else {
        remaining.push({ ...item, attempts });
        logQueue('FLUSH_ITEM_RETRY', { queue: 'pendingSignups', id: item.id, attempts });
      }
    } finally {
      clearQueueItemInFlight(flightKey);
    }
  }

  if (remaining.length > 0) {
    const current = await getQueue<SignupQueuePayload>('pendingSignups');
    const merged = new Map(current.map((i) => [i.id, i]));
    for (const r of remaining) merged.set(r.id, r);
    await replaceQueue('pendingSignups', [...merged.values()]);
  }
  logQueue('FLUSH_END', { queue: 'pendingSignups', remaining: remaining.length });
}
