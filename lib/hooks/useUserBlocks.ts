import { db } from '@/lib/firebase';
import {
  FIRESTORE_SNAPSHOT_OPTS,
  hasNativeFirestore,
  subscribeUserBlockedPeersNative,
} from '@/lib/firestoreNative';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Single listener → Zustand for users/{uid}/blockedUsers */
export function useUserBlocks(userId: string | undefined) {
  useEffect(() => {
    if (!userId) {
      useUserBlocksStore.getState().setBlockedFromServer({});
      return;
    }

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      return subscribeUserBlockedPeersNative(
        userId,
        (ids) => useUserBlocksStore.getState().setBlockedFromServer(ids),
        (err) => {
          if (__DEV__) console.error('[useUserBlocks] native snapshot error:', err);
        }
      );
    }

    const col = collection(db, 'users', userId, 'blockedUsers');
    const unsub = onSnapshot(
      col,
      FIRESTORE_SNAPSHOT_OPTS,
      (snap) => {
        const out: Record<string, true> = {};
        snap.forEach((d) => {
          const b = d.data()?.blocked;
          if (b === true) out[d.id] = true;
        });
        useUserBlocksStore.getState().setBlockedFromServer(out);
      },
      (e) => {
        if (__DEV__) console.error('[useUserBlocks] web snapshot error:', e);
      }
    );
    return unsub;
  }, [userId]);
}
