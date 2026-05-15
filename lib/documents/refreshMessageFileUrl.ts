import { doc, getDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';
import { getMessageFileUrlNative, hasNativeFirestore } from '@/lib/firestoreNative';

/** Re-read `fileUrl` from Firestore (fresh token / correct native auth on device). */
export async function fetchMessageFileUrl(chatId: string, messageId: string): Promise<string | null> {
  try {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      const nativeUrl = await getMessageFileUrlNative(chatId, messageId);
      if (nativeUrl) return nativeUrl;
    }
    const ref = doc(db, 'chats', chatId, 'messages', messageId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const url = snap.data()?.fileUrl;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}
