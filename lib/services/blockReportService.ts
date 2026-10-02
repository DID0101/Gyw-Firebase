import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { setPeerBlocked } from '@/lib/services/userBlockService';

/** Block a user (e.g. from a call). Uses users/{uid}/blockedUsers/{peerId} — same as profile block. */
export async function blockUser(myUserId: string, blockUserId: string): Promise<void> {
  await setPeerBlocked(myUserId, blockUserId, true);
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
