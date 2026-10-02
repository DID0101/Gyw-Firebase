import { Platform } from 'react-native';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/firebase';
import { User } from '@/lib/types/chat';
import { hasNativeFirestore, getUsersNative } from '@/lib/firestoreNative';
import { buildDisplayName, textIncludes } from '@/lib/unicodeText';

const USERS_FETCH_LIMIT = 100;

function filterUsersByTerm(users: User[], searchTerm: string): User[] {
  const term = searchTerm.trim();
  if (!term) return users;
  const normalizedPhone = term.replace(/[\s\-\(\)]/g, '');
  return users.filter((user) => {
    const matchUsername = textIncludes(user.username, term);
    const matchName =
      textIncludes(user.firstName, term) ||
      textIncludes(user.lastName, term) ||
      textIncludes(buildDisplayName(user.firstName, user.lastName), term);
    const matchPhone =
      normalizedPhone &&
      user.phoneNumber &&
      user.phoneNumber.replace(/[\s\-\(\)]/g, '') === normalizedPhone;
    return matchUsername || matchName || matchPhone;
  });
}

export const useUsers = (searchTerm?: string) => {
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchUsers = async () => {
      try {
        setLoading(true);
        let usersData: User[];

        if (Platform.OS !== 'web' && hasNativeFirestore) {
          usersData = (await getUsersNative()) as User[];
        } else {
          const usersRef = collection(db, 'users');
          const q = query(usersRef, orderBy('username', 'asc'), limit(USERS_FETCH_LIMIT));
          const snapshot = await getDocs(q);
          usersData = snapshot.docs.map((d) => {
            const data = d.data();
            return {
              uid: d.id,
              ...data,
              createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
              updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            } as User;
          });
        }

        if (!cancelled) setAllUsers(usersData);
      } catch (error) {
        console.error('Error fetching users:', error);
        if (!cancelled) setAllUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchUsers();
    return () => {
      cancelled = true;
    };
  }, []);

  const users = useMemo(
    () => filterUsersByTerm(allUsers, searchTerm ?? ''),
    [allUsers, searchTerm]
  );

  return { users, loading };
};
