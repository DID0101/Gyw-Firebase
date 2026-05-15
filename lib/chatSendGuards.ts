import { doc, getDoc } from 'firebase/firestore';
import { Platform } from 'react-native';
import { db } from '@/lib/firebase';
import { getChatParticipantsNative, hasNativeFirestore } from '@/lib/firestoreNative';
import { useUserBlocksStore } from '@/store/userBlocksStore';

export class BlockedPeerSendError extends Error {
  constructor() {
    super('You cannot message this contact while they are blocked.');
    this.name = 'BlockedPeerSendError';
  }
}

export type ChatSendGuardOpts = {
  /** When already in memory (e.g. chat screen), skips a Firestore read on every send. */
  participants?: string[];
};

/** Direct chats only: throws BlockedPeerSendError if the other participant is blocked. */
export async function assertChatSendAllowed(
  chatId: string,
  senderId: string,
  opts?: ChatSendGuardOpts
): Promise<void> {
  let participants: string[] | null =
    Array.isArray(opts?.participants) && opts.participants.length > 0 ? opts.participants : null;

  if (!participants) {
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      participants = await getChatParticipantsNative(chatId);
    } else {
      const snap = await getDoc(doc(db, 'chats', chatId));
      if (snap.exists()) {
        const p = snap.data()?.participants;
        participants = Array.isArray(p) ? p : null;
      }
    }
  }
  if (!Array.isArray(participants) || participants.length !== 2) return;
  const other = participants.find((p) => p !== senderId);
  if (other && useUserBlocksStore.getState().isPeerBlocked(other)) {
    throw new BlockedPeerSendError();
  }
}
