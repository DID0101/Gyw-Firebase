/**
 * Reliable user profile writes — retries + MMKV signup queue on failure.
 */
import { Platform } from 'react-native';

import { enqueueSignupProfileWrite } from '@/lib/auth/signupQueue';
import { checkUsernameAvailableForSignup } from '@/lib/auth/usernameCheck';
import { db } from '@/lib/firebase';
import { sanitizeForFirestore } from '@/lib/firestoreNative';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import { removeFromQueue } from '@/lib/reliability/StorageManager';
import { retry } from '@/lib/reliability/RetryManager';
import { logAuthReliability, logFirebase } from '@/lib/reliability/reliabilityLog';
import { captureReliabilityError } from '@/lib/reliability/SentryManager';

export const PROFILE_WRITE_QUEUE = 'user_profile_write';

export type ProfileWritePayload = {
  uid: string;
  data: Record<string, unknown>;
};

async function rawWriteUserDoc(uid: string, data: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rnFs = require('@react-native-firebase/firestore');
    await rnFs.setDoc(rnFs.doc(getRnFirestore(), 'users', uid), sanitizeForFirestore(data));
  } else {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', uid), data);
  }
  logFirebase('WRITE_OK', { collection: 'users', uid: uid.slice(0, 8), durationMs: Date.now() - started });
}

export async function writeUserDocReliable(uid: string, data: Record<string, unknown>): Promise<void> {
  try {
    await retry(() => rawWriteUserDoc(uid, data), {
      label: 'write_user_doc',
      maxRetries: 4,
      timeoutMs: 30_000,
    });
    await removeFromQueue('pendingSignups', uid);
    logAuthReliability('PROFILE_WRITE_OK', { uid: uid.slice(0, 8) });
  } catch (err) {
    await enqueueSignupProfileWrite(uid, data);
    captureReliabilityError('signup', err, { uid: uid.slice(0, 8), phase: 'profile_write' });
    logAuthReliability('PROFILE_WRITE_QUEUED', {
      uid: uid.slice(0, 8),
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function registerProfileWriteProcessor(): void {
  /* profile writes use pendingSignups queue via signupQueue.ts */
}

export async function checkUsernameAvailableStrict(username: string): Promise<boolean> {
  return retry(() => checkUsernameAvailableForSignup(username), {
    label: 'check_username',
    maxRetries: 3,
    timeoutMs: 20_000,
    requireOnline: true,
  });
}
