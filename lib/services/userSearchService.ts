import { Platform } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { hasNativeFirestore } from '@/lib/firestoreNative';
import { getRnFirestore } from '@/lib/rnFirebase';
import { looksLikePhoneQuery, phoneQueryCandidates } from '@/lib/phoneNormalize';
import type { CountryCode } from 'libphonenumber-js';
import { User } from '@/lib/types/chat';

const PHONE_IN_CHUNK = 30;

function mapUserDoc(id: string, data: Record<string, any>): User {
  return {
    uid: id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
  } as User;
}

async function getUsersByPhoneInWeb(
  phoneValues: string[],
  excludeUid?: string
): Promise<User[]> {
  const uniq = [...new Set(phoneValues.filter(Boolean))];
  if (uniq.length === 0) return [];
  const usersRef = collection(db, 'users');
  const byId = new Map<string, User>();

  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += PHONE_IN_CHUNK) {
    chunks.push(uniq.slice(i, i + PHONE_IN_CHUNK));
  }
  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      wave.map((chunk) =>
        getDocs(query(usersRef, where('phoneNumber', 'in', chunk)))
      )
    );
    for (const snap of snaps) {
      snap.docs.forEach((d) => {
        const u = mapUserDoc(d.id, d.data() as Record<string, any>);
        if (!excludeUid || u.uid !== excludeUid) byId.set(u.uid, u);
      });
    }
  }
  return [...byId.values()];
}

async function getUsersByPhoneInNative(
  phoneValues: string[],
  excludeUid?: string
): Promise<User[]> {
  const firestore = require('@react-native-firebase/firestore');
  const nativeDb = getRnFirestore();
  const uniq = [...new Set(phoneValues.filter(Boolean))];
  if (uniq.length === 0) return [];
  const byId = new Map<string, User>();

  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += PHONE_IN_CHUNK) {
    chunks.push(uniq.slice(i, i + PHONE_IN_CHUNK));
  }
  const CONCURRENCY = 4;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const wave = chunks.slice(i, i + CONCURRENCY);
    const snaps = await Promise.all(
      wave.map((chunk) =>
        firestore.getDocs(
          firestore.query(
            firestore.collection(nativeDb, 'users'),
            firestore.where('phoneNumber', 'in', chunk)
          )
        )
      )
    );
    for (const snap of snaps) {
      snap.forEach((d: any) => {
        const u = mapUserDoc(d.id, d.data() as Record<string, any>);
        if (!excludeUid || u.uid !== excludeUid) byId.set(u.uid, u);
      });
    }
  }
  return [...byId.values()];
}

export async function getUsersByPhoneNumbersIn(
  phoneValues: string[],
  excludeUid?: string
): Promise<User[]> {
  if (phoneValues.length === 0) return [];
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    return getUsersByPhoneInNative(phoneValues, excludeUid);
  }
  return getUsersByPhoneInWeb(phoneValues, excludeUid);
}

async function getUserByUsernameWeb(username: string, excludeUid?: string): Promise<User | null> {
  const usersRef = collection(db, 'users');
  const q = query(usersRef, where('username', '==', username));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const u = mapUserDoc(d.id, d.data() as Record<string, any>);
  if (excludeUid && u.uid === excludeUid) return null;
  return u;
}

async function getUserByUsernameNative(username: string, excludeUid?: string): Promise<User | null> {
  const firestore = require('@react-native-firebase/firestore');
  const nativeDb = getRnFirestore();
  const q = firestore.query(
    firestore.collection(nativeDb, 'users'),
    firestore.where('username', '==', username)
  );
  const snap = await firestore.getDocs(q);
  if (snap.empty) return null;
  let picked: User | null = null;
  snap.forEach((d: any) => {
    if (picked) return;
    const u = mapUserDoc(d.id, d.data() as Record<string, any>);
    if (!excludeUid || u.uid !== excludeUid) picked = u;
  });
  return picked;
}

export async function getUserByUsernameExact(
  username: string,
  excludeUid?: string
): Promise<User | null> {
  const u = username.trim();
  if (!u) return null;
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const hit = await getUserByUsernameNative(u, excludeUid);
    if (hit) return hit;
    if (u !== u.toLowerCase()) {
      return getUserByUsernameNative(u.toLowerCase(), excludeUid);
    }
    return null;
  }
  const hit = await getUserByUsernameWeb(u, excludeUid);
  if (hit) return hit;
  if (u !== u.toLowerCase()) {
    return getUserByUsernameWeb(u.toLowerCase(), excludeUid);
  }
  return null;
}

/**
 * Search by exact username OR by phone (normalized candidates). Returns deduped list.
 */
export async function searchUsersByUsernameOrPhone(
  input: string,
  excludeUid: string | undefined,
  region: CountryCode
): Promise<User[]> {
  const q = input.trim();
  if (!q) return [];

  if (looksLikePhoneQuery(q)) {
    const candidates = phoneQueryCandidates(q, region);
    const hits = await getUsersByPhoneNumbersIn(candidates, excludeUid);
    return hits;
  }

  const one = await getUserByUsernameExact(q, excludeUid);
  return one ? [one] : [];
}
