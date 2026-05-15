import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import type { Chat } from '@/lib/types/chat';
import { useTheme } from '@/contexts/ThemeContext';
import PreviewAvatar from '@/components/PreviewAvatar';

export type GroupMemberRow = {
  uid: string;
  name: string;
  username?: string;
  avatar?: string;
  isSelf: boolean;
};

type GroupMembersSheetProps = {
  visible: boolean;
  chat: Chat | null;
  currentUserId: string;
  isAdmin: boolean;
  onClose: () => void;
  onRemoveMember: (targetUid: string) => void;
  onViewProfile: (row: GroupMemberRow) => void;
  labels: {
    title: string;
    viewProfile: string;
    removeFromGroup: string;
    cancel: string;
    removeConfirmTitle: string;
    removeConfirmMessage: string;
    removeConfirmAction: string;
    youBadge: string;
  };
};

function buildRows(chat: Chat | null, currentUserId: string): GroupMemberRow[] {
  if (!chat || chat.type !== 'group' || !Array.isArray(chat.participants)) return [];
  const pd = chat.participantData ?? {};
  return chat.participants.map((uid) => {
    const meta = pd[uid];
    return {
      uid,
      name: meta?.name?.trim() || uid.slice(0, 8),
      username: meta?.username,
      avatar: meta?.avatar,
      isSelf: uid === currentUserId,
    };
  });
}

const MemberRow = memo(function MemberRow({
  row,
  isAdmin,
  isTargetAdmin,
  onLongPress,
  textColor,
  metaColor,
  surfaceStyle,
  youBadge,
}: {
  row: GroupMemberRow;
  isAdmin: boolean;
  isTargetAdmin: boolean;
  onLongPress: (row: GroupMemberRow) => void;
  textColor: string;
  metaColor: string;
  surfaceStyle: object;
  youBadge: string;
}) {
  const canManage = isAdmin && !row.isSelf && !isTargetAdmin;
  return (
    <Pressable
      onLongPress={() => {
        if (!canManage) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(row);
      }}
      delayLongPress={420}
      style={({ pressed }) => [
        styles.row,
        surfaceStyle,
        pressed && canManage ? { opacity: 0.88 } : null,
      ]}
    >
      <PreviewAvatar name={row.name} image={row.avatar} size={40} fontSize={14} />
      <View style={styles.rowText}>
        <Text style={[{ fontSize: 16, fontWeight: '600' }, { color: textColor }]} numberOfLines={1}>
          {row.name}
          {row.isSelf ? ` ${youBadge}` : ''}
        </Text>
        {row.username ? (
          <Text style={[{ fontSize: 13, marginTop: 2 }, { color: metaColor }]} numberOfLines={1}>
            @{row.username}
          </Text>
        ) : null}
      </View>
      {canManage ? (
        <Feather name="more-vertical" size={18} color={metaColor} style={{ opacity: 0.6 }} />
      ) : null}
    </Pressable>
  );
});

export const GroupMembersSheet = memo(function GroupMembersSheet({
  visible,
  chat,
  currentUserId,
  isAdmin,
  onClose,
  onRemoveMember,
  onViewProfile,
  labels,
}: GroupMembersSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isDark, colorScheme } = useTheme();
  const textColor = isDark ? '#f9fafb' : '#111827';
  const metaColor = isDark ? '#9ca3af' : '#6b7280';
  const bg = isDark ? '#111827' : '#ffffff';
  const border = isDark ? '#374151' : '#e5e7eb';
  const rowSurface = useMemo(
    () => ({ backgroundColor: isDark ? '#1f2937' : '#f9fafb', borderRadius: 12 }),
    [isDark]
  );

  const rows = useMemo(() => buildRows(chat, currentUserId), [chat, currentUserId]);

  const adminIds = useMemo(() => {
    const roles = chat?.participantRoles;
    const set = new Set<string>();
    if (roles) {
      for (const [uid, r] of Object.entries(roles)) {
        if (r === 'admin') set.add(uid);
      }
    }
    if (chat?.createdBy) set.add(chat.createdBy);
    if (!roles && !chat?.createdBy && chat?.participants?.length) {
      set.add(chat.participants[0]!);
    }
    return set;
  }, [chat?.participantRoles, chat?.createdBy, chat?.participants]);

  const onRowLongPress = useCallback(
    (row: GroupMemberRow) => {
      if (!isAdmin || row.isSelf) return;
      const isTargetAdmin = adminIds.has(row.uid);
      if (isTargetAdmin) {
        return;
      }
      Alert.alert(row.name, undefined, [
        {
          text: labels.viewProfile,
          onPress: () => {
            onViewProfile(row);
            onClose();
          },
        },
        {
          text: labels.removeFromGroup,
          style: 'destructive',
          onPress: () => {
            Alert.alert(labels.removeConfirmTitle, labels.removeConfirmMessage, [
              { text: labels.cancel, style: 'cancel' },
              {
                text: labels.removeConfirmAction,
                style: 'destructive',
                onPress: () => onRemoveMember(row.uid),
              },
            ]);
          },
        },
        { text: labels.cancel, style: 'cancel' },
      ]);
    },
    [isAdmin, adminIds, labels, onClose, onRemoveMember, onViewProfile]
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('a11y.dismissSheet')} />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: bg,
              borderColor: border,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: border }]}>
            <Text style={[{ fontSize: 17, fontWeight: '700' }, { color: textColor }]}>{labels.title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={labels.cancel}>
              <Feather name="x" size={22} color={colorScheme === 'dark' ? '#fff' : '#000'} />
            </Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(item) => item.uid}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={5}
            contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 12, gap: 8 }}
            renderItem={({ item }) => (
              <MemberRow
                row={item}
                isAdmin={isAdmin}
                isTargetAdmin={adminIds.has(item.uid)}
                onLongPress={onRowLongPress}
                textColor={textColor}
                metaColor={metaColor}
                surfaceStyle={rowSurface}
                youBadge={labels.youBadge}
              />
            )}
          />
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    columnGap: 12,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
});

export default GroupMembersSheet;
