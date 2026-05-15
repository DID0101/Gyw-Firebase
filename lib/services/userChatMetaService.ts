import { db } from '@/lib/firebase';
import { hasNativeFirestore, mergeUserChatMetaNative } from '@/lib/firestoreNative';
import { setUserChatPreferenceMuted } from '@/lib/services/userChatPreferencesService';
import { deleteField, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

async function mergeWeb(userId: string, chatId: string, data: Record<string, unknown>) {
  const ref = doc(db, 'users', userId, 'chatMeta', chatId);
  await setDoc(ref, data as any, { merge: true });
}

async function merge(userId: string, chatId: string, webData: Record<string, unknown>) {
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    // Native FieldValue / serverTimestamp live in RN Firebase, not the web SDK.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- platform branch only
    const firestore = require('@react-native-firebase/firestore');
    const nativeData: Record<string, any> = { ...webData };
    if (nativeData.pinnedAt === '__SERVER_TS__') nativeData.pinnedAt = firestore.serverTimestamp();
    else if (nativeData.pinnedAt === '__DELETE__') nativeData.pinnedAt = firestore.FieldValue.delete();
    if (nativeData.deletedAt === '__SERVER_TS__') nativeData.deletedAt = firestore.serverTimestamp();
    else if (nativeData.deletedAt === '__DELETE__') nativeData.deletedAt = firestore.FieldValue.delete();
    await mergeUserChatMetaNative(userId, chatId, nativeData);
    return;
  }
  const out: Record<string, unknown> = { ...webData };
  if (out.pinnedAt === '__SERVER_TS__') out.pinnedAt = serverTimestamp();
  else if (out.pinnedAt === '__DELETE__') out.pinnedAt = deleteField();
  if (out.deletedAt === '__SERVER_TS__') out.deletedAt = serverTimestamp();
  else if (out.deletedAt === '__DELETE__') out.deletedAt = deleteField();
  await mergeWeb(userId, chatId, out);
}

export async function pinUserChat(userId: string, chatId: string) {
  await merge(userId, chatId, { pinnedAt: '__SERVER_TS__' });
}

export async function unpinUserChat(userId: string, chatId: string) {
  await merge(userId, chatId, { pinnedAt: '__DELETE__' });
}

export async function setUserChatArchived(userId: string, chatId: string, archived: boolean) {
  await merge(userId, chatId, { archived });
}

export async function setUserChatMuted(userId: string, chatId: string, muted: boolean) {
  await merge(userId, chatId, { muted });
  await setUserChatPreferenceMuted(userId, chatId, muted).catch(() => {});
}

/** Hide chat for this user only; does not delete shared chat/messages. */
export async function setUserChatDeletedForMe(userId: string, chatId: string) {
  await merge(userId, chatId, { deletedAt: '__SERVER_TS__', archived: false });
}
