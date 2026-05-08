import { Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState, useMemo, useRef } from 'react';
import { db } from '@/lib/firebase';
import { User } from '@/lib/types/chat';
import { hasNativeFirestore, getUserDocNative } from '@/lib/firestoreNative';

// Hook to fetch user data for multiple user IDs
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

    const fetchUsers = async () => {
      try {
        setLoading(true);
        const idsToFetch = userIds.filter((id) => !fetchedIdsRef.current.has(id));
        if (idsToFetch.length === 0) {
          setLoading(false);
          return;
        }

        const useNative = Platform.OS !== 'web' && hasNativeFirestore;

        // Fetch all users in parallel instead of sequentially.
        const results = await Promise.all(
          idsToFetch.map(async (uid) => {
            try {
              let data: any = null;
              if (useNative) {
                const raw = await getUserDocNative(uid);
                if (raw) {
                  data = { ...raw, uid: raw.id || uid };
                }
              } else {
                const userDoc = await getDoc(doc(db, 'users', uid));
                if (userDoc.exists()) {
                  data = { ...userDoc.data(), uid: userDoc.id };
                }
              }
              if (data) {
                fetchedIdsRef.current.add(uid);
                return [uid, {
                  ...data,
                  uid: data.uid || uid,
                  createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
                  updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
                } as User] as const;
              }
            } catch {
              // Silently fail per-user
            }
            return null;
          })
        );

        const users: Record<string, User> = {};
        for (const entry of results) {
          if (entry) users[entry[0]] = entry[1];
        }
        setUsersData((prev) => ({ ...prev, ...users }));
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [userIdsKey]);

  return { usersData, loading };
};

