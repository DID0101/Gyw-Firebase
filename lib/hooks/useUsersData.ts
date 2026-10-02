import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import { User } from '@/lib/types/chat';
import { setCachedUserProfile } from '@/lib/cache/userProfileCache';
import { hasNativeFirestore, getUserDocNative } from '@/lib/firestoreNative';
import { isLowTierAndroid } from '@/lib/perf/deviceProfile';
import { useUserProfileStore } from '@/store/userProfileStore';

const CHUNK_SIZE_DEFAULT = 8;
const CHUNK_SIZE_LOW_TIER = 5;
const CHUNK_DELAY_MS = 16;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function fetchOneUser(uid: string, useNative: boolean): Promise<[string, User] | null> {
  try {
    let data: Record<string, unknown> | null = null;
    if (useNative) {
      const raw = await getUserDocNative(uid);
      if (raw) {
        data = { ...raw, uid: (raw as { id?: string }).id || uid };
      }
    } else {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        data = { ...userDoc.data(), uid: userDoc.id } as Record<string, unknown>;
      }
    }
    if (!data) return null;
    const createdAt = data.createdAt as { toDate?: () => Date } | string | undefined;
    const updatedAt = data.updatedAt as { toDate?: () => Date } | string | undefined;
    return [
      uid,
      {
        ...data,
        uid: (data.uid as string) || uid,
        createdAt:
          typeof createdAt === 'object' && createdAt?.toDate
            ? createdAt.toDate()?.toISOString()
            : (createdAt as string | undefined),
        updatedAt:
          typeof updatedAt === 'object' && updatedAt?.toDate
            ? updatedAt.toDate()?.toISOString()
            : (updatedAt as string | undefined),
      } as User,
    ];
  } catch {
    return null;
  }
}

// Hook to fetch user data for multiple user IDs (batched on Android low-tier).
export const useUsersData = (userIds: string[]) => {
  const [usersData, setUsersData] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  const userIdsKey = useMemo(() => [...userIds].sort().join(','), [userIds]);

  useEffect(() => {
    if (userIds.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchUsers = async () => {
      try {
        const idsToFetch = userIds.filter((id) => !fetchedIdsRef.current.has(id));
        if (idsToFetch.length === 0) {
          setLoading(false);
          return;
        }
        setLoading(true);

        const useNative = Platform.OS !== 'web' && hasNativeFirestore;
        const chunkSize =
          Platform.OS === 'android' && isLowTierAndroid()
            ? CHUNK_SIZE_LOW_TIER
            : CHUNK_SIZE_DEFAULT;
        const chunks = chunkArray(idsToFetch, chunkSize);

        for (const chunk of chunks) {
          if (cancelled) return;
          const results = await Promise.all(
            chunk.map((uid) => fetchOneUser(uid, useNative))
          );
          const chunkUsers: Record<string, User> = {};
          for (const entry of results) {
            if (entry) {
              fetchedIdsRef.current.add(entry[0]);
              chunkUsers[entry[0]] = entry[1];
            }
          }
          if (Object.keys(chunkUsers).length > 0) {
            for (const [uid, profile] of Object.entries(chunkUsers)) {
              setCachedUserProfile(uid, profile);
            }
            useUserProfileStore.getState().mergeProfiles(chunkUsers);
            setUsersData((prev) => ({ ...prev, ...chunkUsers }));
          }
          if (Platform.OS === 'android' && isLowTierAndroid() && chunks.length > 1) {
            await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [userIdsKey]);

  return { usersData, loading };
};
