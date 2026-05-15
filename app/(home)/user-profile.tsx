import ImageViewer from '@/components/ImageViewer';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getCachedUserProfile, setCachedUserProfile } from '@/lib/cache/userProfileCache';
import { useUserBlocks } from '@/lib/hooks/useUserBlocks';
import { GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';
import { getUser } from '@/lib/services/chatService';
import { setPeerBlocked } from '@/lib/services/userBlockService';
import { setUserChatMuted } from '@/lib/services/userChatMetaService';
import {
  type ChatMediaGalleryCursor,
  type GalleryMediaItem,
  fetchChatMediaGalleryPage,
  verifyViewerInChat,
} from '@/lib/services/userProfileGallery';
import type { User } from '@/lib/types/chat';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import Feather from '@expo/vector-icons/Feather';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const MEDIA_PAGE = 24;

const BLOCK_BTN_MIN_H = 52;
const BLOCK_ICON_WRAP = 44;

/** Primary block / secondary unblock — full width, accessible, theme-aware. */
const ProfileBlockAction = memo(function ProfileBlockAction({
  isDark,
  peerBlocked,
  blockBusy,
  onPress,
  t,
}: {
  isDark: boolean;
  peerBlocked: boolean;
  blockBusy: boolean;
  onPress: () => void;
  t: (k: string) => string;
}) {
  const isBlock = !peerBlocked;
  const bg = isBlock
    ? isDark
      ? '#b91c1c'
      : '#dc2626'
    : isDark
      ? '#450a0a'
      : '#fff1f2';
  const borderW = isBlock ? 0 : StyleSheet.hairlineWidth;
  const borderC = isDark ? '#f87171' : '#fecdd3';
  const titleColor = isBlock ? '#ffffff' : isDark ? '#fecaca' : '#9f1239';
  const subColor = isBlock ? 'rgba(255,255,255,0.88)' : isDark ? '#fca5a5' : '#be123c';
  const iconBg = isBlock ? 'rgba(255,255,255,0.2)' : isDark ? 'rgba(254, 202, 202, 0.12)' : 'rgba(190, 18, 60, 0.08)';
  const iconName = isBlock ? ('user-x' as const) : ('user-check' as const);
  const iconColor = isBlock ? '#ffffff' : isDark ? '#fecaca' : '#b91c1c';

  const accessibilityLabel = isBlock ? t('userProfile.blockContact') : t('userProfile.unblockContact');

  return (
    <View style={{ marginTop: 18, width: '100%' }}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '700',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: isDark ? '#9ca3af' : '#6b7280',
          marginBottom: 8,
        }}
      >
        {t('userProfile.blockSection')}
      </Text>
      <View
        style={[
          { borderRadius: 14, overflow: 'hidden', width: '100%' },
          isBlock &&
            Platform.select({
              ios: {
                shadowColor: '#450a0a',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: isDark ? 0.55 : 0.22,
                shadowRadius: 8,
              },
              android: { elevation: 4 },
            }),
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ busy: blockBusy, disabled: blockBusy }}
          disabled={blockBusy}
          onPressIn={() => {
            if (!blockBusy) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          onPress={onPress}
          android_ripple={{ color: isBlock ? 'rgba(255,255,255,0.2)' : isDark ? 'rgba(254,202,202,0.2)' : 'rgba(190,18,60,0.12)' }}
          style={({ pressed }) => ({
            backgroundColor: bg,
            borderWidth: borderW,
            borderColor: borderC,
            minHeight: BLOCK_BTN_MIN_H,
            opacity: blockBusy ? 0.88 : pressed ? 0.94 : 1,
            paddingVertical: 12,
            paddingHorizontal: 14,
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
            <View
              style={{
                width: BLOCK_ICON_WRAP,
                height: BLOCK_ICON_WRAP,
                borderRadius: BLOCK_ICON_WRAP / 2,
                backgroundColor: iconBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name={iconName} size={22} color={iconColor} />
            </View>
            <View style={{ flex: 1, marginLeft: 14, marginRight: 10, minWidth: 0, justifyContent: 'center' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: titleColor }} numberOfLines={1}>
                {isBlock ? t('userProfile.blockContact') : t('userProfile.unblockContact')}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, marginTop: 3, color: subColor }} numberOfLines={2}>
                {isBlock ? t('userProfile.blockButtonSubtitle') : t('userProfile.unblockButtonSubtitle')}
              </Text>
            </View>
            {blockBusy ? (
              <ActivityIndicator color={isBlock ? '#ffffff' : isDark ? '#fecaca' : '#b91c1c'} />
            ) : (
              <Feather name="chevron-right" size={22} color={isBlock ? 'rgba(255,255,255,0.75)' : isDark ? '#f87171' : '#e11d48'} />
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
});

function useProfileGridLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const horizontalPad = Math.max(insets.left, insets.right, 16);
  const numColumns = useMemo(() => {
    if (width >= 900) return 5;
    if (width >= 600) return 4;
    return 3;
  }, [width]);
  const gap = width < 360 ? 3 : 4;
  const innerWidth = width - horizontalPad * 2;
  const cell = Math.max(56, (innerWidth - gap * (numColumns - 1)) / numColumns);
  const avatarSize = Math.min(120, Math.max(80, Math.round(width * 0.22)));
  return { horizontalPad, numColumns, gap, cell, avatarSize, width };
}

const ProfileHeaderSkeleton = memo(function ProfileHeaderSkeleton({ isDark }: { isDark: boolean }) {
  const { horizontalPad, avatarSize, width } = useProfileGridLayout();
  const bg = isDark ? '#1f2937' : '#e5e7eb';
  return (
    <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: horizontalPad }}>
      <View style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: bg }} />
      <View style={{ width: Math.min(220, width * 0.55), maxWidth: '100%', height: 20, borderRadius: 6, backgroundColor: bg, marginTop: 16 }} />
      <View style={{ width: Math.min(140, width * 0.4), maxWidth: '100%', height: 14, borderRadius: 4, backgroundColor: bg, marginTop: 8 }} />
    </View>
  );
});

const MediaSkeletonGrid = memo(function MediaSkeletonSkeleton({ isDark }: { isDark: boolean }) {
  const { horizontalPad, numColumns, gap, cell } = useProfileGridLayout();
  const bg = isDark ? '#1f2937' : '#e5e7eb';
  const slots = numColumns * 3;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: horizontalPad, gap, alignSelf: 'stretch' }}>
      {Array.from({ length: slots }).map((_, i) => (
        <View key={i} style={{ width: cell, height: cell, borderRadius: 6, backgroundColor: bg }} />
      ))}
    </View>
  );
});

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
      style={{ width: size, height: size, marginBottom: gap, borderRadius: 6, overflow: 'hidden', backgroundColor: isDark ? '#1f2937' : '#e5e7eb' }}
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

const ProfileScrollHeader = memo(function ProfileScrollHeader({
  profile,
  profileReady,
  displayName,
  isDark,
  t,
  chatMuted,
  onMuteToggle,
  canBlock,
  peerBlocked,
  blockBusy,
  onBlockPress,
  mediaReady,
  horizontalPad,
  avatarSize,
}: {
  profile: User | null;
  profileReady: boolean;
  displayName: string;
  isDark: boolean;
  t: (k: string) => string;
  chatMuted: boolean;
  onMuteToggle: () => void;
  canBlock: boolean;
  peerBlocked: boolean;
  blockBusy: boolean;
  onBlockPress: () => void;
  mediaReady: boolean;
  horizontalPad: number;
  avatarSize: number;
}) {
  return (
    <View style={{ paddingBottom: 8, width: '100%' }}>
      {!profile && !profileReady ? (
        <ProfileHeaderSkeleton isDark={isDark} />
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 20, paddingHorizontal: horizontalPad, width: '100%' }}>
          <View
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              overflow: 'hidden',
              backgroundColor: isDark ? '#374151' : '#e5e7eb',
            }}
          >
            {profile?.avatar ? (
              <Image source={{ uri: profile.avatar }} style={{ width: avatarSize, height: avatarSize }} contentFit="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: avatarSize * 0.38, fontWeight: '600', color: isDark ? '#e5e7eb' : '#374151' }}>
                  {(displayName || '?').charAt(0).toUpperCase()}
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
              maxWidth: '100%',
              paddingHorizontal: 8,
            }}
            numberOfLines={2}
          >
            {displayName || '—'}
          </Text>
          {profile?.username ? (
            <Text style={{ marginTop: 6, fontSize: 15, color: isDark ? '#9ca3af' : '#6b7280' }} numberOfLines={1}>
              @{profile.username}
            </Text>
          ) : null}
        </View>
      )}

      <View style={{ paddingHorizontal: horizontalPad, marginTop: 8, width: '100%' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 8 }}>
          {t('userProfile.bio')}
        </Text>
        {!profile && !profileReady ? (
          <View style={{ minHeight: 48, borderRadius: 8, backgroundColor: isDark ? '#1f2937' : '#e5e7eb', width: '100%' }} />
        ) : (
          <Text style={{ fontSize: 15, lineHeight: 22, color: isDark ? '#e5e7eb' : '#374151', flexShrink: 1 }}>
            {profile?.bio?.trim() ? profile.bio.trim() : t('userProfile.noBio')}
          </Text>
        )}
      </View>

      <View style={{ marginTop: 24, paddingHorizontal: horizontalPad, width: '100%' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 12 }}>
          {t('userProfile.actions')}
        </Text>
        <View
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? '#374151' : '#e5e7eb',
            width: '100%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              paddingHorizontal: 14,
              backgroundColor: isDark ? '#1f2937' : '#fff',
            }}
          >
            <View style={{ flex: 1, paddingRight: 12, minWidth: 0 }}>
              <Text style={{ fontSize: 16, color: isDark ? '#f9fafb' : '#111827' }}>{t('userProfile.muteNotifications')}</Text>
              <Text style={{ fontSize: 12, marginTop: 2, color: isDark ? '#9ca3af' : '#6b7280' }}>
                {t('userProfile.muteNotificationsHint')}
              </Text>
            </View>
            <Switch value={chatMuted} onValueChange={onMuteToggle} />
          </View>
        </View>
        {canBlock ? (
          <ProfileBlockAction
            isDark={isDark}
            peerBlocked={peerBlocked}
            blockBusy={blockBusy}
            onPress={onBlockPress}
            t={t}
          />
        ) : null}
      </View>

      <View style={{ marginTop: 28, paddingHorizontal: horizontalPad, marginBottom: 12, width: '100%' }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#9ca3af' : '#6b7280' }}>{t('userProfile.mediaInChat')}</Text>
      </View>
      {!mediaReady ? <MediaSkeletonGrid isDark={isDark} /> : null}
    </View>
  );
});

export default function UserProfileScreen() {
  const raw = useLocalSearchParams<{ userId?: string; chatId?: string; chatType?: string }>();
  const userId = typeof raw.userId === 'string' ? raw.userId : Array.isArray(raw.userId) ? raw.userId[0] : '';
  const chatId = typeof raw.chatId === 'string' ? raw.chatId : Array.isArray(raw.chatId) ? raw.chatId[0] : '';
  const chatType =
    (typeof raw.chatType === 'string' ? raw.chatType : Array.isArray(raw.chatType) ? raw.chatType[0] : '') === 'group'
      ? 'group'
      : 'direct';

  const { user } = useAuth();
  useUserBlocks(user?.uid);
  const router = useRouter();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { horizontalPad, numColumns, gap, cell, avatarSize } = useProfileGridLayout();
  const safeInsets = useSafeAreaInsets();

  const [profile, setProfile] = useState<User | null>(() => (userId ? getCachedUserProfile(userId) : null));
  const [profileReady, setProfileReady] = useState(false);
  const [media, setMedia] = useState<GalleryMediaItem[]>([]);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaLoadingMore, setMediaLoadingMore] = useState(false);
  const [mediaHasMore, setMediaHasMore] = useState(true);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);
  const cursorRef = useRef<import('@/lib/services/userProfileGallery').ChatMediaGalleryCursor>(null);

  const chatMuted = useChatMetaStore(useCallback((s) => (chatId ? !!s.byId[chatId]?.muted : false), [chatId]));
  const peerBlocked = useUserBlocksStore((s) => !!(userId && s.blockedPeerIds[userId]));
  const patchPeerBlocked = useUserBlocksStore((s) => s.patchPeerBlocked);
  const canBlock = !!userId && !!user?.uid && userId !== user.uid && userId !== GYW_AI_SYSTEM_ID;

  const displayName = useMemo(() => {
    if (!profile) return '';
    const n = `${profile.firstName} ${profile.lastName}`.trim();
    return n || profile.username || profile.phoneNumber || '—';
  }, [profile]);

  useLayoutEffect(() => {
    const tint = isDark ? '#f9fafb' : '#111827';
    const headerBg = isDark ? '#111827' : '#f9fafb';
    navigation.setOptions({
      title: displayName || t('userProfile.title'),
      headerTitleStyle: { fontSize: 17, fontWeight: '600', color: tint },
      headerStyle: { backgroundColor: headerBg },
      headerTintColor: tint,
      headerShadowVisible: !isDark,
      headerRight: () => (
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 10 }}
          style={{ marginRight: 2, padding: 6, borderRadius: 8 }}
          android_ripple={{ color: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)', borderless: true }}
          accessibilityRole="button"
          accessibilityLabel={t('userProfile.exit')}
        >
          <Feather name="x" size={24} color={tint} />
        </Pressable>
      ),
    });
  }, [navigation, displayName, t, isDark, router]);

  useEffect(() => {
    if (!userId || !chatId || !user?.uid) return;
    let cancelled = false;
    void (async () => {
      const ok = await verifyViewerInChat(chatId, user.uid);
      if (cancelled) return;
      if (!ok) {
        Alert.alert(t('common.error'), t('userProfile.accessDenied'));
        router.back();
        return;
      }
      const cached = getCachedUserProfile(userId);
      if (cached) setProfile(cached);
      try {
        const u = await getUser(userId);
        if (cancelled) return;
        if (u) {
          setCachedUserProfile(userId, u);
          setProfile(u);
        }
      } finally {
        if (!cancelled) setProfileReady(true);
      }
      const filterSenderId = chatType === 'group' ? userId : null;
      try {
        const { items, nextCursor, mayHaveMoreMessages } = await fetchChatMediaGalleryPage(chatId, {
          filterSenderId,
          pageSize: MEDIA_PAGE,
          cursor: null,
        });
        if (cancelled) return;
        setMedia(items);
        cursorRef.current = nextCursor;
        setMediaHasMore(mayHaveMoreMessages);
      } catch (e) {
        if (__DEV__) console.warn('[UserProfile] media load failed', e);
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
  }, [userId, chatId, user?.uid, chatType, router, t]);

  const loadMoreMedia = useCallback(async () => {
    if (!chatId || !mediaHasMore || mediaLoadingMore || !cursorRef.current) return;
    setMediaLoadingMore(true);
    try {
      const filterSenderId = chatType === 'group' ? userId : null;
      const { items, nextCursor, mayHaveMoreMessages } = await fetchChatMediaGalleryPage(chatId, {
        filterSenderId,
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
    } catch (e) {
      if (__DEV__) console.warn('[UserProfile] load more media failed', e);
      setMediaHasMore(false);
    } finally {
      setMediaLoadingMore(false);
    }
  }, [chatId, chatType, userId, mediaHasMore, mediaLoadingMore]);

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

  const applyBlockRemote = useCallback(
    async (nextBlocked: boolean) => {
      if (!user?.uid || !userId) return;
      setBlockBusy(true);
      patchPeerBlocked(userId, nextBlocked);
      try {
        await setPeerBlocked(user.uid, userId, nextBlocked);
      } catch {
        patchPeerBlocked(userId, !nextBlocked);
        Alert.alert(t('common.error'), t('userProfile.blockActionFailed'));
      } finally {
        setBlockBusy(false);
      }
    },
    [user?.uid, userId, patchPeerBlocked, t]
  );

  const onBlockPress = useCallback(() => {
    if (!canBlock || !user?.uid || !userId) return;
    if (peerBlocked) {
      Alert.alert(t('userProfile.unblockTitle'), t('userProfile.unblockConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('userProfile.unblockAction'), onPress: () => void applyBlockRemote(false) },
      ]);
      return;
    }
    Alert.alert(t('userProfile.blockConfirmTitle'), t('userProfile.blockConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('userProfile.blockUser'),
        style: 'destructive',
        onPress: () => void applyBlockRemote(true),
      },
    ]);
  }, [canBlock, user?.uid, userId, peerBlocked, t, applyBlockRemote]);

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

  const listHeader = useMemo(
    () => (
      <ProfileScrollHeader
        profile={profile}
        profileReady={profileReady}
        displayName={displayName}
        isDark={!!isDark}
        t={t}
        chatMuted={chatMuted}
        onMuteToggle={onMuteToggle}
        canBlock={canBlock}
        peerBlocked={peerBlocked}
        blockBusy={blockBusy}
        onBlockPress={onBlockPress}
        mediaReady={mediaReady}
        horizontalPad={horizontalPad}
        avatarSize={avatarSize}
      />
    ),
    [
      profile,
      profileReady,
      displayName,
      isDark,
      t,
      chatMuted,
      onMuteToggle,
      canBlock,
      peerBlocked,
      blockBusy,
      onBlockPress,
      mediaReady,
      horizontalPad,
      avatarSize,
    ]
  );

  const listContentContainerStyle = useMemo(
    () => ({ flexGrow: 1, paddingBottom: Math.max(32, 16 + safeInsets.bottom) }),
    [safeInsets.bottom]
  );

  const renderItem = useCallback(
    ({ item }: { item: GalleryMediaItem }) => (
      <MediaTile item={item} size={cell} gap={gap} isDark={!!isDark} onOpen={onOpenTile} />
    ),
    [cell, gap, isDark, onOpenTile]
  );

  const listExtraData = useMemo(() => `${numColumns}|${isDark}`, [numColumns, isDark]);

  if (!userId || !chatId) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: horizontalPad }}>
          <Text style={{ textAlign: 'center', color: isDark ? '#9ca3af' : '#6b7280' }}>{t('userProfile.missingParams')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#111827' : '#f9fafb' }} edges={['left', 'right', 'bottom']}>
      <FlatList
        key={`profile-media-${numColumns}`}
        data={mediaReady ? media : []}
        extraData={listExtraData}
        keyExtractor={(it) => it.id}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap, paddingHorizontal: horizontalPad, marginBottom: 0 } : undefined}
        contentContainerStyle={listContentContainerStyle}
        ListHeaderComponent={listHeader}
        renderItem={renderItem}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (mediaReady && mediaHasMore && !mediaLoadingMore) void loadMoreMedia();
        }}
        ListFooterComponent={
          mediaLoadingMore ? (
            <ActivityIndicator style={{ marginTop: 16 }} color={isDark ? '#93c5fd' : '#2563eb'} />
          ) : null
        }
        ListEmptyComponent={
          mediaReady && media.length === 0 ? (
            <Text
              style={{
                textAlign: 'center',
                paddingHorizontal: horizontalPad,
                paddingVertical: 20,
                color: isDark ? '#9ca3af' : '#6b7280',
              }}
            >
              {t('userProfile.noMedia')}
            </Text>
          ) : null
        }
        initialNumToRender={12}
        windowSize={5}
        removeClippedSubviews
      />
      <ImageViewer visible={!!viewerUri} imageUri={viewerUri || ''} onClose={() => setViewerUri(null)} />
    </SafeAreaView>
  );
}
