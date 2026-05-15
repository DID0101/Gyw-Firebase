import { create } from 'zustand';
import type { UserChatMeta } from '@/lib/types/userChatMeta';

type ById = Record<string, UserChatMeta | undefined>;

function metaEqual(a: UserChatMeta, b: UserChatMeta): boolean {
  return (
    (a.pinnedAt ?? '') === (b.pinnedAt ?? '') &&
    !!a.archived === !!b.archived &&
    !!a.muted === !!b.muted &&
    (a.deletedAt ?? '') === (b.deletedAt ?? '') &&
    (a.mutedUntil ?? '') === (b.mutedUntil ?? '')
  );
}

interface ChatMetaStore {
  byId: ById;
  /** Bumped only when `byId` meaningfully changes — list screen subscribes to this instead of whole `byId` to avoid render storms. */
  listRevision: number;
  /** Full replace from Firestore snapshot (single listener). */
  setAllFromServer: (next: ById) => void;
  /** Optimistic or local patch; merges with existing meta for one chat. */
  patchChatMeta: (chatId: string, partial: Partial<UserChatMeta>) => void;
  /** Restore exact slice before a failed write (undefined = no local meta row). */
  rollbackChatMeta: (chatId: string, previous: UserChatMeta | undefined) => void;
}

export const useChatMetaStore = create<ChatMetaStore>((set) => ({
  byId: {},
  listRevision: 0,
  setAllFromServer: (next) =>
    set((state) => {
      const prev = state.byId;
      const out: ById = {};
      for (const id of Object.keys(next)) {
        const n = next[id]!;
        const p = prev[id];
        out[id] = p && metaEqual(p, n) ? p : n;
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(out);
      if (prevKeys.length === nextKeys.length) {
        let same = true;
        for (const k of nextKeys) {
          if (prev[k] !== out[k]) {
            same = false;
            break;
          }
        }
        if (same) return state;
      }
      return { byId: out, listRevision: state.listRevision + 1 };
    }),
  patchChatMeta: (chatId, partial) =>
    set((state) => {
      const prev = state.byId[chatId] ?? {};
      const merged: UserChatMeta = { ...prev, ...partial };
      if (metaEqual(prev, merged)) return state;
      return {
        byId: {
          ...state.byId,
          [chatId]: merged,
        },
        listRevision: state.listRevision + 1,
      };
    }),
  rollbackChatMeta: (chatId, previous) =>
    set((state) => {
      const next = { ...state.byId };
      if (previous === undefined) {
        delete next[chatId];
      } else {
        next[chatId] = previous;
      }
      return { byId: next, listRevision: state.listRevision + 1 };
    }),
}));
