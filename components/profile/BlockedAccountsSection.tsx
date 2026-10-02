import clsx from 'clsx';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import Avatar from '@/components/Avatar';
import { useAuth } from '@/contexts/AuthContext';
import { resolveDisplayName } from '@/lib/contacts/contactResolver';
import { useUserBlocks } from '@/lib/hooks/useUserBlocks';
import { getUser } from '@/lib/services/chatService';
import { setPeerBlocked } from '@/lib/services/userBlockService';
import { useThemeClassName } from '@/lib/themeUtils';
import { User } from '@/lib/types/chat';
import { useUserBlocksStore } from '@/store/userBlocksStore';

type BlockedRow = {
  uid: string;
  user: User | null;
};

type Props = {
  /** Legacy blocks stored on users/{uid}.blockedUsers array (Discover / old calls). */
  legacyBlockedIds?: string[];
};

function BlockedAccountsSectionInner({ legacyBlockedIds = [] }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  useUserBlocks(user?.uid);

  const blockedPeerIds = useUserBlocksStore((s) => s.blockedPeerIds);
  const patchPeerBlocked = useUserBlocksStore((s) => s.patchPeerBlocked);

  const allIds = useMemo(() => {
    const set = new Set<string>(Object.keys(blockedPeerIds));
    for (const id of legacyBlockedIds) {
      if (id) set.add(id);
    }
    return Array.from(set);
  }, [blockedPeerIds, legacyBlockedIds]);

  const [rows, setRows] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sectionTitleColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const mutedColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const rowBg = useThemeClassName('bg-gray-50', 'bg-gray-800');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');

  useEffect(() => {
    if (!user?.uid || legacyBlockedIds.length === 0) return;
    for (const peerId of legacyBlockedIds) {
      if (!blockedPeerIds[peerId]) {
        patchPeerBlocked(peerId, true);
        void setPeerBlocked(user.uid, peerId, true).catch(() => {
          patchPeerBlocked(peerId, false);
        });
      }
    }
  }, [user?.uid, legacyBlockedIds, blockedPeerIds, patchPeerBlocked]);

  useEffect(() => {
    let cancelled = false;
    if (allIds.length === 0) {
      setRows([]);
      return;
    }
    setLoading(true);
    void (async () => {
      const loaded = await Promise.all(
        allIds.map(async (uid) => ({ uid, user: await getUser(uid) }))
      );
      if (!cancelled) {
        setRows(loaded);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allIds.join('|')]);

  const onUnblock = useCallback(
    (peerId: string, displayName: string) => {
      if (!user?.uid) return;
      Alert.alert(t('userProfile.unblockTitle'), t('userProfile.unblockConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('userProfile.unblockAction'),
          onPress: () => {
            setBusyId(peerId);
            patchPeerBlocked(peerId, false);
            void setPeerBlocked(user.uid, peerId, false)
              .catch(() => {
                patchPeerBlocked(peerId, true);
                Alert.alert(t('common.error'), t('userProfile.blockActionFailed'));
              })
              .finally(() => setBusyId(null));
          },
        },
      ]);
    },
    [user?.uid, patchPeerBlocked, t]
  );

  return (
    <View className="w-full">
      <View className={clsx('border-t w-full', borderColor)} style={{ borderTopWidth: 0.5 }} />
      <Text
        className={clsx('text-xs font-bold uppercase tracking-wide mt-6 mb-2', mutedColor)}
      >
        {t('profile.blockedAccounts')}
      </Text>
      <Text className={clsx('text-sm mb-3', mutedColor)}>{t('profile.blockedAccountsHint')}</Text>

      {loading && allIds.length > 0 ? (
        <ActivityIndicator className="py-4" />
      ) : null}

      {!loading && allIds.length === 0 ? (
        <Text className={clsx('text-sm py-2', mutedColor)}>{t('profile.blockedAccountsEmpty')}</Text>
      ) : null}

      {rows.map(({ uid, user: peer }) => {
        const title = peer
          ? resolveDisplayName(
              {
                firstName: peer.firstName,
                lastName: peer.lastName,
                username: peer.username,
                phoneNumber: peer.phoneNumber,
                displayName: peer.displayName,
              },
              { fallback: peer.username || uid.slice(0, 8), logContext: 'blocked_list' }
            )
          : uid.slice(0, 8);
        const busy = busyId === uid;
        return (
          <View
            key={uid}
            className={clsx('flex-row items-center rounded-xl px-3 py-2.5 mb-2', rowBg)}
          >
            <Pressable
              className="flex-row items-center flex-1 min-w-0"
              onPress={() => router.push(`/(home)/user-profile?userId=${uid}` as never)}
              accessibilityRole="button"
            >
              <Avatar name={title} imageUrl={peer?.avatar} size={40} />
              <View className="flex-1 min-w-0 ml-3">
                <Text className={clsx('text-base font-medium', sectionTitleColor)} numberOfLines={1}>
                  {title}
                </Text>
                {peer?.username ? (
                  <Text className={clsx('text-sm', mutedColor)} numberOfLines={1}>
                    @{peer.username}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              onPress={() => onUnblock(uid, title)}
              disabled={busy}
              className="px-3 py-2 rounded-lg"
              accessibilityRole="button"
              accessibilityLabel={t('userProfile.unblockContact')}
            >
              {busy ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text className="text-red-500 font-semibold text-sm">
                  {t('userProfile.unblockUser')}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export const BlockedAccountsSection = memo(BlockedAccountsSectionInner);
