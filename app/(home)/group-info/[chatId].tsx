import ImageViewer from '@/components/ImageViewer';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import TextField from '@/components/TextField';
import UserCheckbox from '@/components/UserCheckbox';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { hasNativeFirestore, subscribeToChatDocNative } from '@/lib/firestoreNative';
import { useUsers } from '@/lib/hooks/useUsers';
import { removeGroupMemberFromGroup } from '@/lib/services/chatService';
import {
  addGroupMembersOnServer,
  leaveGroupOnServer,
  updateGroupInfoOnServer,
} from '@/lib/services/groupService';
import { setUserChatMuted } from '@/lib/services/userChatMetaService';
import {
  fetchChatMediaGalleryPage,
  verifyViewerInChat,
  type GalleryMediaItem,
  type ChatMediaGalleryCursor,
} from '@/lib/services/userProfileGallery';
import type { Chat } from '@/lib/types/chat';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { useChatStore } from '@/store/chatStore';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigation } from '@react-navigation/native';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const MEDIA_PAGE = 24;

const MediaTile = memo(function MediaTile({
  item,
  size,
  gap,
  isDark,
  onOpen,
}: {
  item: GalleryMediaItem;
  size: number;
  gap: number;
  isDark: boolean;
  onOpen: (item: GalleryMediaItem) => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <Pressable
      onPress={() => onOpen(item)}
      style={{
        width: size,
        height: size,
        marginBottom: gap,
        borderRadius: 6,
        overflow: 'hidden',
        backgroundColor: isDark ? '#1f2937' : '#e5e7eb',
      }}
    >
      {broken ? (
        <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
          <Feather name="image" size={28} color={isDark ? '#6b7280' : '#9ca3af'} />
        </View>
      ) : (
        <Image
          source={{ uri: item.thumbUri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          recyclingKey={item.id}
          onError={() => setBroken(true)}
        />
      )}
      {item.kind === 'video' ? (
        <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
          <View style={{ borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.45)', padding: 8 }}>
            <Feather name="play" size={22} color="#fff" />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
});

const MemberRow = memo(function MemberRow({
  name,
  username,
  avatar,
  isDark,
  showRemove,
  onRemovePress,
  removeMemberA11y,
}: {
  name: string;
  username?: string;
  avatar?: string;
  isDark: boolean;
  showRemove?: boolean;
  onRemovePress?: () => void;
  removeMemberA11y: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: isDark ? '#1f2937' : '#f9fafb',
      }}
    >
      <PreviewAvatar name={name} image={avatar} size={40} fontSize={14} />
      <View style={{ marginLeft: 12, flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#f9fafb' : '#111827' }} numberOfLines={1}>
          {name}
        </Text>
        {username ? (
          <Text style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 2 }} numberOfLines={1}>
            @{username}
          </Text>
        ) : null}
      </View>
      {showRemove && onRemovePress ? (
        <Pressable onPress={onRemovePress} hitSlop={10} accessibilityRole="button" accessibilityLabel={removeMemberA11y}>
          <Feather name="user-minus" size={20} color={isDark ? '#f87171' : '#dc2626'} />
        </Pressable>
      ) : null}
    </View>
  );
});

export default function GroupInfoScreen() {
  const { chatId: rawId } = useLocalSearchParams<{ chatId: string }>();
  const chatId = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';
  const { user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPad = 16;
  const gap = 6;
  const tile = Math.floor((width - horizontalPad * 2 - gap * 3) / 4);

  const [chat, setChat] = useState<Chat | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [selectedAdd, setSelectedAdd] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const [infoSaving, setInfoSaving] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const [media, setMedia] = useState<GalleryMediaItem[]>([]);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [mediaLoadingMore, setMediaLoadingMore] = useState(false);
  const cursorRef = useRef<ChatMediaGalleryCursor>(null);
  /** Avoid overwriting admin edits when the chat doc listener fires frequently. */
  const draftHydratedForChatId = useRef<string | null>(null);

  const { users: allUsers, loading: loadingUsers } = useUsers(addQuery);

  const chatMuted = useChatMetaStore((s) => !!s.byId[chatId]?.muted);

  const isAdmin = useMemo(() => {
    if (!chat || chat.type !== 'group' || !user?.uid) return false;
    if (chat.participantRoles?.[user.uid] === 'admin') return true;
    if (chat.createdBy === user.uid) return true;
    if (!chat.participantRoles && !chat.createdBy && chat.participants?.[0] === user.uid) return true;
    return false;
  }, [chat, user?.uid]);

  const displayName = chat?.name || t('chats.groupChat');

  useLayoutEffect(() => {
    const headerBg = isDark ? '#111827' : '#ffffff';
    const tint = isDark ? '#f9fafb' : '#111827';
    navigation.setOptions({
      title: t('groups.groupInfo'),
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: tint },
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: tint,
      headerShadowVisible: !isDark,
    });
  }, [navigation, t, isDark]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    let unsub: (() => void) | null = null;
    if (Platform.OS !== 'web' && hasNativeFirestore) {
      unsub = subscribeToChatDocNative(
        chatId,
        (data) => {
          if (data) {
            setChat(data as Chat);
            useChatStore.getState().updateChat(chatId, data as Chat);
          }
        },
        () => {}
      );
    } else {
      const ref = doc(db, 'chats', chatId);
      unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const next = {
          id: snap.id,
          ...d,
          lastMessageAt: d.lastMessageAt?.toDate?.()?.toISOString() || d.lastMessageAt,
          createdAt: d.createdAt?.toDate?.()?.toISOString() || d.createdAt,
          updatedAt: d.updatedAt?.toDate?.()?.toISOString() || d.updatedAt,
        } as Chat;
        setChat(next);
        useChatStore.getState().updateChat(chatId, next);
      });
    }
    return () => {
      if (unsub) unsub();
    };
  }, [chatId, user?.uid]);

  useEffect(() => {
    draftHydratedForChatId.current = null;
  }, [chatId]);

  useEffect(() => {
    if (!chat || chat.type !== 'group') return;
    if (draftHydratedForChatId.current === chatId) return;
    draftHydratedForChatId.current = chatId;
    setNameDraft(chat.name || '');
    setDescDraft(chat.description || '');
  }, [chat, chatId]);

  useEffect(() => {
    if (!chat || chat.type === 'group') return;
    Alert.alert(t('common.error'), t('groups.groupInfoNotGroup'));
    router.back();
  }, [chat, router, t]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      const ok = await verifyViewerInChat(chatId, user.uid);
      if (cancelled) return;
      if (!ok) {
        Alert.alert(t('common.error'), t('groups.groupInfoAccessDenied'));
        router.back();
        return;
      }
      try {
        const { items, nextCursor, mayHaveMoreMessages } = await fetchChatMediaGalleryPage(chatId, {
          filterSenderId: null,
          pageSize: MEDIA_PAGE,
          cursor: null,
        });
        if (cancelled) return;
        setMedia(items);
        cursorRef.current = nextCursor;
        setMediaHasMore(mayHaveMoreMessages);
      } catch {
        if (!cancelled) {
          setMedia([]);
          setMediaHasMore(false);
        }
      } finally {
        if (!cancelled) setMediaReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, user?.uid, router, t]);

  const loadMoreMedia = useCallback(async () => {
    if (!chatId || !mediaHasMore || mediaLoadingMore || !cursorRef.current) return;
    setMediaLoadingMore(true);
    try {
      const { items, nextCursor, mayHaveMoreMessages } = await fetchChatMediaGalleryPage(chatId, {
        filterSenderId: null,
        pageSize: MEDIA_PAGE,
        cursor: cursorRef.current,
      });
      if (items.length === 0 && !mayHaveMoreMessages) {
        setMediaHasMore(false);
        return;
      }
      setMedia((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const merged = [...prev];
        for (const it of items) {
          if (!seen.has(it.id)) merged.push(it);
        }
        return merged;
      });
      cursorRef.current = nextCursor;
      setMediaHasMore(!!nextCursor && mayHaveMoreMessages);
    } catch {
      setMediaHasMore(false);
    } finally {
      setMediaLoadingMore(false);
    }
  }, [chatId, mediaHasMore, mediaLoadingMore]);

  const onMuteToggle = useCallback(async () => {
    if (!user?.uid || !chatId) return;
    const before = useChatMetaStore.getState().byId[chatId];
    const next = !before?.muted;
    useChatMetaStore.getState().patchChatMeta(chatId, { muted: next });
    try {
      await setUserChatMuted(user.uid, chatId, next);
    } catch {
      useChatMetaStore.getState().rollbackChatMeta(chatId, before);
      Alert.alert(t('common.error'), t('chats.listActions.actionFailed'));
    }
  }, [user?.uid, chatId, t]);

  const onLeave = useCallback(() => {
    if (!chatId) return;
    Alert.alert(t('groups.leaveConfirmTitle'), t('groups.leaveConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.leaveGroup'),
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveGroupOnServer(chatId);
            router.replace('/(home)/(tabs)/chats' as never);
          } catch {
            Alert.alert(t('common.error'), t('groups.leaveFailed'));
          }
        },
      },
    ]);
  }, [chatId, router, t]);

  const onSaveGroupInfo = useCallback(async () => {
    if (!chatId || !isAdmin) return;
    const nameTrim = nameDraft.trim();
    const descTrim = descDraft.trim();
    const prevName = (chat?.name || '').trim();
    const prevDesc = (chat?.description || '').trim();
    if (nameTrim === prevName && descTrim === prevDesc) return;
    if (!nameTrim) {
      Alert.alert(t('common.error'), t('groups.enterGroupName'));
      return;
    }
    const patch: { name?: string; description?: string } = {};
    if (nameTrim !== prevName) patch.name = nameTrim;
    if (descTrim !== prevDesc) patch.description = descTrim;
    setInfoSaving(true);
    try {
      await updateGroupInfoOnServer(chatId, patch);
    } catch {
      Alert.alert(t('common.error'), t('groups.saveFailed'));
    } finally {
      setInfoSaving(false);
    }
  }, [chatId, isAdmin, nameDraft, descDraft, chat?.name, chat?.description, t]);

  const onRemoveMember = useCallback(
    (targetUid: string) => {
      if (!chatId || !isAdmin || targetUid === user?.uid) return;
      Alert.alert(t('groups.removeMemberConfirmTitle'), t('groups.removeMemberConfirmMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('groups.removeMemberConfirmAction'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGroupMemberFromGroup(chatId, targetUid);
            } catch {
              Alert.alert(t('common.error'), t('groups.removeMemberFailed'));
            }
          },
        },
      ]);
    },
    [chatId, isAdmin, user?.uid, t]
  );

  const addCandidates = useMemo(() => {
    const parts = new Set(chat?.participants || []);
    return allUsers.filter((u) => u.uid !== user?.uid && !parts.has(u.uid));
  }, [allUsers, chat?.participants, user?.uid]);

  const onConfirmAdd = useCallback(async () => {
    if (!chatId || selectedAdd.length === 0) return;
    setAddBusy(true);
    try {
      await addGroupMembersOnServer(chatId, selectedAdd);
      setAddOpen(false);
      setSelectedAdd([]);
      setAddQuery('');
    } catch {
      Alert.alert(t('common.error'), t('groups.addMembersFailed'));
    } finally {
      setAddBusy(false);
    }
  }, [chatId, selectedAdd, t]);

  const memberRows = useMemo(() => {
    if (!chat?.participants) return [];
    const pd = chat.participantData || {};
    return chat.participants.map((uid) => {
      const m = pd[uid];
      return {
        uid,
        name: m?.name?.trim() || uid.slice(0, 8),
        username: m?.username,
        avatar: m?.avatar,
      };
    });
  }, [chat]);

  const onOpenTile = useCallback(
    (item: GalleryMediaItem) => {
      if (item.kind === 'image') {
        setViewerUri(item.fullUri);
        return;
      }
      void Linking.openURL(item.fullUri).catch(() => {
        Alert.alert(t('common.error'), t('userProfile.cannotOpenVideo'));
      });
    },
    [t]
  );

  if (!chatId) return null;

  return (
    <Screen viewClassName="flex-1" edges={['bottom']}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 20),
          paddingHorizontal: horizontalPad,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <View
            style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              overflow: 'hidden',
              backgroundColor: isDark ? '#374151' : '#e5e7eb',
            }}
          >
            {chat?.avatar ? (
              <Image source={{ uri: chat.avatar }} style={{ width: 96, height: 96 }} contentFit="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 36, fontWeight: '700', color: isDark ? '#e5e7eb' : '#374151' }}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={{
              marginTop: 14,
              fontSize: 22,
              fontWeight: '700',
              color: isDark ? '#f9fafb' : '#111827',
              textAlign: 'center',
            }}
            numberOfLines={2}
          >
            {displayName}
          </Text>
          <Text style={{ marginTop: 6, fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280' }}>
            {t('groups.memberCount', { count: chat?.participantCount ?? chat?.participants?.length ?? 0 })}
          </Text>
        </View>

        {isAdmin ? (
          <>
            <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 8 }}>
              {t('groups.groupName')}
            </Text>
            <TextField
              id="groupNameEdit"
              label=""
              placeholder={t('groups.groupName')}
              value={nameDraft}
              onChangeText={setNameDraft}
            />
            <Text
              style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginTop: 16, marginBottom: 8 }}
            >
              {t('groups.description')}
            </Text>
            <TextField
              id="groupDesc"
              label=""
              placeholder={t('groups.descriptionPlaceholder')}
              value={descDraft}
              onChangeText={setDescDraft}
              multiline
            />
            <Pressable
              onPress={onSaveGroupInfo}
              disabled={infoSaving}
              style={{
                marginTop: 10,
                alignSelf: 'flex-start',
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: '#FF5722',
                opacity: infoSaving ? 0.7 : 1,
              }}
            >
              {infoSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '600' }}>{t('groups.saveGroupInfo')}</Text>
              )}
            </Pressable>
          </>
        ) : (
          <Text style={{ fontSize: 15, lineHeight: 22, color: isDark ? '#e5e7eb' : '#374151' }}>
            {chat?.description?.trim() ? chat.description.trim() : t('groups.noDescription')}
          </Text>
        )}

        <View style={{ marginTop: 24 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 10 }}>
            {t('groups.notifications')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? '#374151' : '#e5e7eb',
              backgroundColor: isDark ? '#1f2937' : '#fff',
            }}
          >
            <Text style={{ fontSize: 16, color: isDark ? '#f9fafb' : '#111827', flex: 1 }}>{t('userProfile.muteNotifications')}</Text>
            <Switch value={chatMuted} onValueChange={() => void onMuteToggle()} />
          </View>
        </View>

        {isAdmin ? (
          <Pressable
            onPress={() => {
              setAddOpen(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={{
              marginTop: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 12,
            }}
          >
            <Feather name="user-plus" size={20} color="#FF5722" />
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#FF5722' }}>{t('groups.addMembers')}</Text>
          </Pressable>
        ) : null}

        <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginTop: 20, marginBottom: 10 }}>
          {t('groups.membersList')}
        </Text>
        <View style={{ gap: 8 }}>
          {memberRows.map((item) => (
            <MemberRow
              key={item.uid}
              name={item.name}
              username={item.username}
              avatar={item.avatar}
              isDark={!!isDark}
              showRemove={isAdmin && item.uid !== user?.uid}
              onRemovePress={() => onRemoveMember(item.uid)}
              removeMemberA11y={t('a11y.removeMember')}
            />
          ))}
        </View>

        <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginTop: 24, marginBottom: 10 }}>
          {t('groups.sharedMedia')}
        </Text>
        {!mediaReady ? (
          <ActivityIndicator />
        ) : media.length === 0 ? (
          <Text style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>{t('groups.noSharedMedia')}</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
            {media.map((item) => (
              <View key={item.id} style={{ width: '25%', paddingHorizontal: gap / 2 }}>
                <MediaTile item={item} size={tile} gap={gap} isDark={!!isDark} onOpen={onOpenTile} />
              </View>
            ))}
          </View>
        )}
        {mediaHasMore && mediaReady ? (
          <Pressable onPress={loadMoreMedia} disabled={mediaLoadingMore} style={{ marginTop: 12, alignItems: 'center' }}>
            {mediaLoadingMore ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: '#FF5722', fontWeight: '600' }}>{t('groups.loadMoreMedia')}</Text>
            )}
          </Pressable>
        ) : null}

        <Pressable
          onPress={onLeave}
          style={{
            marginTop: 28,
            paddingVertical: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDark ? '#7f1d1d' : '#fecaca',
            backgroundColor: isDark ? '#450a0a' : '#fef2f2',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: isDark ? '#fecaca' : '#b91c1c' }}>{t('groups.leaveGroup')}</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={addOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddOpen(false)}>
        <SafeAreaView style={{ flex: 1, paddingTop: 8 }} edges={['top', 'left', 'right']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
            <Pressable onPress={() => setAddOpen(false)}>
              <Text style={{ fontSize: 16, color: '#6b7280' }}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>{t('groups.addMembers')}</Text>
            <Pressable onPress={onConfirmAdd} disabled={addBusy || selectedAdd.length === 0}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: selectedAdd.length ? '#FF5722' : '#9ca3af' }}>{t('common.save')}</Text>
            </Pressable>
          </View>
          <TextField id="addSearch" label="" placeholder={t('groups.addMembersPlaceholder')} value={addQuery} onChangeText={setAddQuery} />
          {loadingUsers ? (
            <ActivityIndicator style={{ marginTop: 16 }} />
          ) : (
            <FlatList
              data={addCandidates}
              keyExtractor={(u) => u.uid}
              contentContainerStyle={{ padding: 16, gap: 8 }}
              renderItem={({ item }) => (
                <UserCheckbox
                  user={{
                    id: item.uid,
                    name: `${item.firstName} ${item.lastName}`,
                    username: item.username,
                    image: item.avatar,
                  } as any}
                  checked={selectedAdd.includes(item.uid)}
                  onValueChange={(v) => {
                    setSelectedAdd((prev) => (v ? [...prev, item.uid] : prev.filter((id) => id !== item.uid)));
                  }}
                />
              )}
            />
          )}
          {addBusy ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}
        </SafeAreaView>
      </Modal>

      <ImageViewer visible={!!viewerUri} imageUri={viewerUri || ''} onClose={() => setViewerUri(null)} />
    </Screen>
  );
}
