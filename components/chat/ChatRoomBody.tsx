import { bumpChatPerfRender } from '@/lib/chatOpenPerf';
import { getChatRoomListTuning } from '@/lib/perf/listTuning';
import { useNetworkState } from '@/lib/networkState';
import Feather from '@expo/vector-icons/Feather';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import Reanimated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ChatMessage } from '@/lib/types/chat';

const ICON_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 } as const;

/** Stable empty header — swapping null ↔ component on inverted lists can crash Reanimated on Android. */
const LIST_HEADER_EMPTY = <View style={{ height: 0 }} />;

/** Visual gap between newest bubble and composer (inverted list = paddingTop). */
const NEWEST_MESSAGE_PAD = 12;

const ChatRoomTypingIncoming = memo(function ChatRoomTypingIncoming({
  maxBubbleWidth,
  dotSurfaceStyle,
}: {
  maxBubbleWidth: number;
  dotSurfaceStyle?: object;
}) {
  const d0 = useSharedValue(0.3);
  const d1 = useSharedValue(0.3);
  const d2 = useSharedValue(0.3);
  useEffect(() => {
    const pulse = (v: SharedValue<number>, delayMs: number) => {
      v.value = withDelay(
        delayMs,
        withRepeat(
          withSequence(withTiming(0.8, { duration: 220 }), withTiming(0.3, { duration: 220 })),
          -1,
          false
        )
      );
    };
    pulse(d0, 0);
    pulse(d1, 120);
    pulse(d2, 240);
    return () => {
      cancelAnimation(d0);
      cancelAnimation(d1);
      cancelAnimation(d2);
    };
  }, [d0, d1, d2]);
  const s0 = useAnimatedStyle(() => ({ opacity: d0.value }));
  const s1 = useAnimatedStyle(() => ({ opacity: d1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: d2.value }));
  const dot = { width: 5, height: 5, borderRadius: 2.5 };
  return (
    <View style={{ alignSelf: 'flex-start', maxWidth: maxBubbleWidth, paddingVertical: 10, paddingHorizontal: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 4, columnGap: 4 }}>
        <Reanimated.View style={[dot, dotSurfaceStyle, s0]} />
        <Reanimated.View style={[dot, dotSurfaceStyle, s1]} />
        <Reanimated.View style={[dot, dotSurfaceStyle, s2]} />
      </View>
    </View>
  );
});

const ChatRoomScrollFab = memo(function ChatRoomScrollFab({
  visible,
  bottomOffset,
  rightOffset,
  onPress,
  fabSurfaceStyle,
  iconColor,
  badgeCount,
  badgeLabelStyle,
}: {
  visible: boolean;
  bottomOffset: number;
  rightOffset: number;
  onPress: () => void;
  fabSurfaceStyle?: object;
  iconColor?: string;
  badgeCount: number;
  badgeLabelStyle?: object;
}) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: rightOffset,
        bottom: bottomOffset,
        zIndex: 30,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          badgeCount > 0 ? t('messages.newMessagesBadgeA11y', { count: badgeCount }) : t('messages.a11yScrollToBottom')
        }
        hitSlop={ICON_HIT_SLOP}
        style={({ pressed }) => [
          {
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          },
          fabSurfaceStyle,
        ]}
      >
        <Feather name="chevron-down" size={24} color={iconColor} />
        {badgeCount > 0 ? (
          <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[{ fontSize: 10, fontWeight: '700' }, badgeLabelStyle]}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
});

const ChatRoomBodyContextSheet = memo(function ChatRoomBodyContextSheet({
  visible,
  onClose,
  rowLabelStyle,
  iconColor,
  dividerLineStyle,
  sheetSurfaceStyle,
  insetBottom,
  onReply,
  onCopy,
  onForward,
  onDelete,
  onInfo,
}: {
  visible: boolean;
  onClose: () => void;
  rowLabelStyle: object;
  iconColor?: string;
  dividerLineStyle: object;
  sheetSurfaceStyle?: object;
  insetBottom: number;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onDelete: () => void;
  onInfo: () => void;
}) {
  const { t } = useTranslation();
  const rows: { key: string; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }[] = [
    { key: 'reply', label: t('messages.contextMenuReply'), icon: 'corner-up-left', onPress: onReply },
    { key: 'copy', label: t('common.copy'), icon: 'copy', onPress: onCopy },
    { key: 'forward', label: t('messages.contextMenuForward'), icon: 'share', onPress: onForward },
    { key: 'delete', label: t('common.delete'), icon: 'trash-2', onPress: onDelete },
    { key: 'info', label: t('messages.contextMenuInfo'), icon: 'info', onPress: onInfo },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('a11y.dismissMessageMenu')} />
        <View style={[{ paddingBottom: insetBottom, height: 220 }, sheetSurfaceStyle]}>
          {rows.map((row, i) => (
            <View key={row.key}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  row.onPress();
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                style={{
                  height: 44,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  columnGap: 12,
                }}
              >
                <Feather name={row.icon} size={20} color={iconColor} />
                <Text style={[{ flex: 1, fontSize: 15 }, rowLabelStyle]}>{row.label}</Text>
              </Pressable>
              {i < rows.length - 1 ? (
                <View style={[{ height: StyleSheet.hairlineWidth, marginLeft: 16 }, dividerLineStyle]} />
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
});

const ChatRoomBodyReactionTray = memo(function ChatRoomBodyReactionTray({
  visible,
  bottomOffset,
  emojis,
  onSelect,
  onDismiss,
  traySurfaceStyle,
}: {
  visible: boolean;
  bottomOffset: number;
  emojis: string[];
  onSelect: (emoji: string) => void;
  onDismiss: () => void;
  traySurfaceStyle?: object;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(onDismiss, 1500);
    return () => clearTimeout(timer);
  }, [visible, onDismiss]);
  if (!visible) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: bottomOffset,
        alignItems: 'center',
        zIndex: 40,
      }}
    >
      <View style={[{ flexDirection: 'row', height: 48, alignItems: 'center', columnGap: 8, paddingHorizontal: 12, borderRadius: 24 }, traySurfaceStyle]}>
        {emojis.map((e) => (
          <Pressable
            key={e}
            hitSlop={ICON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t('messages.reactWithEmoji', { emoji: e })}
            onPress={() => onSelect(e)}
            style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 24 }}>{e}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

/** Lightweight shell so ChatRoom never shows a blank center while Firestore hydrates. */
const ChatMessageListSkeleton = memo(function ChatMessageListSkeleton({
  rowStyle,
  count = 8,
}: {
  rowStyle: object;
  count?: number;
}) {
  const rows = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  return (
    <View style={{ flex: 1, paddingHorizontal: 12, paddingTop: 12 }} pointerEvents="none">
      {rows.map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            justifyContent: i % 2 === 0 ? 'flex-end' : 'flex-start',
            marginBottom: 10,
          }}
        >
          <View style={[{ width: i % 3 === 0 ? '72%' : '48%', height: 14, borderRadius: 8 }, rowStyle]} />
        </View>
      ))}
    </View>
  );
});

/** Network-aware empty state — differs between "no messages yet" and "offline / no cached data". */
const ChatEmptyState = memo(function ChatEmptyState({
  viewportHeight,
  dateLabelStyle,
}: {
  viewportHeight: number;
  dateLabelStyle?: object;
}) {
  const { isOnline } = useNetworkState();
  const { t } = useTranslation();
  const label = isOnline
    ? (t('messages.noMessagesYet', { defaultValue: 'No messages yet' }))
    : (t('messages.noMessagesOffline', { defaultValue: 'No messages available offline' }));
  return (
    <View style={{ flex: 1 }} pointerEvents="box-none">
      <View style={{ flex: 1, paddingTop: viewportHeight * 0.35, alignItems: 'center', paddingHorizontal: 24 }}>
        {!isOnline && (
          <Feather name="wifi-off" size={28} color="#9ca3af" style={{ marginBottom: 10, opacity: 0.7 }} />
        )}
        <Text style={[{ fontSize: 15, lineHeight: 20, opacity: 0.6, alignSelf: 'center', textAlign: 'center' }, dateLabelStyle]}>
          {label}
        </Text>
      </View>
    </View>
  );
});

const ChatRoomPaginationLoader = memo(function ChatRoomPaginationLoader({ labelStyle }: { labelStyle?: object }) {
  const { t } = useTranslation();
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.value = withRepeat(
      withSequence(withTiming(1, { duration: 400 }), withTiming(0.5, { duration: 400 })),
      -1,
      true
    );
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Reanimated.View style={[{ height: 24, justifyContent: 'center', alignItems: 'center' }, anim]}>
      <Text style={[{ fontSize: 12 }, labelStyle]}>{t('messages.loadingOlderMessages')}</Text>
    </Reanimated.View>
  );
});

type ChatRoomBodyProps = {
  messages: ChatMessage[];
  screenWidth: number;
  viewportHeight: number;
  listRef: React.RefObject<FlatList<ChatMessage> | null>;
  renderItem: ListRenderItem<ChatMessage> | null | undefined;
  keyExtractor: (item: ChatMessage) => string;
  typingIncoming: boolean;
  typingDotSurfaceStyle?: object;
  showPaginationLoader: boolean;
  paginationBlocking: boolean;
  onScroll: (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => void;
  onContentSizeChange: () => void;
  onViewableItemsChanged: (info: { viewableItems: { item: ChatMessage }[] }) => void;
  viewabilityConfig: { itemVisiblePercentThreshold: number };
  disableMaintainVisibleContentPosition?: boolean;
  refreshControl?: React.ReactElement;
  stickyDateOverlay: React.ReactNode;
  showScrollFab: boolean;
  scrollFabBottom: number;
  scrollFabRight: number;
  onScrollFabPress: () => void;
  fabSurfaceStyle?: object;
  fabIconColor?: string;
  newMessagesBadgeCount: number;
  fabBadgeLabelStyle?: object;
  pillSurfaceStyle?: object;
  dateLabelStyle?: object;
  unreadLineStyle?: object;
  unreadLabelStyle?: object;
  contextSheetSurfaceStyle?: object;
  contextRowLabelStyle?: object;
  contextIconColor?: string;
  contextDividerStyle?: object;
  reactionTraySurfaceStyle?: object;
  skeletonSurfaceStyle?: object;
  insetBottom: number;
  contextMessage: ChatMessage | null;
  onCloseContext: () => void;
  onContextReply: () => void;
  onContextCopy: () => void;
  onContextForward: () => void;
  onContextDelete: () => void;
  onContextInfo: () => void;
  reactionTrayVisible: boolean;
  reactionEmojis: string[];
  onReactionSelect: (emoji: string) => void;
  onReactionTrayDismiss: () => void;
  reactionTrayBottom: number;
  /** First FlatList viewport layout (profiling). */
  onListLayout?: () => void;
  /** List container layout (resize probe). */
  onListContainerLayout?: (e: { nativeEvent: { layout: { height: number; width: number } } }) => void;
  /** True until first message snapshot merged â€” show skeleton instead of blank. */
  showInitialSkeleton?: boolean;
  /** Opaque key so FlatList re-renders rows when in-chat search highlight changes without swapping `renderItem`. */
  listExtraData?: string | number;
};

const ChatRoomBody = memo(function ChatRoomBody({
  messages,
  screenWidth,
  viewportHeight,
  listRef,
  renderItem,
  keyExtractor,
  typingIncoming,
  typingDotSurfaceStyle,
  showPaginationLoader,
  paginationBlocking,
  onScroll,
  onContentSizeChange,
  onViewableItemsChanged,
  viewabilityConfig,
  disableMaintainVisibleContentPosition,
  refreshControl,
  stickyDateOverlay,
  showScrollFab,
  scrollFabBottom,
  scrollFabRight,
  onScrollFabPress,
  fabSurfaceStyle,
  fabIconColor,
  newMessagesBadgeCount,
  fabBadgeLabelStyle,
  pillSurfaceStyle,
  dateLabelStyle,
  unreadLineStyle,
  unreadLabelStyle,
  contextSheetSurfaceStyle,
  contextRowLabelStyle,
  contextIconColor,
  contextDividerStyle,
  reactionTraySurfaceStyle,
  skeletonSurfaceStyle,
  insetBottom,
  contextMessage,
  onCloseContext,
  onContextReply,
  onContextCopy,
  onContextForward,
  onContextDelete,
  onContextInfo,
  reactionTrayVisible,
  reactionEmojis,
  onReactionSelect,
  onReactionTrayDismiss,
  reactionTrayBottom,
  onListLayout,
  onListContainerLayout,
  showInitialSkeleton = false,
  listExtraData,
}: ChatRoomBodyProps) {
  if (__DEV__ && messages.length > 0) bumpChatPerfRender('ChatRoomBody');
  const bubbleMax = Math.max(0, screenWidth * 0.72 - 16);
  const listTuning = getChatRoomListTuning();
  const listInitialRender = listTuning.initialNumToRender;
  const listMaxBatch = listTuning.maxToRenderPerBatch;
  const listWindow = listTuning.windowSize;
  const contentContainerStyle = useMemo(
    () => ({
      paddingTop: NEWEST_MESSAGE_PAD,
      paddingBottom: 8,
      paddingHorizontal: 8,
    }),
    []
  );

  const handleListContainerLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number; width: number } } }) => {
      onListContainerLayout?.(event);
    },
    [onListContainerLayout]
  );

  const maintainVisible = useMemo(
    () =>
      disableMaintainVisibleContentPosition
        ? undefined
        : {
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 24,
          },
    [disableMaintainVisibleContentPosition]
  );

  // Inverted list: ListHeaderComponent = visual BOTTOM (newest end) â†’ typing indicator
  const listHeader = useMemo(() => {
    if (!typingIncoming) return LIST_HEADER_EMPTY;
    return <ChatRoomTypingIncoming maxBubbleWidth={bubbleMax} dotSurfaceStyle={typingDotSurfaceStyle} />;
  }, [typingIncoming, bubbleMax, typingDotSurfaceStyle]);

  // Inverted list: ListFooterComponent = visual TOP (oldest end) â†’ pagination loader
  const listFooter = useMemo(() => {
    if (paginationBlocking) {
      return (
        <View style={{ paddingVertical: 4 }}>
          <View style={[{ height: 60, marginVertical: 3, borderRadius: 12 }, skeletonSurfaceStyle]} />
        </View>
      );
    }
    if (showPaginationLoader) {
      return <ChatRoomPaginationLoader labelStyle={dateLabelStyle} />;
    }
    return null;
  }, [paginationBlocking, showPaginationLoader, skeletonSurfaceStyle, dateLabelStyle]);

  if (messages.length === 0 && showInitialSkeleton) {
    return (
      <View style={{ flex: 1 }} pointerEvents="box-none">
        <ChatMessageListSkeleton rowStyle={skeletonSurfaceStyle ?? { backgroundColor: '#e5e7eb' }} />
      </View>
    );
  }

  if (messages.length === 0) {
    return <ChatEmptyState viewportHeight={viewportHeight} dateLabelStyle={dateLabelStyle} />;
  }

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0 }} onLayout={handleListContainerLayout}>
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={listExtraData}
          inverted
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          removeClippedSubviews={Platform.OS === 'android'}
          windowSize={listWindow}
          maxToRenderPerBatch={listMaxBatch}
          updateCellsBatchingPeriod={listTuning.updateCellsBatchingPeriod}
          initialNumToRender={listInitialRender}
          maintainVisibleContentPosition={maintainVisible}
          onLayout={onListLayout}
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            const off = Math.max(0, averageItemLength * index);
            listRef.current?.scrollToOffset({ offset: off, animated: true });
          }}
          bounces={!paginationBlocking}
          scrollEnabled={!paginationBlocking}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={contentContainerStyle}
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          refreshControl={refreshControl}
        />
        {stickyDateOverlay}
        <ChatRoomScrollFab
          visible={showScrollFab}
          bottomOffset={scrollFabBottom}
          rightOffset={scrollFabRight}
          onPress={onScrollFabPress}
          fabSurfaceStyle={fabSurfaceStyle}
          iconColor={fabIconColor}
          badgeCount={newMessagesBadgeCount}
          badgeLabelStyle={fabBadgeLabelStyle}
        />
        <ChatRoomBodyContextSheet
          visible={!!contextMessage}
          onClose={onCloseContext}
          rowLabelStyle={contextRowLabelStyle ?? {}}
          iconColor={contextIconColor}
          dividerLineStyle={contextDividerStyle ?? {}}
          sheetSurfaceStyle={contextSheetSurfaceStyle}
          insetBottom={insetBottom}
          onReply={onContextReply}
          onCopy={onContextCopy}
          onForward={onContextForward}
          onDelete={onContextDelete}
          onInfo={onContextInfo}
        />
        <ChatRoomBodyReactionTray
          visible={reactionTrayVisible}
          bottomOffset={reactionTrayBottom}
          emojis={reactionEmojis}
          onSelect={onReactionSelect}
          onDismiss={onReactionTrayDismiss}
          traySurfaceStyle={reactionTraySurfaceStyle}
        />
      </View>
    </View>
  );
});

export default ChatRoomBody;

