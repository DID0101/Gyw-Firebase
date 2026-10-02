import { Platform } from 'react-native';

import { functions, httpsCallable } from '@/lib/firebase';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';

import { callNativeCallable } from './nativeCallableRest';

type CheckRequest = { username: string };
type CheckResponse = { available: boolean };

async function invokeCheckUsernameAvailable(username: string): Promise<boolean> {
  const payload: CheckRequest = { username };
  if (Platform.OS === 'web') {
    const fn = httpsCallable<CheckRequest, CheckResponse>(functions, 'checkUsernameAvailable');
    const { data } = await fn(payload);
    return data.available;
  }
  const data = await callNativeCallable<CheckRequest, CheckResponse>(
    'checkUsernameAvailable',
    payload,
  );
  return data.available;
}

async function checkUsernameViaFirestore(username: string): Promise<boolean> {
  const normalized = username.trim().toLowerCase();
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rnFs = require('@react-native-firebase/firestore');
    const q = rnFs.query(
      rnFs.collection(getRnFirestore(), 'users'),
      rnFs.where('username', '==', normalized),
      rnFs.limit(1),
    );
    const snap = await rnFs.getDocs(q);
    return snap.empty;
  }
  const { collection, getDocs, query, where, limit } = await import('firebase/firestore');
  const { db } = await import('@/lib/firebase');
  const snap = await getDocs(
    query(collection(db, 'users'), where('username', '==', normalized), limit(1)),
  );
  return snap.empty;
}

function isSignedInForFirestore(): boolean {
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const { getRnAuth } = require('@/lib/rnFirebase') as typeof import('@/lib/rnFirebase');
    return !!getRnAuth()?.currentUser?.uid;
  }
  const { auth } = require('@/lib/firebase') as typeof import('@/lib/firebase');
  return !!auth.currentUser?.uid;
}

function isCallableUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  const code = e?.code ?? '';
  const msg = e?.message ?? '';
  return (
    code === 'functions/not-found' ||
    code === 'not-found' ||
    msg.includes('NOT_FOUND') ||
    msg.includes('404')
  );
}

/**
 * Username availability — Cloud Function before sign-in; Firestore when signed in.
 */
export async function checkUsernameAvailableForSignup(username: string): Promise<boolean> {
  if (isSignedInForFirestore()) {
    return checkUsernameViaFirestore(username);
  }
  try {
    return await invokeCheckUsernameAvailable(username);
  } catch (error) {
    if (isCallableUnavailable(error)) {
      throw Object.assign(
        new Error(
          'Username check service not deployed. Run: firebase deploy --only functions:checkUsernameAvailable',
        ),
        { code: 'functions/not-found' },
      );
    }
    throw error;
  }
}
