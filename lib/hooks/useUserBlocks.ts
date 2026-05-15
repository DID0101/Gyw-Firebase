import { db } from '@/lib/firebase';
import { hasNativeFirestore, subscribeUserBlockedPeersNative } from '@/lib/firestoreNative';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Single listener → Zustand for users/{uid}/blockedUsers */
export function useUserBlocks(userId: string | undefined) {
  const setBlockedFromServer = useUserBlocksStore((s) => s.setBlockedFromServer);

  useEffect(() => {
    if (!userId) {
      setBlockedFromServer({});
      return;
    }

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return subscribeUserBlockedPeersNative(
        userId,
        (ids) => setBlockedFromServer(ids),
        (err) => {
          if (__DEV__) console.error('[useUserBlocks] native snapshot error:', err);
        }
      );
    }

    const col = collection(db, 'users', userId, 'blockedUsers');
    const unsub = onSnapshot(
      col,
      (snap) => {
        const out: Record<string, true> = {};
        snap.forEach((d) => {
          const b = d.data()?.blocked;
          if (b === true) out[d.id] = true;
        });
        setBlockedFromServer(out);
      },
      (e) => {
        if (__DEV__) console.error('[useUserBlocks] web snapshot error:', e);
      }
    );
    return unsub;
  }, [userId, setBlockedFromServer]);
}
