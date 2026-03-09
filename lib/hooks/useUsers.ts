import { Platform } from 'react-native';
import { collection, query, getDocs, orderBy } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { User } from '@/lib/types/chat';
import { hasNativeFirestore, getUsersNative } from '@/lib/firestoreNative';

export const useUsers = (searchTerm?: string) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        let usersData: User[];

        if (Platform.OS !== 'web' && hasNativeFirestore) {
          usersData = (await getUsersNative()) as User[];
        } else {
          const usersRef = collection(db, 'users');
          const q = query(usersRef, orderBy('username', 'asc'));
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

        if (searchTerm) {
          const searchLower = searchTerm.toLowerCase().trim();
          const normalizedPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
          usersData = usersData.filter((user) => {
            const matchUsername = user.username?.toLowerCase().includes(searchLower);
            const matchName = user.firstName?.toLowerCase().includes(searchLower) ||
              user.lastName?.toLowerCase().includes(searchLower) ||
              `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase().includes(searchLower);
            const matchPhone = normalizedPhone && user.phoneNumber &&
              user.phoneNumber.replace(/[\s\-\(\)]/g, '') === normalizedPhone;
            return matchUsername || matchName || matchPhone;
          });
        }
        setUsers(usersData);
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [searchTerm]);

  return { users, loading };
};

