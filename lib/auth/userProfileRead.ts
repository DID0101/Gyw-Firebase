import { Platform } from 'react-native';

import { db } from '@/lib/firebase';
import { getDeviceRegionCode, phoneQueryCandidates } from '@/lib/phoneNormalize';
import { getRnFirestore, hasRnFirebase } from '@/lib/rnFirebase';
import { isPermissionDeniedError } from '@/lib/auth/waitForAuthToken';

export type UserProfileSnapshot = {
  firstName?: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string;
};

function snapDocExists(snap: { exists?: boolean | (() => boolean) }): boolean {
  return typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
}

function snapDocData<T>(snap: { data?: (() => T) | T }): T | undefined {
  if (typeof snap.data === 'function') return (snap.data as () => T)();
  return snap.data as T | undefined;
}

export function isCompleteUserProfile(data: UserProfileSnapshot | null | undefined): boolean {
  const firstName = String(data?.firstName ?? '').trim();
  const username = String(data?.username ?? '').trim();
  return !!(firstName && username);
}

export async function readUserProfileByUid(uid: string): Promise<UserProfileSnapshot | null> {
  if (Platform.OS !== 'web' && hasRnFirebase) {
    const rnFs = require('@react-native-firebase/firestore');
    const snap = await rnFs.getDoc(rnFs.doc(getRnFirestore(), 'users', uid));
    if (!snapDocExists(snap)) return null;
    return (snapDocData(snap) as UserProfileSnapshot) ?? null;
  }
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfileSnapshot) : null;
}

async function readCompleteProfileByPhone(
  phone: string
): Promise<{ uid: string; profile: UserProfileSnapshot } | null> {
  const candidates = phoneQueryCandidates(phone, getDeviceRegionCode());
  if (candidates.length === 0) return null;

  for (let i = 0; i < candidates.length; i += 10) {
    const chunk = candidates.slice(i, i + 10);
    if (Platform.OS !== 'web' && hasRnFirebase) {
      const rnFs = require('@react-native-firebase/firestore');
      const q = rnFs.query(
        rnFs.collection(getRnFirestore(), 'users'),
        rnFs.where('phoneNumber', 'in', chunk)
      );
      const snap = await rnFs.getDocs(q);
      for (const docSnap of snap.docs) {
        const profile = snapDocData(docSnap) as UserProfileSnapshot;
        if (isCompleteUserProfile(profile)) {
          return { uid: docSnap.id, profile };
        }
      }
    } else {
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      const q = query(collection(db, 'users'), where('phoneNumber', 'in', chunk));
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const profile = docSnap.data() as UserProfileSnapshot;
        if (isCompleteUserProfile(profile)) {
          return { uid: docSnap.id, profile };
        }
      }
    }
  }
  return null;
}

export async function hasCompleteUserProfileByUid(uid: string, retries = 4): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const profile = await readUserProfileByUid(uid);
      if (isCompleteUserProfile(profile)) return true;
      if (profile === null && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      return false;
    } catch {
      if (attempt === retries - 1) {
        throw Object.assign(new Error('Could not load your profile. Check connection and try again.'), {
          code: 'network/offline',
        });
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

/** Sign-in: uid doc first, then registered phone lookup (handles RN snap.exists quirks + token lag). */
export async function hasCompleteProfileForSignIn(uid: string, phone: string, retries = 5): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const profile = await readUserProfileByUid(uid);
      if (isCompleteUserProfile(profile)) return true;

      const byPhone = await readCompleteProfileByPhone(phone);
      if (byPhone && (byPhone.uid === uid || isCompleteUserProfile(byPhone.profile))) {
        return true;
      }

      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    } catch (e) {
      if (attempt < retries - 1 && isPermissionDeniedError(e)) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  return false;
}
