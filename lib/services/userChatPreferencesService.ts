import { db } from '@/lib/firebase';
import { hasNativeFirestore, mergeUserChatPreferencesNative } from '@/lib/firestoreNative';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

async function mergeWeb(userId: string, chatId: string, data: Record<string, unknown>) {
  const ref = doc(db, 'users', userId, 'chatPreferences', chatId);
  await setDoc(ref, data as any, { merge: true });
}

async function merge(userId: string, chatId: string, webData: Record<string, unknown>) {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await mergeUserChatPreferencesNative(userId, chatId, webData as Record<string, any>);
    return;
  }
  await mergeWeb(userId, chatId, webData);
}

/** Per-chat notification preference at users/{uid}/chatPreferences/{chatId} */
export async function setUserChatPreferenceMuted(userId: string, chatId: string, muted: boolean) {
  await merge(userId, chatId, {
    muted,
    updatedAt: serverTimestamp(),
  });
}
