import { useAuth } from '@/contexts/AuthContext';
import Feather from '@expo/vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Alert,
    FlatList,
    InteractionManager,
    Modal,
    Platform,
    Pressable,
    Image as RNImage,
    Share,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import AppMenu from '@/components/AppMenu';
import ChatListActionsSheet from '@/components/ChatListActionsSheet';
import ChatsHeaderActions, { type ChatsHeaderHandlers } from '@/components/ChatsHeaderActions';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';
import StoryPickerModal from '@/components/StoryPickerModal';
import { useTheme } from '@/contexts/ThemeContext';
import { markAppStart } from '@/lib/debug/appStartupMarkers';
import { formatChatListTitle, formatLastMessagePreview, safePreviewText } from '@/lib/chatDisplayText';
import {
    getIdlePreloadChatCount,
    getWarmChatLimit,
    shouldPrefetchChatRoute,
} from '@/lib/chatMessageLimits';
import { markChatNavStart, markChatRouterPushReturned, markChatTap } from '@/lib/chatOpenPerf';
import { GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';
import { chatRowTouchLog } from '@/lib/debug/chatRowTouchTrace';
import { searchLoadLog } from '@/lib/debug/searchLoadingTrace';
import { useChats } from '@/lib/hooks/useChats';
import { prefetchRecommendedUsers } from '@/lib/hooks/useContactRecommendedUsers';
import { useProductionScreenTrace } from '@/lib/hooks/useProductionScreenTrace';
import { useUserBlocks } from '@/lib/hooks/useUserBlocks';
import { useUserChatMeta } from '@/lib/hooks/useUserChatMeta';
import { useUsersData } from '@/lib/hooks/useUsersData';
import { isLowTierAndroid } from '@/lib/perf/deviceProfile';
import {
    getArchivedChatsListTuning,
    getChatListItemLayout,
    getChatsTabListTuning,
} from '@/lib/perf/listTuning';
import { scheduleLikelyRouteChunksIdle } from '@/lib/perf/navigationPreload';
import { navigateOnce } from '@/lib/safeAction';
import { warmChat, isActiveMessageListener } from '@/lib/services/chatPreloadService';
import { getOrCreateDirectChat, markAllChatsReadForUser } from '@/lib/services/chatService';
import { trackChatOpened } from '@/lib/services/analyticsService';
import { crashlyticsLog } from '@/lib/services/crashlyticsService';
import { startPerformanceTrace } from '@/lib/services/performanceService';
import {
    pinUserChat,
    setUserChatArchived,
    setUserChatDeletedForMe,
    setUserChatMuted,
    unpinUserChat,
} from '@/lib/services/userChatMetaService';
import { useThemeClassName } from '@/lib/themeUtils';
import { Chat } from '@/lib/types/chat';
import type { UserChatMeta } from '@/lib/types/userChatMeta';
import { TAB_HEADER_ICON_SIZE } from '@/lib/ui/tabHeader';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { useChatStore } from '@/store/chatStore';
import { useContactsStore } from '@/store/contactsStore';
import { usePresenceStore } from '@/store/presenceStore';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import { useUserProfileStore } from '@/store/userProfileStore';

const formatTime = (timestamp?: string) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function compareMainChats(
  a: Chat,
  b: Chat,
  meta: Record<string, UserChatMeta | undefined>
): number {
  const ma = meta[a.id];
  const mb = meta[b.id];
  const pa = ma?.pinnedAt ? Date.parse(ma.pinnedAt) || 0 : 0;
  const pb = mb?.pinnedAt ? Date.parse(mb.pinnedAt) || 0 : 0;
  if (pa !== pb) return pb - pa;
  const ta = new Date(a.lastMessageAt || 0).getTime();
  const tb = new Date(b.lastMessageAt || 0).getTime();
  if (tb !== ta) return tb - ta;
  return a.id.localeCompare(b.id);
}

interface ChatListItemProps {
  item: Chat;
  currentUserId: string;
  onPress: (chatId: string) => void;
  onLongPress?: (chatId: string, displayTitle: string) => void;
}

/** UI-thread long press (RNGH). Kept ≥500ms so slow taps are not mistaken for menu intent. */
const CHAT_ROW_LONG_PRESS_MS = 500;

const ChatListItem = memo(function ChatListItem({
  item,
  currentUserId,
  onPress,
  onLongPress,
}: ChatListItemProps) {
  const longPressActivatedRef = useRef(false);
  const { colorScheme } = useTheme();
  const { t } = useTranslation();
  const chatMeta = useChatMetaStore(useCallback((s) => s.byId[item.id], [item.id]));
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-600', 'text-gray-400');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');
  const bgColor = useThemeClassName('bg-white', 'bg-gray-900');
  const iconMuted = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';

  const otherParticipantId =
    item.type === 'direct' ? item.participants.find(p => p !== currentUserId) : undefined;

  const otherUser = useUserProfileStore(
    useCallback((s) => (otherParticipantId ? s.byId[otherParticipantId] ?? null : null), [otherParticipantId])
  );

  // Each item subscribes to only its own participant's status — avoids whole-list re-renders
  const presenceOnline = usePresenceStore(
    state => (otherParticipantId ? state.onlineUsers?.[otherParticipantId] === true : false)
  );
  const isOnline =
    presenceOnline ||
    (item.type === 'direct' && !!otherUser?.lastActive
      ? Date.now() - new Date(otherUser.lastActive).getTime() < 5 * 60 * 1000
      : false);

  const otherParticipantIdForTitle = item.participants.find((p) => p !== currentUserId);
  const participantDataName = otherParticipantIdForTitle
    ? item.participantData?.[otherParticipantIdForTitle]?.name
    : undefined;
  const participantDataPhone = otherParticipantIdForTitle
    ? (item.participantData?.[otherParticipantIdForTitle] as { phoneNumber?: string } | undefined)
        ?.phoneNumber
    : undefined;

  const contactsRevision = useContactsStore((s) => s.revision);
  const contactsReady = useContactsStore((s) => s.contactsReady);
  const displayName = useMemo(
    () =>
      formatChatListTitle({
        type: item.type,
        name: item.name,
        otherUser,
        participantDataName,
        participantDataPhone,
        participantCount: item.participants?.length ?? 0,
        fallbackUnknown: t('calls.unknown'),
        fallbackGroup: t('chats.groupChat'),
      }),
    [
      item.type,
      item.name,
      item.participants?.length,
      otherUser,
      otherUser?.phoneNumber,
      participantDataName,
      participantDataPhone,
      contactsRevision,
      contactsReady,
      t,
    ]
  );

  const lastMessageText = useMemo(
    () =>
      formatLastMessagePreview(item.lastMessage, currentUserId, {
        noMessagesYet: t('messages.noMessagesYet'),
        you: t('messages.you'),
        youSentMedia: t('messages.youSentMedia'),
        mediaMessage: t('messages.mediaMessage'),
        call: t('messages.call'),
        missedVideoCall: t('calls.missedVideoCall'),
        missedAudioCall: t('calls.missedAudioCall'),
        videoCall: t('calls.videoCall'),
        audioCall: t('calls.audioCall'),
        callRejected: t('messages.callRejected'),
        callDuration: t('messages.callDuration'),
      }),
    [item.lastMessage, currentUserId, t]
  );

  const formattedTime = useMemo(
    () => (item.lastMessageAt ? formatTime(item.lastMessageAt) : ''),
    [item.lastMessageAt]
  );

  const handlePressStart = useCallback(() => {
    longPressActivatedRef.current = false;
    chatRowTouchLog('PRESS_START', item.id);
  }, [item.id]);

  const handlePressEnd = useCallback(() => {
    chatRowTouchLog('PRESS_END', item.id);
  }, [item.id]);

  const handlePress = useCallback(() => {
    chatRowTouchLog('ON_PRESS', item.id);
    if (longPressActivatedRef.current) {
      chatRowTouchLog('LONG_PRESS_SUPPRESSED_TAP', item.id);
      longPressActivatedRef.current = false;
      return;
    }
    chatRowTouchLog('NAVIGATE_CHAT', item.id);
    onPress(item.id);
  }, [onPress, item.id]);

  const handleLongPress = useCallback(() => {
    chatRowTouchLog('ON_LONG_PRESS', item.id);
    longPressActivatedRef.current = true;
    onLongPress?.(item.id, displayName);
  }, [onLongPress, item.id, displayName]);

  const rowGesture = useMemo(() => {
    const longPress = Gesture.LongPress()
      .minDuration(CHAT_ROW_LONG_PRESS_MS)
      .maxDistance(14)
      .onStart(() => {
        runOnJS(handleLongPress)();
      });

    const tap = Gesture.Tap()
      .maxDuration(CHAT_ROW_LONG_PRESS_MS - 80)
      .maxDistance(14)
      .onBegin(() => {
        runOnJS(handlePressStart)();
      })
      .onFinalize(() => {
        runOnJS(handlePressEnd)();
      })
      .onEnd(() => {
        runOnJS(handlePress)();
      });

    return onLongPress ? Gesture.Exclusive(longPress, tap) : tap;
  }, [handlePressStart, handlePressEnd, handlePress, handleLongPress, onLongPress]);

  const avatar = item.type === 'group' ? item.avatar : otherUser?.avatar;
  const unreadCount = item.unreadCount?.[currentUserId] || 0;
  const isUnread = unreadCount > 0;

  const isPinned = !!chatMeta?.pinnedAt;
  const isMuted = !!chatMeta?.muted;

  return (
    <GestureDetector gesture={rowGesture}>
      <View
        className={clsx('flex-row items-center px-4 py-3 border-b', borderColor, isUnread && bgColor)}
      >
      <View className="relative">
        <PreviewAvatar name={displayName} image={avatar} size={56} fontSize={20} imagePriority="low" />
        {isOnline && (
          <View className="absolute bottom-0 right-0 w-4 h-4 bg-[#FF5722] rounded-full border-2 border-white dark:border-gray-900" />
        )}
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between mb-1">
          <View className="flex-row items-center flex-1 min-w-0">
            {isPinned && (
              <Feather name="bookmark" size={14} color={iconMuted} style={{ marginRight: 6 }} />
            )}
            <Text
              className={clsx('text-base flex-1 min-w-0', isUnread ? 'font-bold' : 'font-semibold', textColor)}
              numberOfLines={1}
            >
              {displayName}
            </Text>
          </View>
          <View className="flex-row items-center flex-shrink-0 ml-2">
            {isMuted && (
              <Feather name="bell-off" size={14} color={iconMuted} style={{ marginRight: 6 }} />
            )}
            {formattedTime ? (
              <Text className={clsx('text-xs', textSecondaryColor)}>{formattedTime}</Text>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <Text
            className={clsx(
              'text-sm flex-1 mr-2',
              isUnread ? 'font-semibold text-black dark:text-white' : textSecondaryColor
            )}
            numberOfLines={1}
          >
            {lastMessageText}
          </Text>
          {unreadCount > 0 && (
            <View
              style={{
                backgroundColor: '#FF5722',
                borderRadius: 12,
                paddingHorizontal: unreadCount > 99 ? 6 : unreadCount > 9 ? 5 : 6,
                paddingVertical: 2,
                minWidth: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Text className="text-white text-xs font-bold">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
      </View>
    </GestureDetector>
  );
});

const ChatsScreen = () => {
  const { user } = useAuth();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  useProductionScreenTrace('ChatsTab', { lang: i18n.language });
  const { colorScheme } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const chatsHandlersRef = useRef<ChatsHeaderHandlers>({} as ChatsHeaderHandlers);
  const chatsRef = useRef<Chat[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [sheet, setSheet] = useState<{ id: string; title: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { chats, loading } = useChats(user?.uid || '');
  chatsRef.current = chats;
  const chatListTraceStoppedRef = useRef(false);

  useEffect(() => {
    try {
      markAppStart(9, { uid: user?.uid?.slice(0, 8) ?? null });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('APP_START_9_FAILED', e);
    }
  }, []);

  useEffect(() => {
    chatListTraceStoppedRef.current = false;
    void startPerformanceTrace('chat_list_load');
    return () => {
      if (!chatListTraceStoppedRef.current) {
        void import('@/lib/services/performanceService').then(({ stopPerformanceTrace }) =>
          stopPerformanceTrace('chat_list_load')
        );
      }
    };
  }, []);

  useEffect(() => {
    if (loading || chatListTraceStoppedRef.current) return;
    chatListTraceStoppedRef.current = true;
    void import('@/lib/services/performanceService').then(({ stopPerformanceTrace }) =>
      stopPerformanceTrace('chat_list_load', { chat_count: String(chats.length) })
    );
  }, [loading, chats.length]);
  useUserChatMeta(user?.uid);
  useUserBlocks(user?.uid);
  const blocksRevision = useUserBlocksStore((s) => s.revision);
  const metaListRevision = useChatMetaStore((s) => s.listRevision);
  const patchChatMeta = useChatMetaStore((s) => s.patchChatMeta);
  const rollbackChatMeta = useChatMetaStore((s) => s.rollbackChatMeta);
  const appLogoUri = useMemo(() => {
    try {
      return RNImage.resolveAssetSource(require('../../../assets/images/gyw_fox_logo.png')).uri;
    } catch {
      return undefined;
    }
  }, []);

  // Gyw AI chat is a special direct chat with participant `gyw_ai_system`.
  const gywAiChat = useMemo(() => {
    return (
      chats.find(
        (c) =>
          c.type === 'direct' &&
          Array.isArray(c.participants) &&
          c.participants.includes(GYW_AI_SYSTEM_ID)
      ) ?? null
    );
  }, [chats]);

  const chatsWithoutAi = useMemo(() => {
    if (!gywAiChat) return chats;
    return chats.filter((c) => c.id !== gywAiChat.id);
  }, [chats, gywAiChat]);

  const mainListChats = useMemo(() => {
    const byId = useChatMetaStore.getState().byId;
    const blocked = useUserBlocksStore.getState().blockedPeerIds;
    const uid = user?.uid;
    const filtered = chatsWithoutAi.filter((c) => {
      const m = byId[c.id];
      if (m?.deletedAt) return false;
      if (m?.archived) return false;
      if (c.type === 'direct' && uid) {
        const other = c.participants.find((p) => p !== uid);
        if (other && blocked[other]) return false;
      }
      return true;
    });
    const out = [...filtered];
    out.sort((a, b) => compareMainChats(a, b, byId));
    return out;
  }, [chatsWithoutAi, metaListRevision, blocksRevision, user?.uid]);

  const archivedListChats = useMemo(() => {
    const byId = useChatMetaStore.getState().byId;
    const blocked = useUserBlocksStore.getState().blockedPeerIds;
    const uid = user?.uid;
    const filtered = chatsWithoutAi.filter((c) => {
      const m = byId[c.id];
      if (m?.deletedAt) return false;
      if (!m?.archived) return false;
      if (c.type === 'direct' && uid) {
        const other = c.participants.find((p) => p !== uid);
        if (other && blocked[other]) return false;
      }
      return true;
    });
    const out = [...filtered];
    out.sort((a, b) => {
      const ta = new Date(a.lastMessageAt || 0).getTime();
      const tb = new Date(b.lastMessageAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return a.id.localeCompare(b.id);
    });
    return out;
  }, [chatsWithoutAi, metaListRevision, blocksRevision, user?.uid]);

  const archivedCount = archivedListChats.length;

  const VISIBLE_PARTICIPANT_CAP = 40;

  /** Stable key: visible chat ids + participant set — avoids refetch when typing updates unrelated fields. */
  const participantFetchKey = useMemo(() => {
    const source = showArchived
      ? [...mainListChats, ...archivedListChats]
      : mainListChats;
    const chatIds = source.map((c) => c.id).sort().join(',');
    const uid = user?.uid ?? '';
    const parts: string[] = [];
    for (const chat of source) {
      for (const p of chat.participants) {
        if (p !== uid) parts.push(p);
      }
    }
    parts.sort();
    return `${chatIds}|${parts.join(',')}`;
  }, [mainListChats, archivedListChats, showArchived, user?.uid]);

  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    const source = showArchived
      ? [...mainListChats, ...archivedListChats]
      : mainListChats;
    for (const chat of source) {
      for (const id of chat.participants) {
        if (id !== user?.uid) ids.add(id);
        if (ids.size >= VISIBLE_PARTICIPANT_CAP) break;
      }
      if (ids.size >= VISIBLE_PARTICIPANT_CAP) break;
    }
    return Array.from(ids);
  }, [participantFetchKey, user?.uid]);
  
  // Fetch user profiles into userProfileStore; rows subscribe per participant id.
  useUsersData(participantIds);

  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-600', 'text-gray-400');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');
  const bgColor = useThemeClassName('bg-white', 'bg-gray-900');

  const requestPermissions = async () => {
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (!cameraPermission.granted || !libraryPermission.granted) {
      return false;
    }
    return true;
  };

  const openCamera = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 15,
      });

      if (!result.canceled && result.assets[0]) {
        await AsyncStorage.setItem('pendingMedia', JSON.stringify({
          uri: result.assets[0].uri,
          type: result.assets[0].type,
          width: result.assets[0].width,
          height: result.assets[0].height,
        }));
        setShowPicker(false);
        navigateOnce(router, 'push', {
          pathname: '/(home)/(modal)/new-message',
          params: { media: 'true' },
        });
      }
    } catch (error) {
      // Silently fail - media picker errors are not critical
    }
  };

  const openGallery = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 15,
      });

      if (!result.canceled && result.assets[0]) {
        await AsyncStorage.setItem('pendingMedia', JSON.stringify({
          uri: result.assets[0].uri,
          type: result.assets[0].type,
          width: result.assets[0].width,
          height: result.assets[0].height,
        }));
        setShowPicker(false);
        navigateOnce(router, 'push', {
          pathname: '/(home)/(modal)/new-message',
          params: { media: 'true' },
        });
      }
    } catch (error) {
      // Silently fail - media picker errors are not critical
    }
  };

  const goToChat = useCallback((chatId: string) => {
    markChatTap(chatId);
    markChatNavStart(chatId);
    const chat = useChatStore.getState().chats.find((c) => c.id === chatId);
    const chatType = chat?.type === 'group' ? 'group' : 'private';
    void trackChatOpened(chatId, chatType);
    crashlyticsLog(`chat_opened chatId=${chatId.slice(0, 8)} type=${chatType}`);
    void startPerformanceTrace('chat_room_load');
    const cached = useChatStore.getState().messagesByChat[chatId];
    if (!cached?.length && !isActiveMessageListener(chatId)) {
      void warmChat(chatId, getWarmChatLimit(), { background: false });
    }
    navigateOnce(router, 'push', `/chat/${chatId}`);
    markChatRouterPushReturned(chatId);
    if (shouldPrefetchChatRoute()) {
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(() => router.prefetch(`/chat/${chatId}`));
      });
    }
  }, [router]);

  const idlePreloadKeyRef = useRef('');

  useEffect(() => {
    // Android: getDocs is serialized and slow on low-tier devices; idle preload blocks
    // the queue and causes spurious timeouts. Disk shard + live listener on open is enough.
    if (Platform.OS === 'android') return;

    const topN = getIdlePreloadChatCount(isLowTierAndroid());
    const ids = mainListChats.slice(0, topN).map((c) => c.id).filter(Boolean);
    if (ids.length === 0) return;
    const preloadKey = ids.join(',');
    if (preloadKey === idlePreloadKeyRef.current) return;
    idlePreloadKeyRef.current = preloadKey;

    const delay = isLowTierAndroid() ? 280 : 120;
    const limit = getWarmChatLimit();
    const timer = setTimeout(() => {
      void (async () => {
        for (const id of ids) {
          if (useChatStore.getState().messagesByChat[id]?.length) continue;
          if (isActiveMessageListener(id)) continue;
          await warmChat(id, limit, { background: true });
        }
      })();
    }, delay);
    return () => clearTimeout(timer);
  }, [mainListChats]);

  useFocusEffect(
    useCallback(() => {
      scheduleLikelyRouteChunksIdle();
    }, [])
  );

  const handleGywAiHeaderPressIn = useCallback(() => {
    const id = gywAiChat?.id;
    if (!id) return;
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        void warmChat(id, getWarmChatLimit());
        if (shouldPrefetchChatRoute()) {
          router.prefetch(`/chat/${id}`);
        }
      });
    });
  }, [gywAiChat?.id, router]);

  const openGywAi = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const chatId = gywAiChat?.id ?? (await getOrCreateDirectChat(user.uid, GYW_AI_SYSTEM_ID));
      void warmChat(chatId, getWarmChatLimit());
      markChatTap(chatId);
      markChatNavStart(chatId);
      navigateOnce(router, 'push', `/chat/${chatId}`);
      markChatRouterPushReturned(chatId);
    } catch (e) {
      // Non-fatal: if creation fails, just do nothing
    }
  }, [user?.uid, gywAiChat?.id, router]);

  const chatKeyExtractor = useCallback((item: Chat) => item.id, []);

  const openChatActionsSheet = useCallback((chatId: string, title: string) => {
    setSheet({ id: chatId, title });
  }, []);

  const closeChatActionsSheet = useCallback(() => setSheet(null), []);

  const runSheetAction = useCallback(
    async (action: 'pin' | 'mute' | 'archive' | 'delete') => {
      const uid = user?.uid;
      if (!uid || !sheet) return;
      const id = sheet.id;
      const before = useChatMetaStore.getState().byId[id];

      if (action === 'delete') {
        closeChatActionsSheet();
        Alert.alert(
          t('chats.listActions.deleteTitle'),
          t('chats.listActions.deleteMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                const snap = useChatMetaStore.getState().byId[id];
                patchChatMeta(id, { deletedAt: new Date().toISOString(), archived: false });
                try {
                  await setUserChatDeletedForMe(uid, id);
                } catch {
                  rollbackChatMeta(id, snap);
                  Alert.alert(t('common.error'), t('chats.listActions.deleteFailed'));
                }
              },
            },
          ],
          { cancelable: true }
        );
        return;
      }

      try {
        if (action === 'pin') {
          if (before?.pinnedAt) {
            patchChatMeta(id, { pinnedAt: undefined });
            await unpinUserChat(uid, id);
          } else {
            patchChatMeta(id, { pinnedAt: new Date().toISOString() });
            await pinUserChat(uid, id);
          }
        } else if (action === 'mute') {
          const nextMuted = !before?.muted;
          patchChatMeta(id, { muted: nextMuted });
          await setUserChatMuted(uid, id, nextMuted);
        } else if (action === 'archive') {
          const nextArch = !before?.archived;
          patchChatMeta(id, { archived: nextArch });
          await setUserChatArchived(uid, id, nextArch);
        }
        closeChatActionsSheet();
      } catch {
        rollbackChatMeta(id, before);
        Alert.alert(t('common.error'), t('chats.listActions.actionFailed'));
      }
    },
    [user?.uid, sheet, t, patchChatMeta, rollbackChatMeta, closeChatActionsSheet]
  );

  const sheetMeta = useChatMetaStore(
    useCallback((s) => (sheet ? s.byId[sheet.id] : undefined), [sheet?.id])
  );

  chatsHandlersRef.current = {
    openCamera: () => setShowPicker(true),
    openSearch: () => {
      searchLoadLog('SEARCH_SCREEN_OPEN');
      prefetchRecommendedUsers(user?.uid, user?.phoneNumber ?? undefined);
      navigateOnce(router, 'push', '/(home)/(modal)/find-by-username' as never);
    },
    openNewGroup: () => navigateOnce(router, 'push', '/(home)/(modal)/new-group' as never),
    markAllRead: async () => {
      const uid = user?.uid;
      if (!uid) return;
      try {
        await markAllChatsReadForUser(uid, chatsRef.current);
      } catch {
        Alert.alert(t('common.error'), t('chats.markAllReadFailed'));
      }
    },
    openArchived: () => setShowArchived(true),
    openSettings: () => navigateOnce(router, 'push', '/profile' as never),
    inviteFriends: () => {
      void Share.share({ message: t('chats.inviteShareMessage') }).catch(() => {});
    },
  };

  const gywAiListHeader = useMemo(
    () =>
      user?.uid ? (
        <Pressable
          onPressIn={handleGywAiHeaderPressIn}
          onPress={openGywAi}
          delayPressIn={0}
          unstable_pressDelay={0}
          android_ripple={
            Platform.OS === 'android'
              ? { color: colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)' }
              : undefined
          }
          className={clsx('flex-row items-center px-4 py-3 border-b', borderColor)}
          style={({ pressed }) =>
            Platform.OS === 'android'
              ? undefined
              : {
                  opacity: pressed ? 0.96 : 1,
                  backgroundColor: pressed
                    ? colorScheme === 'dark'
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(0,0,0,0.04)'
                    : undefined,
                }
          }
        >
          <View className="relative">
            <PreviewAvatar name={GYW_AI_DISPLAY_NAME} image={appLogoUri} size={56} fontSize={20} />
          </View>
          <View className="flex-1 ml-3">
            <View className="flex-row items-center justify-between mb-1">
              <Text className={clsx('text-base flex-1 font-semibold', textColor)} numberOfLines={1}>
                {GYW_AI_DISPLAY_NAME}
              </Text>
              {gywAiChat?.lastMessageAt && (
                <Text className={clsx('text-xs ml-2', textSecondaryColor)}>
                  {formatTime(gywAiChat.lastMessageAt)}
                </Text>
              )}
            </View>
            <View className="flex-row items-center justify-between">
              <Text className={clsx('text-sm flex-1 mr-2', textSecondaryColor)} numberOfLines={1}>
                {safePreviewText(gywAiChat?.lastMessage?.text, 120) || 'Ask anything'}
              </Text>
              {(gywAiChat?.unreadCount?.[user.uid] ?? 0) > 0 && (
                <View
                  style={{
                    backgroundColor: '#4f46e5',
                    borderRadius: 12,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                    minWidth: 24,
                    height: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Text className="text-white text-xs font-bold">
                    {(gywAiChat?.unreadCount?.[user.uid] ?? 0) > 99 ? '99+' : (gywAiChat?.unreadCount?.[user.uid] ?? 0)}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      ) : null,
    [
      user?.uid,
      handleGywAiHeaderPressIn,
      openGywAi,
      borderColor,
      colorScheme,
      textColor,
      textSecondaryColor,
      appLogoUri,
      gywAiChat?.lastMessageAt,
      gywAiChat?.lastMessage?.text,
      gywAiChat?.unreadCount,
    ]
  );

  const chatsFlatListHeader = useMemo(
    () => (
      <>
        {gywAiListHeader}
        {user?.uid && archivedCount > 0 ? (
          <Pressable
            onPress={() => setShowArchived(true)}
            delayPressIn={0}
            unstable_pressDelay={0}
            android_ripple={
              Platform.OS === 'android'
                ? { color: colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.09)' }
                : undefined
            }
            className={clsx('flex-row items-center px-4 py-3 border-b', borderColor)}
            style={({ pressed }) =>
              Platform.OS === 'android'
                ? undefined
                : {
                    opacity: pressed ? 0.96 : 1,
                    backgroundColor: pressed
                      ? colorScheme === 'dark'
                        ? 'rgba(255,255,255,0.06)'
                        : 'rgba(0,0,0,0.04)'
                      : undefined,
                  }
            }
          >
            <Feather name="archive" size={TAB_HEADER_ICON_SIZE} color={iconColor} />
            <Text className={clsx('ml-3 text-base font-medium flex-1', textColor)}>
              {t('chats.archivedRow', { count: archivedCount })}
            </Text>
            <Feather name="chevron-right" size={TAB_HEADER_ICON_SIZE} color={iconColor} />
          </Pressable>
        ) : null}
      </>
    ),
    [
      gywAiListHeader,
      user?.uid,
      archivedCount,
      borderColor,
      colorScheme,
      textColor,
      iconColor,
      t,
    ]
  );

  const renderChatItem = useCallback(({ item }: { item: Chat }) => {
    const uid = user?.uid;
    return (
      <ChatListItem
        item={item}
        currentUserId={uid || ''}
        onPress={goToChat}
        onLongPress={openChatActionsSheet}
      />
    );
  }, [user?.uid, goToChat, openChatActionsSheet]);

  if (loading) {
    return <ScreenLoading />;
  }

  return (
    <Screen viewClassName="flex-1 px-2 sm:px-4">
      <View className="flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <AppMenu />
        <ChatsHeaderActions iconColor={iconColor} handlersRef={chatsHandlersRef} />
      </View>
      <View className="flex-1 min-h-0">
        {chats.length === 0 && !user?.uid ? (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-gray-500 dark:text-gray-400 text-center text-lg mb-2">
              {t('chats.noChats')}
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-center">
              {t('chats.startChatHint')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={mainListChats}
            renderItem={renderChatItem}
            keyExtractor={chatKeyExtractor}
            getItemLayout={getChatListItemLayout}
            contentContainerStyle={{ paddingBottom: 10 }}
            removeClippedSubviews={true}
            {...getChatsTabListTuning()}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={chatsFlatListHeader}
          />
        )}
      </View>
      <ChatListActionsSheet
        visible={!!sheet}
        chatTitle={sheet?.title ?? ''}
        isPinned={!!sheetMeta?.pinnedAt}
        isMuted={!!sheetMeta?.muted}
        isArchived={!!sheetMeta?.archived}
        onClose={closeChatActionsSheet}
        onSelect={runSheetAction}
      />
      <Modal visible={showArchived} transparent animationType="fade" onRequestClose={() => setShowArchived(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowArchived(false)} />
          <View className={clsx('rounded-t-2xl flex-1', bgColor)} style={{ maxHeight: '85%' }}>
            <View className={clsx('flex-row items-center justify-between px-4 py-3 border-b', borderColor)}>
              <Text className={clsx('text-lg font-semibold', textColor)}>{t('chats.archivedTitle')}</Text>
              <Pressable onPress={() => setShowArchived(false)} hitSlop={12} accessibilityRole="button">
                <Feather name="x" size={24} color={iconColor} />
              </Pressable>
            </View>
            <FlatList
              data={archivedListChats}
              renderItem={renderChatItem}
              keyExtractor={chatKeyExtractor}
              getItemLayout={getChatListItemLayout}
              keyboardShouldPersistTaps="handled"
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
              removeClippedSubviews={true}
              {...getArchivedChatsListTuning()}
            />
          </View>
        </View>
      </Modal>
      <StoryPickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onCameraPress={openCamera}
        onGalleryPress={openGallery}
      />
    </Screen>
  );
};

export default ChatsScreen;
