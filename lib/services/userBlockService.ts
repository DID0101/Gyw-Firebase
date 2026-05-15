import { db } from '@/lib/firebase';
import { hasNativeFirestore, mergeUserBlockedPeerNative } from '@/lib/firestoreNative';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

async function setBlockedWeb(userId: string, otherUserId: string, blocked: boolean) {
  const ref = doc(db, 'users', userId, 'blockedUsers', otherUserId);
  if (!blocked) {
    await deleteDoc(ref).catch(() => {});
    return;
  }
  await setDoc(
    ref,
    {
      blocked: true,
      createdAt: serverTimestamp(),
    } as any,
    { merge: true }
  );
}

export async function setPeerBlocked(userId: string, otherUserId: string, blocked: boolean): Promise<void> {
  if (!userId || !otherUserId || userId === otherUserId) return;
  if (Platform.OS !== 'web' && hasNativeFirestore) {
    await mergeUserBlockedPeerNative(userId, otherUserId, blocked);
    return;
  }
  await setBlockedWeb(userId, otherUserId, blocked);
}
