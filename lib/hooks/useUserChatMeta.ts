import { db } from '@/lib/firebase';
import {
  hasNativeFirestore,
  subscribeUserChatMetaNative,
  subscribeUserChatPreferencesNative,
} from '@/lib/firestoreNative';
import type { UserChatMeta } from '@/lib/types/userChatMeta';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

type MetaById = Record<string, UserChatMeta | undefined>;

function docDataToMeta(data: Record<string, unknown> | undefined): UserChatMeta {
  if (!data) return {};
  const pinnedAt = data.pinnedAt as { toDate?: () => Date } | string | null | undefined;
  const deletedAt = data.deletedAt as { toDate?: () => Date } | string | null | undefined;
  const mutedUntil = data.mutedUntil as { toDate?: () => Date } | string | null | undefined;
  return {
    pinnedAt:
      pinnedAt && typeof pinnedAt === 'object' && 'toDate' in pinnedAt && pinnedAt.toDate
        ? pinnedAt.toDate()!.toISOString()
        : (pinnedAt as string | null | undefined) ?? undefined,
    archived: !!data.archived,
    muted: !!data.muted,
    mutedUntil:
      mutedUntil && typeof mutedUntil === 'object' && 'toDate' in mutedUntil && mutedUntil.toDate
        ? mutedUntil.toDate()!.toISOString()
        : (mutedUntil as string | null | undefined) ?? undefined,
    deletedAt:
      deletedAt && typeof deletedAt === 'object' && 'toDate' in deletedAt && deletedAt.toDate
        ? deletedAt.toDate()!.toISOString()
        : (deletedAt as string | null | undefined) ?? undefined,
  };
}

function mergeMetaWithPrefs(metaById: MetaById, prefMuted: Record<string, boolean>): MetaById {
  const out: MetaById = { ...metaById };
  const chatIds = new Set([...Object.keys(metaById), ...Object.keys(prefMuted)]);
  for (const id of chatIds) {
    const m = metaById[id] ?? {};
    const pref = prefMuted[id] === true;
    out[id] = {
      ...m,
      muted: !!(m.muted || pref),
    };
  }
  return out;
}

/** chatMeta + chatPreferences listeners → merged `muted` in Zustand (push skips if chatPreferences muted only). */
export function useUserChatMeta(userId: string | undefined) {
  const setAllFromServer = useChatMetaStore((s) => s.setAllFromServer);
  const metaRef = useRef<MetaById>({});
  const prefMutedRef = useRef<Record<string, boolean>>({});

  const publish = () => {
    setAllFromServer(mergeMetaWithPrefs(metaRef.current, prefMutedRef.current));
  };

  useEffect(() => {
    if (!userId) {
      metaRef.current = {};
      prefMutedRef.current = {};
      setAllFromServer({});
      return;
    }

    let unsubMeta: (() => void) | undefined;
    let unsubPref: (() => void) | undefined;

    if (Platform.OS !== 'web' && hasNativeFirestore) {
      unsubMeta = subscribeUserChatMetaNative(
        userId,
        (byId) => {
          metaRef.current = byId as MetaById;
          publish();
        },
        (err) => {
          if (__DEV__) console.error('[useUserChatMeta] native meta error:', err);
        }
      );
      unsubPref = subscribeUserChatPreferencesNative(
        userId,
        (mutedByChatId) => {
          prefMutedRef.current = mutedByChatId;
          publish();
        },
        (err) => {
          if (__DEV__) console.error('[useUserChatMeta] native preferences error:', err);
        }
      );
    } else {
      const metaCol = collection(db, 'users', userId, 'chatMeta');
      unsubMeta = onSnapshot(
        metaCol,
        (snap) => {
          const byId: MetaById = {};
          snap.forEach((d) => {
            byId[d.id] = docDataToMeta(d.data() as Record<string, unknown>);
          });
          metaRef.current = byId;
          publish();
        },
        (e) => {
          if (__DEV__) console.error('[useUserChatMeta] web meta error:', e);
        }
      );
      const prefCol = collection(db, 'users', userId, 'chatPreferences');
      unsubPref = onSnapshot(
        prefCol,
        (snap) => {
          const muted: Record<string, boolean> = {};
          snap.forEach((d) => {
            if ((d.data() as { muted?: boolean })?.muted === true) muted[d.id] = true;
          });
          prefMutedRef.current = muted;
          publish();
        },
        (e) => {
          if (__DEV__) console.error('[useUserChatMeta] web preferences error:', e);
        }
      );
    }

    return () => {
      unsubMeta?.();
      unsubPref?.();
    };
  }, [userId, setAllFromServer]);
}
