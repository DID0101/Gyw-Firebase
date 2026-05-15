import { Platform } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { hasNativeFirestore } from '@/lib/firestoreNative';
import { getRnFirestore } from '@/lib/rnFirebase';

function snapshotExists(snap: { exists?: boolean | (() => boolean) }): boolean {
  const e = snap.exists;
  return typeof e === 'function' ? e() : !!e;
}

/**
 * Single-doc listener for fullscreen map only — not used from chat list rows.
 */
export function subscribeLiveLocationSession(
  chatId: string,
  messageId: string,
  onCoords: (latitude: number, longitude: number) => void,
  onError?: (e: unknown) => void
): () => void {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    const rnDb = getRnFirestore();
    if (!rnDb) {
      return () => {};
    }
    try {
      const { doc, onSnapshot } = require('@react-native-firebase/firestore') as typeof import('@react-native-firebase/firestore');
      const ref = doc(rnDb, 'chats', chatId, 'liveLocationUpdates', messageId);
      const unsub = onSnapshot(
        ref,
        (snap: { exists?: boolean | (() => boolean); data: () => Record<string, unknown> | undefined }) => {
          if (!snapshotExists(snap)) return;
          const d = snap.data() ?? {};
          const lat = d.latitude;
          const lng = d.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            onCoords(lat, lng);
          }
        },
        (err: unknown) => onError?.(err)
      );
      return unsub;
    } catch (e) {
      onError?.(e);
      return () => {};
    }
  }

  const ref = doc(db, 'chats', chatId, 'liveLocationUpdates', messageId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (typeof d.latitude === 'number' && typeof d.longitude === 'number') {
        onCoords(d.latitude, d.longitude);
      }
    },
    (err) => onError?.(err)
  );
}
