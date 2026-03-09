import { arrayUnion, collection, addDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** Block a user (e.g. from Discover). They won't be matched with you again. */
export async function blockUser(myUserId: string, blockUserId: string): Promise<void> {
  const userRef = doc(db, 'users', myUserId);
  await updateDoc(userRef, {
    blockedUsers: arrayUnion(blockUserId),
    updatedAt: new Date().toISOString(),
  });
}

/** Report a user (e.g. from a random call). */
export async function reportUser(
  reporterId: string,
  reportedUserId: string,
  options: { callId?: string; reason?: string } = {}
): Promise<void> {
  const reportsRef = collection(db, 'reports');
  await addDoc(reportsRef, {
    reporterId,
    reportedUserId,
    callId: options.callId ?? null,
    reason: options.reason ?? null,
    createdAt: serverTimestamp(),
  });
}
