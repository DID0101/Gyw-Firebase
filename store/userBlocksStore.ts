import { create } from 'zustand';

/** Peers the current user has blocked (doc id = other user's uid). */
interface UserBlocksStore {
  /** revision bumps so list screens can narrow-subscribe */
  revision: number;
  blockedPeerIds: Record<string, true>;
  setBlockedFromServer: (next: Record<string, true>) => void;
  patchPeerBlocked: (peerId: string, blocked: boolean) => void;
  isPeerBlocked: (peerId: string | undefined) => boolean;
}

export const useUserBlocksStore = create<UserBlocksStore>((set, get) => ({
  revision: 0,
  blockedPeerIds: {},
  setBlockedFromServer: (next) =>
    set((s) => {
      if (shallowEqualRecord(s.blockedPeerIds, next)) return s;
      return { blockedPeerIds: next, revision: s.revision + 1 };
    }),
  patchPeerBlocked: (peerId, blocked) =>
    set((s) => {
      const next = { ...s.blockedPeerIds };
      if (blocked) next[peerId] = true;
      else delete next[peerId];
      return { blockedPeerIds: next, revision: s.revision + 1 };
    }),
  isPeerBlocked: (peerId) => !!(peerId && get().blockedPeerIds[peerId]),
}));

function shallowEqualRecord(a: Record<string, true>, b: Record<string, true>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!b[k]) return false;
  }
  return true;
}
