import { stopAllAudioPlayback } from '@/components/AudioMessage';
import EditMessageModal from '@/components/EditMessageModal';
import GroupMembersSheet, { type GroupMemberRow } from '@/components/GroupMembersSheet';
import EmojiPicker from '@/components/EmojiPicker';
import ImageViewer from '@/components/ImageViewer';
import MessageActionMenu from '@/components/MessageActionMenu';
import MessageBubble from '@/components/MessageBubble';
import MessageReactions from '@/components/MessageReactions';
import StickyDateHeader from '@/components/StickyDateHeader';
import VoiceRecorderBar from '@/components/VoiceRecorderBar';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { db } from '@/lib/firebase';
import { hasNativeFirestore, subscribeToChatDocNative, subscribeToUserDocNative } from '@/lib/firestoreNative';
import {
  bumpChatPerfRender,
  chatPerfSessionEnd,
  chatPerfSessionStart,
  clearChatOpenMark,
  markChatAfterInteractions,
  markChatDocFirstSnapshot,
  markChatDocTaskStart,
  markChatFirstLayout,
  markChatMessagesLoaded,
  markChatReady,
  markChatScreenFnEnter,
  markChatScreenMount,
  markFlatListContentSized,
  markFlatListLayout,
  markMessageListenerScheduled,
  markPaginationComplete,
  markUserDocFirstSnapshot,
} from '@/lib/chatOpenPerf';
import { loadOlderChatMessages, startChatMessageListener, stopChatMessageListener } from '@/lib/services/chatPreloadService';
import {
  deleteMessageForEveryone,
  deleteMessageForMe,
  editMessage,
  removeGroupMemberFromGroup,
  markMessageAsDelivered,
  markMessageAsSeen,
  markMessagesAsRead,
  sendLocationMessage,
  sendMediaMessage,
  sendMessage,
  setTypingIndicator,
  toggleReaction,
  type SendChatMessageOptions,
} from '@/lib/services/chatService';
import { startLiveLocationPublisher } from '@/lib/location/liveLocationPublisher';
import { formatGeocodeForLocationMessage } from '@/lib/maps/formatGeocodeForLocationMessage';
import { openInNativeMaps } from '@/lib/maps/openInNativeMaps';
import * as Location from 'expo-location';
import {
  clearAndroidChatNotifications,
  consumeAndroidPendingReplyJson,
  setAndroidForegroundChatId,
} from '@/lib/chatNotificationBridge';
import { requestGywAiMultimodal, requestGywAiReply } from '@/lib/services/gywAiService';
import { Chat, ChatMessage, User } from '@/lib/types/chat';
import { CHAT_DELETED_FOR_EVERYONE_TEXT } from '@/lib/constants/chatMessages';
import {
  GYW_AI_DISPLAY_NAME,
  GYW_AI_SYSTEM_ID,
  type GywAiMultimodalRoutingMode,
} from '@/lib/constants/gywAi';
import { formatDateHeader, shouldShowSenderInverted, shouldShowTailInverted } from '@/lib/utils/chatUtils';
import { setUserChatMuted } from '@/lib/services/userChatMetaService';
import { isLegacyAndroid } from '@/lib/perf/deviceProfile';
import { EMPTY_MESSAGES, useChatStore } from '@/store/chatStore';
import { BlockedPeerSendError } from '@/lib/chatSendGuards';
import {
  DOCUMENT_PICKER_MIME_TYPES,
  isAllowedChatDocument,
  isDocumentLikeMime,
  MAX_CHAT_DOCUMENT_BYTES,
  resolveDocumentExtension,
} from '@/lib/documents/documentUpload';
import { openChatDocument } from '@/lib/documents/openChatDocument';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import { usePresenceStore } from '@/store/presenceStore';
import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { doc, onSnapshot } from 'firebase/firestore';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Animated as RNAnimated,
  Dimensions,
  Easing,
  FlatList,
  I18nManager,
  Image as RNImage,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  unstable_batchedUpdates,
  useWindowDimensions,
  View,
  type ListRenderItem,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  type SharedValue,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const ICON_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 } as const;

const HEADER_ACTION_HIT_SLOP = { top: 12, right: 12, bottom: 12, left: 12 } as const;

const CHAT_REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢'];

/** Stable ref for MessageBubble — avoids allocating a new noop each list render. */
const MESSAGE_BUBBLE_NOOP_LONG_PRESS = () => {};

/** DEV: increments Composer render count for CHAT_PERF_RENDERS. */
function ChatPerfComposerProbe() {
  if (__DEV__) bumpChatPerfRender('Composer');
  return null;
}

type ChatRoomHeaderProps = {
  displayName: string;
  avatarUri?: string | null;
  typing: boolean;
  online: boolean;
  lastSeenLine: string;
  showOnlineAvatarBadge: boolean;
  backDisabled?: boolean;
  callDisabled: boolean;
  activeVideoRing: boolean;
  activeVoiceRing: boolean;
  hideCallButtons?: boolean;
  /** Opaque style objects from screen (backgrounds, strokes, text) — header contains no palette literals */
  headerSurfaceStyle?: object;
  dividerLineStyle?: object;
  onlineBadgeSurfaceStyle?: object;
  primaryGlyphStyle?: object;
  secondaryGlyphStyle?: object;
  typingDotSurfaceStyle?: object;
  menuSheetSurfaceStyle?: object;
  /** Spread onto react-native-svg Circle (stroke, strokeOpacity, …) */
  callRingCircleProps?: Record<string, string | number>;
  onBack: () => void;
  onVideoCall: () => void;
  onVoiceCall: () => void;
  onViewContact: () => void;
  onMuteNotifications: () => void;
  onSearch: () => void;
  onMore: () => void;
  /** Mute row label (Mute vs Unmute) — avoids rebuilding the whole menu. */
  muteRowLabel: string;
  onAvatarPress: () => void;
  /** When set, tap on display name + short tap on avatar opens user profile (direct chats). */
  onOpenProfilePress?: () => void;
  /** Group: tap title / subtitle area to open group info. */
  onGroupInfoPress?: () => void;
  /** Optional rows prepended to the header “…” sheet (e.g. group members). */
  menuExtraRows?: { key: string; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }[];
};

const HeaderCallRing = memo(function HeaderCallRing({
  active,
  size,
  circleProps,
}: {
  active: boolean;
  size: number;
  circleProps?: Record<string, string | number>;
}) {
  if (!active) return null;
  const strokeW = 2;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeW) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * 0.8;
  const gap = c - dash;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          strokeWidth={strokeW}
          strokeDasharray={`${dash} ${gap}`}
          fill="none"
          transform={`rotate(-90 ${cx} ${cy})`}
          {...circleProps}
        />
      </Svg>
    </View>
  );
});

const HeaderTypingDots = memo(function HeaderTypingDots({ dotSurfaceStyle }: { dotSurfaceStyle?: object }) {
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
  }, [d0, d1, d2]);
  const s0 = useAnimatedStyle(() => ({ opacity: d0.value }));
  const s1 = useAnimatedStyle(() => ({ opacity: d1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: d2.value }));
  const dot = { width: 5, height: 5, borderRadius: 2.5 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, columnGap: 3 }}>
      <Reanimated.View style={[dot, dotSurfaceStyle, s0]} />
      <Reanimated.View style={[dot, dotSurfaceStyle, s1]} />
      <Reanimated.View style={[dot, dotSurfaceStyle, s2]} />
    </View>
  );
});

const HeaderMenuSheet = memo(function HeaderMenuSheet({
  visible,
  onClose,
  rowLabelStyle,
  iconColor,
  dividerLineStyle,
  sheetSurfaceStyle,
  insetBottom,
  rtl,
  onViewContact,
  onMute,
  onSearch,
  onMore,
  menuExtraRows,
  muteRowLabel,
}: {
  visible: boolean;
  onClose: () => void;
  rowLabelStyle: object;
  iconColor?: string;
  dividerLineStyle: object;
  sheetSurfaceStyle?: object;
  insetBottom: number;
  rtl: boolean;
  onViewContact: () => void;
  onMute: () => void;
  onSearch: () => void;
  onMore: () => void;
  menuExtraRows?: { key: string; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }[];
  muteRowLabel: string;
}) {
  const { t } = useTranslation();
  const rows: { key: string; label: string; icon: keyof typeof Feather.glyphMap; onPress: () => void }[] = [
    ...(menuExtraRows ?? []),
    { key: 'vc', label: t('messages.viewContact'), icon: 'user', onPress: onViewContact },
    { key: 'mute', label: muteRowLabel, icon: 'bell-off', onPress: onMute },
    { key: 'search', label: t('messages.searchInChat'), icon: 'search', onPress: onSearch },
    { key: 'more', label: t('messages.moreMenu'), icon: 'more-horizontal', onPress: onMore },
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('a11y.dismissMenu')} />
        <View style={[{ paddingBottom: insetBottom, minHeight: 180 }, sheetSurfaceStyle]}>
          {rows.map((row, i) => (
            <View key={row.key}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  row.onPress();
                  onClose();
                }}
                style={{
                  height: 44,
                  paddingHorizontal: 16,
                  flexDirection: rtl ? 'row-reverse' : 'row',
                  alignItems: 'center',
                  columnGap: 12,
                }}
              >
                <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name={row.icon} size={20} color={iconColor} />
                </View>
                <Text style={[{ flex: 1, fontSize: 15 }, rowLabelStyle]} numberOfLines={1}>
                  {row.label}
                </Text>
              </Pressable>
              {i < rows.length - 1 ? (
                <View style={[{ height: StyleSheet.hairlineWidth, marginLeft: rtl ? 0 : 16, marginRight: rtl ? 16 : 0 }, dividerLineStyle]} />
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
});

const HeaderAvatarContextSheet = memo(function HeaderAvatarContextSheet({
  visible,
  onClose,
  rowLabelStyle,
  iconColor,
  dividerLineStyle,
  sheetSurfaceStyle,
  insetBottom,
  rtl,
  onSaveImage,
  displayName,
}: {
  visible: boolean;
  onClose: () => void;
  rowLabelStyle: object;
  iconColor?: string;
  dividerLineStyle: object;
  sheetSurfaceStyle?: object;
  insetBottom: number;
  rtl: boolean;
  onSaveImage: () => void;
  displayName: string;
}) {
  const { t } = useTranslation();
  const copyName = async () => {
    await Clipboard.setStringAsync(displayName);
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('a11y.dismissSheet')} />
        <View style={[{ paddingBottom: insetBottom }, sheetSurfaceStyle]}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSaveImage();
              onClose();
            }}
            style={{
              height: 44,
              paddingHorizontal: 16,
              flexDirection: rtl ? 'row-reverse' : 'row',
              alignItems: 'center',
              columnGap: 12,
            }}
          >
            <Feather name="download" size={20} color={iconColor} />
            <Text style={[{ flex: 1, fontSize: 15 }, rowLabelStyle]}>{t('messages.avatarSaveImage')}</Text>
          </Pressable>
          <View style={[{ height: StyleSheet.hairlineWidth, marginLeft: rtl ? 0 : 16, marginRight: rtl ? 16 : 0 }, dividerLineStyle]} />
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              copyName();
            }}
            style={{
              height: 44,
              paddingHorizontal: 16,
              flexDirection: rtl ? 'row-reverse' : 'row',
              alignItems: 'center',
              columnGap: 12,
            }}
          >
            <Feather name="copy" size={20} color={iconColor} />
            <Text style={[{ flex: 1, fontSize: 15 }, rowLabelStyle]}>{t('messages.avatarCopyName')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

const CHAT_BODY_SWIPE_OPEN = 60;
/** Release past this distance (logical px) to commit swipe-to-reply; under-open snap-back uses spring only. */
const CHAT_BODY_SWIPE_REPLY_TRIGGER = 60;

const AnimatedFlatList = RNAnimated.createAnimatedComponent(FlatList<ChatMessage>);

const BodySwipeableRow = memo(function BodySwipeableRow({
  message,
  isOutgoing,
  children,
  onSwipeReply,
  onLongPress,
  onTap,
  onDoubleTap,
}: {
  message: ChatMessage;
  isOutgoing: boolean;
  children: React.ReactNode;
  // Stable parent handlers — message is passed as argument so no inline closures needed
  onSwipeReply: (message: ChatMessage) => void;
  onLongPress: (message: ChatMessage) => void;
  onTap: () => void;
  onDoubleTap: (message: ChatMessage) => void;
}) {
  const tx = useSharedValue(0);

  const hapticLight = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const hapticMedium = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const ax = Math.abs(e.translationX);
      const ay = Math.abs(e.translationY);
      if (ay > ax * 1.2) return;
      if (isOutgoing) {
        if (e.translationX < 0) tx.value = Math.max(e.translationX, -CHAT_BODY_SWIPE_OPEN);
        else tx.value = 0;
      } else if (e.translationX > 0) {
        tx.value = Math.min(e.translationX, CHAT_BODY_SWIPE_OPEN);
      } else {
        tx.value = 0;
      }
    })
    .onEnd((e) => {
      if (isOutgoing) {
        if (
          e.translationX <= -CHAT_BODY_SWIPE_REPLY_TRIGGER &&
          Math.abs(e.translationX) > Math.abs(e.translationY)
        ) {
          runOnJS(hapticLight)();
          runOnJS(onSwipeReply)(message);
        }
      } else if (
        e.translationX >= CHAT_BODY_SWIPE_REPLY_TRIGGER &&
        Math.abs(e.translationX) > Math.abs(e.translationY)
      ) {
        runOnJS(hapticLight)();
        runOnJS(onSwipeReply)(message);
      }
      tx.value = withSpring(0, { damping: 22, stiffness: 320 });
    });

  const longPress = Gesture.LongPress()
    .minDuration(400)
    .onStart(() => {
      runOnJS(hapticMedium)();
      runOnJS(onLongPress)(message);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => runOnJS(onDoubleTap)(message));

  const singleTap = Gesture.Tap().onEnd(() => runOnJS(onTap)());

  const taps = Gesture.Exclusive(doubleTap, singleTap);
  const composed = Gesture.Simultaneous(pan, longPress, taps);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <GestureDetector gesture={composed}>
      <Reanimated.View style={rowStyle}>{children}</Reanimated.View>
    </GestureDetector>
  );
});

const ChatRoomDateDivider = memo(function ChatRoomDateDivider({
  label,
  pillSurfaceStyle,
  labelStyle,
}: {
  label: string;
  pillSurfaceStyle?: object;
  labelStyle?: object;
}) {
  return (
    <View style={{ alignSelf: 'center', marginHorizontal: 24, marginVertical: 16 }}>
      <View style={[{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 }, pillSurfaceStyle]}>
        <Text style={[{ fontSize: 12, lineHeight: 16, textAlign: 'center' }, labelStyle]}>{label}</Text>
      </View>
    </View>
  );
});

const ChatRoomUnreadMarker = memo(function ChatRoomUnreadMarker({
  screenWidth,
  lineStyle,
  labelStyle,
}: {
  screenWidth: number;
  lineStyle?: object;
  labelStyle?: object;
}) {
  const w = Math.max(0, screenWidth - 32);
  return (
    <View style={{ alignItems: 'center', marginVertical: 16, width: '100%' }}>
      <Text style={[{ fontSize: 11, marginBottom: 6, textAlign: 'center' }, labelStyle]}>Unread</Text>
      <View style={[{ width: w, height: StyleSheet.hairlineWidth }, lineStyle]} />
      <View style={{ height: 8 }} />
    </View>
  );
});

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
  keyboardPadAnim: RNAnimated.Value;
  listRef: React.RefObject<FlatList<ChatMessage> | null>;
  renderItem: ListRenderItem<ChatMessage> | null | undefined;
  keyExtractor: (item: ChatMessage) => string;
  typingIncoming: boolean;
  typingDotSurfaceStyle?: object;
  showPaginationLoader: boolean;
  paginationBlocking: boolean;
  onScroll: (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => void;
  onContentSizeChange: () => void;
  onViewableItemsChanged: (info: { viewableItems: Array<{ item: ChatMessage }> }) => void;
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
  /** True until first message snapshot merged — show skeleton instead of blank. */
  showInitialSkeleton?: boolean;
  /** Opaque key so FlatList re-renders rows when in-chat search highlight changes without swapping `renderItem`. */
  listExtraData?: string | number;
};

const ChatRoomBody = memo(function ChatRoomBody({
  messages,
  screenWidth,
  viewportHeight,
  keyboardPadAnim,
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
  showInitialSkeleton = false,
  listExtraData,
}: ChatRoomBodyProps) {
  if (__DEV__ && messages.length > 0) bumpChatPerfRender('ChatRoomBody');
  const bubbleMax = Math.max(0, screenWidth * 0.72 - 16);
  const listInitialRender = Platform.OS === 'android' ? (isLegacyAndroid() ? 6 : 8) : 14;
  const listMaxBatch = Platform.OS === 'android' ? (isLegacyAndroid() ? 4 : 6) : 8;
  const listWindow = Platform.OS === 'android' ? (isLegacyAndroid() ? 4 : 5) : 7;
  const listExtraBottomRef = useRef(new RNAnimated.Value(12));
  const animatedContentStyle = useMemo(
    () => ({
      paddingTop: 8,
      paddingBottom: RNAnimated.add(keyboardPadAnim, listExtraBottomRef.current),
      paddingHorizontal: 8,
      flexGrow: 1,
    }),
    [keyboardPadAnim]
  );

  // Inverted list: ListHeaderComponent = visual BOTTOM (newest end) → typing indicator
  const listHeader = useMemo(() => {
    if (!typingIncoming) return null;
    return <ChatRoomTypingIncoming maxBubbleWidth={bubbleMax} dotSurfaceStyle={typingDotSurfaceStyle} />;
  }, [typingIncoming, bubbleMax, typingDotSurfaceStyle]);

  // Inverted list: ListFooterComponent = visual TOP (oldest end) → pagination loader
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
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']} pointerEvents="box-none">
        <ChatMessageListSkeleton rowStyle={skeletonSurfaceStyle ?? { backgroundColor: '#e5e7eb' }} />
      </SafeAreaView>
    );
  }

  if (messages.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']} pointerEvents="box-none">
        <View style={{ flex: 1, paddingTop: viewportHeight * 0.35, alignItems: 'center', paddingHorizontal: 24 }}>
          <Text style={[{ fontSize: 15, lineHeight: 20, opacity: 0.6, alignSelf: 'center', textAlign: 'center' }, dateLabelStyle]}>
            No messages yet
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <View style={{ flex: 1 }} removeClippedSubviews>
        <AnimatedFlatList
          ref={listRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          extraData={listExtraData}
          inverted={true}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          removeClippedSubviews
          windowSize={listWindow}
          maxToRenderPerBatch={listMaxBatch}
          updateCellsBatchingPeriod={Platform.OS === 'android' ? 80 : 50}
          initialNumToRender={listInitialRender}
          onLayout={onListLayout}
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            const off = Math.max(0, averageItemLength * index);
            listRef.current?.scrollToOffset({ offset: off, animated: true });
          }}
          bounces={!paginationBlocking}
          scrollEnabled={!paginationBlocking}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          contentContainerStyle={animatedContentStyle}
          onContentSizeChange={onContentSizeChange}
          onScroll={onScroll}
          scrollEventThrottle={100}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          refreshControl={refreshControl as React.ComponentProps<typeof AnimatedFlatList>['refreshControl']}
          onScrollBeginDrag={() => Keyboard.dismiss()}
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
    </SafeAreaView>
  );
});

const ChatRoomHeader = memo(function ChatRoomHeader({
  displayName,
  avatarUri,
  typing,
  online,
  lastSeenLine,
  showOnlineAvatarBadge,
  backDisabled = false,
  callDisabled,
  activeVideoRing,
  activeVoiceRing,
  hideCallButtons = false,
  headerSurfaceStyle,
  dividerLineStyle,
  onlineBadgeSurfaceStyle,
  primaryGlyphStyle,
  secondaryGlyphStyle,
  typingDotSurfaceStyle,
  menuSheetSurfaceStyle,
  callRingCircleProps,
  onBack,
  onVideoCall,
  onVoiceCall,
  onViewContact,
  onMuteNotifications,
  onSearch,
  onMore,
  onAvatarPress,
  onOpenProfilePress,
  onGroupInfoPress,
  menuExtraRows,
  muteRowLabel,
}: ChatRoomHeaderProps) {
  if (__DEV__) bumpChatPerfRender('ChatRoomHeader');
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const rtl = I18nManager.isRTL;
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarCtxOpen, setAvatarCtxOpen] = useState(false);
  const iconTint = (StyleSheet.flatten(primaryGlyphStyle) as { color?: string } | undefined)?.color;

  const typingA = useSharedValue(typing ? 1 : 0);
  const statusA = useSharedValue(typing ? 0 : 1);
  const onlineA = useSharedValue(online ? 1 : 0);
  const lastSeenA = useSharedValue(online ? 0 : 1);

  useEffect(() => {
    typingA.value = withTiming(typing ? 1 : 0, { duration: 150 });
    statusA.value = withTiming(typing ? 0 : 1, { duration: 150 });
  }, [typing, typingA, statusA]);

  useEffect(() => {
    if (typing) return;
    onlineA.value = withTiming(online ? 1 : 0, { duration: 150 });
    lastSeenA.value = withTiming(online ? 0 : 1, { duration: 150 });
  }, [typing, online, onlineA, lastSeenA]);

  const typingAnim = useAnimatedStyle(() => ({ opacity: typingA.value }));
  const statusAnim = useAnimatedStyle(() => ({ opacity: statusA.value }));
  const onlineAnim = useAnimatedStyle(() => ({ opacity: onlineA.value }));
  const lastSeenAnim = useAnimatedStyle(() => ({ opacity: lastSeenA.value }));

  const videoScale = useSharedValue(1);
  const voiceScale = useSharedValue(1);
  const videoScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: videoScale.value }] }));
  const voiceScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: voiceScale.value }] }));

  const pressIn = (v: SharedValue<number>) => {
    v.value = withTiming(0.95, { duration: 100 });
  };
  const pressOut = (v: SharedValue<number>) => {
    v.value = withTiming(1, { duration: 100 });
  };

  const rowDir = rtl ? 'row-reverse' : 'row';
  const nameAlign = rtl ? 'right' : 'left';

  return (
    <SafeAreaView edges={['top']} style={[{ width: '100%' }, headerSurfaceStyle]}>
      <StatusBar translucent />
      <View style={{ height: 56, paddingHorizontal: 4, justifyContent: 'center' }}>
        <View style={{ flexDirection: rowDir, alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: rowDir, alignItems: 'center', flex: 1, minWidth: 0 }}>
            <View style={{ opacity: backDisabled ? 0.4 : 1 }} pointerEvents={backDisabled ? 'none' : 'auto'}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onBack();
                }}
                style={{
                  width: 48,
                  height: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                hitSlop={HEADER_ACTION_HIT_SLOP}
                accessibilityLabel={t('a11y.goBack')}
              >
                <View style={{ transform: [{ rotate: rtl ? '180deg' : '0deg' }] }}>
                  <Feather name="arrow-left" size={24} color={iconTint} />
                </View>
              </Pressable>
            </View>

            <View style={rtl ? { marginRight: -16 } : { marginLeft: -16 }}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (onOpenProfilePress) onOpenProfilePress();
                  else onAvatarPress();
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  setAvatarCtxOpen(true);
                }}
                delayLongPress={400}
                style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  shouldRasterizeIOS
                  removeClippedSubviews
                  collapsable={false}
                >
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                  ) : (
                    <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={[{ fontSize: 14, fontWeight: '600' }, secondaryGlyphStyle]} numberOfLines={1}>
                        {displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  {showOnlineAvatarBadge ? (
                    <View
                      pointerEvents="none"
                      style={[
                        {
                          position: 'absolute',
                          bottom: -2,
                          ...(rtl ? { left: -2 } : { right: -2 }),
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                        },
                        onlineBadgeSurfaceStyle,
                      ]}
                    />
                  ) : null}
                </View>
              </Pressable>
            </View>

            <View style={rtl ? { marginRight: 12, maxWidth: 140, flexShrink: 1 } : { marginLeft: 12, maxWidth: 140, flexShrink: 1 }}>
              {onOpenProfilePress ? (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onOpenProfilePress();
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.openProfile')}
                >
                  <Text
                    style={[
                      {
                        fontSize: 17,
                        lineHeight: 22,
                        textAlign: nameAlign,
                      },
                      primaryGlyphStyle,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {displayName}
                  </Text>
                  <View style={{ marginTop: 2, minHeight: 16, justifyContent: 'center' }}>
                    <Reanimated.View style={[StyleSheet.absoluteFillObject, typingAnim]} pointerEvents="none">
                      <HeaderTypingDots dotSurfaceStyle={typingDotSurfaceStyle} />
                    </Reanimated.View>
                    <Reanimated.View style={[statusAnim]} pointerEvents="none">
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, onlineAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {t('chats.online')}
                        </Text>
                      </Reanimated.View>
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, lastSeenAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {lastSeenLine}
                        </Text>
                      </Reanimated.View>
                    </Reanimated.View>
                  </View>
                </Pressable>
              ) : onGroupInfoPress ? (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onGroupInfoPress();
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.groupInfo')}
                >
                  <Text
                    style={[
                      {
                        fontSize: 17,
                        lineHeight: 22,
                        textAlign: nameAlign,
                      },
                      primaryGlyphStyle,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {displayName}
                  </Text>
                  <View style={{ marginTop: 2, minHeight: 16, justifyContent: 'center' }}>
                    <Reanimated.View style={[StyleSheet.absoluteFillObject, typingAnim]} pointerEvents="none">
                      <HeaderTypingDots dotSurfaceStyle={typingDotSurfaceStyle} />
                    </Reanimated.View>
                    <Reanimated.View style={[statusAnim]} pointerEvents="none">
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, onlineAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {t('chats.online')}
                        </Text>
                      </Reanimated.View>
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, lastSeenAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {lastSeenLine}
                        </Text>
                      </Reanimated.View>
                    </Reanimated.View>
                  </View>
                </Pressable>
              ) : (
                <>
                  <Text
                    style={[
                      {
                        fontSize: 17,
                        lineHeight: 22,
                        textAlign: nameAlign,
                      },
                      primaryGlyphStyle,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {displayName}
                  </Text>
                  <View style={{ marginTop: 2, minHeight: 16, justifyContent: 'center' }}>
                    <Reanimated.View style={[StyleSheet.absoluteFillObject, typingAnim]} pointerEvents="none">
                      <HeaderTypingDots dotSurfaceStyle={typingDotSurfaceStyle} />
                    </Reanimated.View>
                    <Reanimated.View style={[statusAnim]} pointerEvents="none">
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, onlineAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {t('chats.online')}
                        </Text>
                      </Reanimated.View>
                      <Reanimated.View style={[StyleSheet.absoluteFillObject, lastSeenAnim]}>
                        <Text
                          style={[{ fontSize: 12, lineHeight: 16, textAlign: nameAlign }, secondaryGlyphStyle]}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {lastSeenLine}
                        </Text>
                      </Reanimated.View>
                    </Reanimated.View>
                  </View>
                </>
              )}
            </View>
          </View>

          <View style={{ flexDirection: rowDir, alignItems: 'center', columnGap: 16 }}>
            {!hideCallButtons ? (
              <Pressable
                onPress={() => {
                  if (callDisabled || activeVideoRing) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onVideoCall();
                }}
                onPressIn={() => !callDisabled && !activeVideoRing && pressIn(videoScale)}
                onPressOut={() => pressOut(videoScale)}
                disabled={callDisabled || activeVideoRing}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: callDisabled ? 0.4 : 1 }}
                hitSlop={HEADER_ACTION_HIT_SLOP}
                accessibilityLabel={t('calls.videoCall')}
              >
                <Reanimated.View style={[{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, videoScaleStyle]}>
                  <HeaderCallRing active={activeVideoRing} size={48} circleProps={callRingCircleProps} />
                  <Feather name="video" size={24} color={iconTint} />
                </Reanimated.View>
              </Pressable>
            ) : null}
            {!hideCallButtons ? (
              <Pressable
                onPress={() => {
                  if (callDisabled || activeVoiceRing) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onVoiceCall();
                }}
                onPressIn={() => !callDisabled && !activeVoiceRing && pressIn(voiceScale)}
                onPressOut={() => pressOut(voiceScale)}
                disabled={callDisabled || activeVoiceRing}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: callDisabled ? 0.4 : 1 }}
                hitSlop={HEADER_ACTION_HIT_SLOP}
                accessibilityLabel={t('calls.audioCall')}
              >
                <Reanimated.View style={[{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, voiceScaleStyle]}>
                  <HeaderCallRing active={activeVoiceRing} size={48} circleProps={callRingCircleProps} />
                  <Feather name="phone" size={24} color={iconTint} />
                </Reanimated.View>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setMenuOpen(true);
              }}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={HEADER_ACTION_HIT_SLOP}
              accessibilityLabel={t('messages.moreMenu')}
            >
              <Feather name="more-vertical" size={24} color={iconTint} />
            </Pressable>
          </View>
        </View>

        <View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: StyleSheet.hairlineWidth,
            },
            dividerLineStyle,
          ]}
        />
      </View>

      <HeaderMenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        rowLabelStyle={primaryGlyphStyle ?? {}}
        iconColor={iconTint}
        dividerLineStyle={dividerLineStyle ?? {}}
        sheetSurfaceStyle={menuSheetSurfaceStyle}
        insetBottom={insets.bottom}
        rtl={rtl}
        menuExtraRows={menuExtraRows}
        onViewContact={onViewContact}
        onMute={onMuteNotifications}
        onSearch={onSearch}
        onMore={onMore}
        muteRowLabel={muteRowLabel}
      />

      <HeaderAvatarContextSheet
        visible={avatarCtxOpen}
        onClose={() => setAvatarCtxOpen(false)}
        rowLabelStyle={primaryGlyphStyle ?? {}}
        iconColor={iconTint}
        dividerLineStyle={dividerLineStyle ?? {}}
        sheetSurfaceStyle={menuSheetSurfaceStyle}
        insetBottom={insets.bottom}
        rtl={rtl}
        displayName={displayName}
        onSaveImage={() => {
          // TODO: attach save-to-gallery (e.g. expo-media-library) when avatarUri is set
        }}
      />
    </SafeAreaView>
  );
});

function isFirestorePermissionDenied(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = typeof (e as Error)?.message === 'string' ? (e as Error).message.toLowerCase() : '';
  return (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    msg.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions')
  );
}

const ChatScreen = () => {
  const { id: chatId, pendingMedia, markRead } = useLocalSearchParams<{
    id: string;
    pendingMedia?: string;
    markRead?: string;
  }>();

  const perfChatSessionRef = useRef<string | null>(null);
  if (chatId && perfChatSessionRef.current !== chatId) {
    if (perfChatSessionRef.current) chatPerfSessionEnd();
    perfChatSessionRef.current = chatId;
    chatPerfSessionStart(chatId);
    markChatScreenFnEnter(chatId);
  }
  if (__DEV__) bumpChatPerfRender('ChatScreen');

  const { user } = useAuth();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { colorScheme, isDark } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const openPerfReadyRef = useRef(false);
  const openPerfMessagesLoadedRef = useRef(false);
  const listContentSizedRef = useRef(false);
  /** First Firestore message snapshot merged — ends skeleton; enables typing + read-receipt work. */
  const messageStreamHydratedRef = useRef(false);
  const hydrateFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [messageStreamHydrated, setMessageStreamHydrated] = useState(false);

  const markMessagesStreamHydrated = useCallback(() => {
    if (messageStreamHydratedRef.current) return;
    messageStreamHydratedRef.current = true;
    setMessageStreamHydrated(true);
    if (hydrateFallbackTimerRef.current) {
      clearTimeout(hydrateFallbackTimerRef.current);
      hydrateFallbackTimerRef.current = null;
    }
  }, []);
  const chatDocFirstSnapRef = useRef(false);
  const userDocFirstSnapRef = useRef(false);

  useEffect(() => {
    return () => {
      chatPerfSessionEnd();
    };
  }, []);

  useEffect(() => {
    return () => {
      pendingTextSendInteractionRef.current?.cancel?.();
      pendingTextSendInteractionRef.current = null;
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void import('@/lib/services/callService').catch(() => {});
    });
    return () => task.cancel?.();
  }, [chatId]);
  
  // State
  const [messageText, setMessageText] = useState('');
  const [chat, setChat] = useState<Chat | null>(null);
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState<User | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [showAttachOptions, setShowAttachOptions] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const liveLocationCleanupRef = useRef<(() => void) | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [viewingVideo, setViewingVideo] = useState<string | null>(null);
  const [actionMenuMessage, setActionMenuMessage] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const [stickyDateLabel, setStickyDateLabel] = useState<string | null>(null);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [creatingCall, setCreatingCall] = useState(false);
  const [outgoingCallKind, setOutgoingCallKind] = useState<'video' | 'voice' | null>(null);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [showLoadingOlderBanner, setShowLoadingOlderBanner] = useState(false);
  const [paginationBlocking, setPaginationBlocking] = useState(false);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(true);
  const [mediaComposerVisible, setMediaComposerVisible] = useState(false);
  const [mediaComposerUri, setMediaComposerUri] = useState<string | null>(null);
  const [mediaComposerDimensions, setMediaComposerDimensions] = useState<{ width: number; height: number } | null>(null);
  const [mediaComposerCaption, setMediaComposerCaption] = useState('');
  const [mediaComposerAiMode, setMediaComposerAiMode] = useState<GywAiMultimodalRoutingMode>('auto');
  const [mediaComposerSending, setMediaComposerSending] = useState(false);
  const [mediaComposerProgress, setMediaComposerProgress] = useState(0);
  const [bodyContextMessage, setBodyContextMessage] = useState<ChatMessage | null>(null);
  const [reactionTrayMessageId, setReactionTrayMessageId] = useState<string | null>(null);
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatSearchQuery, setInChatSearchQuery] = useState('');
  const [searchHighlightMessageId, setSearchHighlightMessageId] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const accessRevokedAlertRef = useRef(false);
  const lastReadCountRef = useRef(0);
  const keyboardPad = useRef(new RNAnimated.Value(0)).current;
  /** Always 0 — used on Android so FlatList does not add keyboard height (composer is outside the list). */
  const listKeyboardPadAndroid = useRef(new RNAnimated.Value(0)).current;
  const { width: windowWidth, height: viewportHeight } = useWindowDimensions();

  const sendOpacity = useSharedValue(0);
  const micOpacity = useSharedValue(1);
  const sendScale = useSharedValue(0.95);
  const micScale = useSharedValue(1);

  /** Mic/send toggle runs on the UI thread so it is not blocked by list re-renders. */
  const updateComposerSendMic = useCallback((hasText: boolean) => {
    runOnUI((ht: boolean) => {
      'worklet';
      sendOpacity.value = withTiming(ht ? 1 : 0, { duration: 150 });
      micOpacity.value = withTiming(ht ? 0 : 1, { duration: 150 });
      sendScale.value = withTiming(ht ? 1 : 0.95, { duration: 150 });
      micScale.value = withTiming(ht ? 0.95 : 1, { duration: 150 });
    })(hasText);
  }, [sendOpacity, micOpacity, sendScale, micScale]);

  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs
  const textInputRef = useRef<TextInput>(null);
  const messageRefs = useRef<Record<string, number>>({});
  const isCleaningUpRef = useRef(false);
  const isStartingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastStartTimestampRef = useRef<number>(0);
  const isMicPressedRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  /** After optimistic prepend at bottom, skip one auto scrollToOffset (fights keyboard + duplicate scroll). */
  const suppressNextBottomScrollRef = useRef(false);
  /** Latest post-interaction send task — cancelled on chat change/unmount only. */
  const pendingTextSendInteractionRef = useRef<{ cancel: () => void } | null>(null);
  const inChatSearchCursorRef = useRef(-1);
  const viewedMessageIdsRef = useRef<Set<string>>(new Set());
  const deliveredMessageIdsRef = useRef<Set<string>>(new Set());
  const insets = useSafeAreaInsets();
  const isMountedRef = useRef(true);
  const mediaComposerAnim = useRef(new RNAnimated.Value(0)).current;
  const mediaProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaSendingGuardRef = useRef(false);

  useEffect(() => {
    // Android: rely on `softwareKeyboardLayoutMode: "resize"` + KeyboardAvoidingView. Padding only
    // the inverted list does not move the composer (sibling below the list) and can double-offset
    // when resize works. iOS keeps JS-driven pad for inverted list + typing row.
    if (Platform.OS === 'android') {
      return;
    }
    const showEvt = 'keyboardWillShow' as const;
    const hideEvt = 'keyboardWillHide' as const;
    const subShow = Keyboard.addListener(showEvt, (e: { endCoordinates?: { height?: number } }) => {
      const h = (e.endCoordinates?.height ?? 0) + 8;
      RNAnimated.timing(keyboardPad, {
        toValue: h,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });
    const subHide = Keyboard.addListener(hideEvt, () => {
      RNAnimated.timing(keyboardPad, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [keyboardPad]);

  const sendIconStyle = useAnimatedStyle(() => ({
    opacity: sendOpacity.value,
    transform: [{ scale: sendScale.value }],
  }));
  const micIconStyle = useAnimatedStyle(() => ({
    opacity: micOpacity.value,
    transform: [{ scale: micScale.value }],
  }));
  
  // Colors
  const textColor = isDark ? 'text-white' : 'text-black';
  const textSecondaryColor = isDark ? 'text-gray-400' : 'text-gray-600';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const headerSurfaceStyle = useMemo(() => ({ backgroundColor: isDark ? '#111827' : '#ffffff' }), [isDark]);
  const headerTitleColor = isDark ? '#f9fafb' : '#111827';
  const headerDividerColor = isDark ? '#374151' : '#e5e7eb';
  const metaMutedColor = isDark ? '#9ca3af' : '#6b7280';
  const headerPrimaryGlyphStyle = useMemo(
    () => ({ color: headerTitleColor, fontWeight: '600' as const }),
    [headerTitleColor]
  );
  const headerSecondaryGlyphStyle = useMemo(() => ({ color: metaMutedColor }), [metaMutedColor]);
  const headerTypingDotStyle = useMemo(() => ({ backgroundColor: metaMutedColor }), [metaMutedColor]);
  const headerDividerLineStyle = useMemo(() => ({ backgroundColor: headerDividerColor }), [headerDividerColor]);
  const headerMenuSheetStyle = useMemo(
    () => ({
      backgroundColor: isDark ? '#111827' : '#ffffff',
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
    }),
    [isDark]
  );
  const headerOnlineBadgeStyle = useMemo(
    () => ({
      backgroundColor: '#FF5722',
      borderWidth: 2,
      borderColor: isDark ? '#111827' : '#ffffff',
    }),
    [isDark]
  );
  const headerCallRingCircleProps = useMemo(() => ({ stroke: iconColor, strokeOpacity: 0.95 }), [iconColor]);
  const bodyDatePillStyle = useMemo(() => ({ backgroundColor: isDark ? '#1f2937' : '#f3f4f6' }), [isDark]);
  const bodyFabSurfaceStyle = useMemo(
    () => ({
      backgroundColor: '#FF5722',
      borderRadius: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 4,
    }),
    []
  );
  const bodyContextSheetStyle = useMemo(
    () => ({
      backgroundColor: isDark ? '#111827' : '#ffffff',
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
    }),
    [isDark]
  );
  const bodySkeletonStyle = useMemo(() => ({ backgroundColor: isDark ? '#374151' : '#e5e7eb' }), [isDark]);
  const bodyReactionTrayStyle = useMemo(() => ({ backgroundColor: isDark ? '#1f2937' : '#ffffff' }), [isDark]);
  const listDateLabelStyleMemo = useMemo(() => ({ color: metaMutedColor }), [metaMutedColor]);
  const listContextRowLabelStyleMemo = useMemo(() => ({ color: headerTitleColor }), [headerTitleColor]);
  const listFabBadgeLabelStyleMemo = useMemo(() => ({ color: '#fff' as const }), []);

  // Load draft after first frame so message list can mount without AsyncStorage on critical path
  useEffect(() => {
    if (!chatId) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void AsyncStorage.getItem(`draft_${chatId}`).then((draft) => {
        if (draft && isMountedRef.current) {
          setMessageText(draft);
          updateComposerSendMic(draft.length > 0);
        }
      });
    });
    return () => {
      task.cancel?.();
    };
  }, [chatId, updateComposerSendMic]);

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, []);

  // Hydrate header/title from list cache before first paint (tap→visible shell).
  useLayoutEffect(() => {
    if (!chatId) return;
    const cachedChat = useChatStore.getState().chats.find((c) => c.id === chatId);
    if (cachedChat) {
      setChat(cachedChat);
    }
    markChatFirstLayout(chatId);
  }, [chatId]);

  // Stable empty reference when no messages (avoids getSnapshot loop)
  const rawMessages = useChatStore((state) => state.messagesByChat[chatId] ?? EMPTY_MESSAGES);
  
  // NEWEST → OLDEST for inverted FlatList (index 0 = latest, always at visual bottom).
  // Store is already kept in newest-first order by applyMessages (chatPreloadService) and
  // addMessage (prepend). No sort needed — just use rawMessages directly.
  const messages = rawMessages;

  const prevMessagesLengthRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const onScrollFabPressStable = useCallback(() => {
    setIsAtBottom(true);
    setShowNewMessagesButton(false);
    setNewMessagesCount(0);
    lastReadCountRef.current = messages.length;
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [messages.length]);

  const onReactionTrayDismissStable = useCallback(() => {
    setReactionTrayMessageId(null);
  }, []);

  const unreadDividerIndex = useMemo(() => {
    if (!user?.uid) return -1;
    return messages.findIndex(
      (m) => m.senderId !== user.uid && Array.isArray(m.readBy) && !m.readBy.includes(user.uid)
    );
  }, [messages, user?.uid]);
  
  // ========================================
  // EFFECTS
  // ========================================
  
  // Track if user is at bottom for smart scroll (inverted: offset 0 = bottom)
  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    setHasMoreOlderMessages(true);
  }, [chatId]);

  useEffect(() => {
    accessRevokedAlertRef.current = false;
    setAccessRevoked(false);
  }, [chatId]);

  useEffect(() => {
    listContentSizedRef.current = false;
    chatDocFirstSnapRef.current = false;
    userDocFirstSnapRef.current = false;
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    messageStreamHydratedRef.current = false;
    setMessageStreamHydrated(false);
    if (hydrateFallbackTimerRef.current) {
      clearTimeout(hydrateFallbackTimerRef.current);
      hydrateFallbackTimerRef.current = null;
    }
    hydrateFallbackTimerRef.current = setTimeout(() => {
      hydrateFallbackTimerRef.current = null;
      if (!messageStreamHydratedRef.current) {
        messageStreamHydratedRef.current = true;
        setMessageStreamHydrated(true);
      }
    }, 900);
    return () => {
      if (hydrateFallbackTimerRef.current) {
        clearTimeout(hydrateFallbackTimerRef.current);
        hydrateFallbackTimerRef.current = null;
      }
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    const task = InteractionManager.runAfterInteractions(() => {
      markChatAfterInteractions(chatId);
    });
    return () => task.cancel?.();
  }, [chatId]);

  // Defer message subscription until after one paint. iOS keeps double rAF to avoid
  // transition hitch; Android uses a single frame to shave ~16ms off first snapshot.
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    let raf1 = 0;
    let raf2: number | null = null;
    const startListener = () => {
      if (cancelled) return;
      markChatScreenMount(chatId);
      startChatMessageListener(
        chatId,
        30,
        () => {
          markMessagesStreamHydrated();
        },
        { viewerUid: user?.uid }
      );
    };
    raf1 = requestAnimationFrame(() => {
      markMessageListenerScheduled(chatId);
      if (Platform.OS === 'android') {
        if (isLegacyAndroid()) {
          InteractionManager.runAfterInteractions(() => {
            if (!cancelled) startListener();
          });
        } else {
          startListener();
        }
      } else {
        raf2 = requestAnimationFrame(startListener);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
      stopChatMessageListener();
      openPerfReadyRef.current = false;
      openPerfMessagesLoadedRef.current = false;
      clearChatOpenMark(chatId);
    };
  }, [chatId, markMessagesStreamHydrated, user?.uid]);

  useEffect(() => {
    if (!chatId || openPerfMessagesLoadedRef.current) return;
    if (messages.length === 0) return;
    openPerfMessagesLoadedRef.current = true;
    markChatMessagesLoaded(chatId, messages.length);
    const id = requestAnimationFrame(() => {
      if (!openPerfReadyRef.current) {
        openPerfReadyRef.current = true;
        markChatReady(chatId);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [chatId, messages.length]);
  
  // Live chat doc + typing: after interactions so open animation is not contending with native SDK work.
  useEffect(() => {
    if (!chatId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      markChatDocTaskStart(chatId);
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        unsubscribe = subscribeToChatDocNative(
          chatId,
          (chatData) => {
            if (chatData && isMountedRef.current) {
              if (!chatDocFirstSnapRef.current) {
                chatDocFirstSnapRef.current = true;
                markChatDocFirstSnapshot(chatId);
              }
              unstable_batchedUpdates(() => {
                setChat(chatData as Chat);
                useChatStore.getState().updateChat(chatId, chatData as Chat);
                usePresenceStore.getState().setTypingFromChat(
                  chatId,
                  (chatData as any).typing || {},
                  (chatData as any).participantData || {},
                  user?.uid
                );
              });
            }
          },
          (error) => {
            if (__DEV__) console.error('Chat listener error:', error);
            if (isFirestorePermissionDenied(error)) {
              triggerAccessRevoked();
            }
          }
        );
      } else {
        const chatRef = doc(db, 'chats', chatId);
        unsubscribe = onSnapshot(chatRef, (chatDoc) => {
          if (chatDoc.exists() && isMountedRef.current) {
            const data = chatDoc.data();
            const chatData = {
              id: chatDoc.id,
              ...data,
              lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt,
              createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
              updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            } as Chat;
            if (!chatDocFirstSnapRef.current) {
              chatDocFirstSnapRef.current = true;
              markChatDocFirstSnapshot(chatId);
            }
            unstable_batchedUpdates(() => {
              setChat(chatData);
              useChatStore.getState().updateChat(chatId, chatData);
              usePresenceStore.getState().setTypingFromChat(
                chatId,
                data?.typing || {},
                data?.participantData || {},
                user?.uid
              );
            });
          }
        }, (error) => {
          if (__DEV__) console.error('Chat listener error:', error);
          if (isFirestorePermissionDenied(error)) {
            triggerAccessRevoked();
          }
        });
      }
    });

    return () => {
      cancelled = true;
      task.cancel?.();
      if (unsubscribe) unsubscribe();
    };
  }, [chatId, user?.uid, triggerAccessRevoked]);

  const triggerAccessRevoked = useCallback(() => {
    if (accessRevokedAlertRef.current) return;
    accessRevokedAlertRef.current = true;
    setAccessRevoked(true);
    stopChatMessageListener();
    if (chatId) {
      useChatStore.getState().clearChat(chatId);
    }
    Alert.alert(t('groups.removedFromGroupTitle'), t('groups.removedFromGroupBody'), [
      {
        text: t('common.close'),
        onPress: () => {
          try {
            router.replace('/(home)/(tabs)/chats' as never);
          } catch {
            router.back();
          }
        },
      },
    ]);
  }, [chatId, router, t]);

  useEffect(() => {
    if (!user?.uid || !chat || chat.type !== 'group') return;
    if (chat.participants.includes(user.uid)) return;
    triggerAccessRevoked();
  }, [chat, user?.uid, triggerAccessRevoked]);
  
  // Get other participant ID
  const otherParticipantId = useMemo(() => {
    if (!chat || chat.type === 'group') return null;
    return chat.participants.find(p => p !== user?.uid) || null;
  }, [chat, user?.uid]);

  const isGroupAdmin = useMemo(() => {
    if (!chat || chat.type !== 'group' || !user?.uid) return false;
    if (chat.participantRoles?.[user.uid] === 'admin') return true;
    if (chat.createdBy === user.uid) return true;
    if (!chat.participantRoles && !chat.createdBy && chat.participants?.[0] === user.uid) return true;
    return false;
  }, [chat, user?.uid]);

  const isGywAiChat = !!otherParticipantId && otherParticipantId === GYW_AI_SYSTEM_ID && chat?.type === 'direct';

  const directPeerBlocked = useUserBlocksStore((s) =>
    !!(chat?.type === 'direct' && otherParticipantId && s.blockedPeerIds[otherParticipantId])
  );
  const composerInputLocked = accessRevoked || directPeerBlocked;

  /** Fast Firestore path: one batch write + skip per-send `getDoc(chats)` when participants are known. */
  const recipientSendOptions: SendChatMessageOptions | undefined = useMemo(() => {
    const ids = chat?.participants?.filter((p) => p !== user?.uid) ?? [];
    const participants = chat?.participants;
    const guard =
      Array.isArray(participants) && participants.length > 0 ? { participantsForSendGuard: participants } : {};
    if (ids.length > 0) {
      return { recipientUserIds: ids, ...guard };
    }
    return Object.keys(guard).length > 0 ? guard : undefined;
  }, [chat?.participants, user?.uid]);

  useEffect(() => {
    return () => {
      liveLocationCleanupRef.current?.();
      liveLocationCleanupRef.current = null;
    };
  }, []);

  const requestLocationPermission = useCallback(async (): Promise<boolean> => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status === Location.PermissionStatus.GRANTED) return true;
    Alert.alert(t('common.permissionRequired'), t('location.permissionDenied'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('location.openSettings'), onPress: () => void Linking.openSettings() },
    ]);
    return false;
  }, [t]);

  const openLocationAttach = useCallback(() => {
    setShowAttachOptions(false);
    setLocationSheetOpen(true);
  }, []);

  const handleOpenLocation = useCallback((message: ChatMessage) => {
    if (message.type !== 'location') return;
    const lat = message.latitude ?? 0;
    const lng = message.longitude ?? 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    void openInNativeMaps({
      latitude: lat,
      longitude: lng,
      label: message.placeName || message.placeAddress,
    });
  }, []);

  const sendCurrentLocationAttachment = useCallback(async () => {
    if (!user?.uid || !chatId) return;
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    setLocationSheetOpen(false);
    const ok = await requestLocationPermission();
    if (!ok) return;
    setSending(true);
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let placeName: string | undefined;
      let placeAddress: string | undefined;
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        const g = geo[0];
        if (g) {
          const fmt = formatGeocodeForLocationMessage(g);
          placeName = fmt.placeName;
          placeAddress = fmt.placeAddress;
        }
      } catch {
        /* optional */
      }
      await sendLocationMessage(
        chatId,
        user.uid,
        user.displayName || user.phoneNumber || 'User',
        user.photoURL || undefined,
        pos.coords.latitude,
        pos.coords.longitude,
        {
          ...recipientSendOptions,
          placeName,
          placeAddress,
          replyTo: replyingTo
            ? {
                messageId: replyingTo.id,
                senderName: replyingTo.senderName,
                text: replyingTo.text,
                type: replyingTo.type,
              }
            : undefined,
        }
      );
      setReplyingTo(null);
    } catch (e) {
      if (__DEV__) console.warn('[chat] send location', e);
      Alert.alert(t('common.error'), t('location.failed'));
    } finally {
      setSending(false);
    }
  }, [
    user,
    chatId,
    directPeerBlocked,
    requestLocationPermission,
    recipientSendOptions,
    replyingTo,
    t,
  ]);

  const sendLiveLocationAttachment = useCallback(
    async (durationMs: number) => {
      if (!user?.uid || !chatId) return;
      if (directPeerBlocked) {
        Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
        return;
      }
      setLocationSheetOpen(false);
      const ok = await requestLocationPermission();
      if (!ok) return;
      setSending(true);
      const expiresAtIso = new Date(Date.now() + durationMs).toISOString();
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        let placeName: string | undefined;
        let placeAddress: string | undefined;
        try {
          const geo = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const g = geo[0];
          if (g) {
            const fmt = formatGeocodeForLocationMessage(g);
            placeName = fmt.placeName;
            placeAddress = fmt.placeAddress;
          }
        } catch {
          /* optional */
        }
        const messageId = await sendLocationMessage(
          chatId,
          user.uid,
          user.displayName || user.phoneNumber || 'User',
          user.photoURL || undefined,
          pos.coords.latitude,
          pos.coords.longitude,
          {
            ...recipientSendOptions,
            placeName,
            placeAddress,
            isLive: true,
            liveDurationMs: durationMs,
            replyTo: replyingTo
              ? {
                  messageId: replyingTo.id,
                  senderName: replyingTo.senderName,
                  text: replyingTo.text,
                  type: replyingTo.type,
                }
              : undefined,
          }
        );
        setReplyingTo(null);
        liveLocationCleanupRef.current?.();
        liveLocationCleanupRef.current = null;
        try {
          const stop = await startLiveLocationPublisher({
            chatId,
            messageId,
            expiresAt: expiresAtIso,
            onError: (err) => {
              if (__DEV__) console.warn('[chat] live location publish', err);
            },
          });
          liveLocationCleanupRef.current = stop;
        } catch (err) {
          if (__DEV__) console.warn('[chat] live location watcher', err);
        }
      } catch (e) {
        if (__DEV__) console.warn('[chat] send live location', e);
        Alert.alert(t('common.error'), t('location.failed'));
      } finally {
        setSending(false);
      }
    },
    [
      user,
      chatId,
      directPeerBlocked,
      requestLocationPermission,
      recipientSendOptions,
      replyingTo,
      t,
    ]
  );

  const openLocationOnMapPicker = useCallback(() => {
    setLocationSheetOpen(false);
    if (!chatId) return;
    router.push({
      pathname: '/(home)/(modal)/location-picker',
      params: { chatId },
    });
  }, [chatId, router]);

  // Gyw AI: always try to show the latest message on first open.
  const didInitialAiScrollRef = useRef(false);
  useEffect(() => {
    if (!isGywAiChat) {
      didInitialAiScrollRef.current = false;
      return;
    }
    if (!chatId || messages.length === 0) return;
    if (didInitialAiScrollRef.current) return;
    didInitialAiScrollRef.current = true;
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [isGywAiChat, chatId, messages.length]);

  const appLogoUri = useMemo(() => {
    try {
      return RNImage.resolveAssetSource(require('../../../assets/images/gyw_fox_logo.png')).uri;
    } catch {
      return undefined;
    }
  }, []);
  
  // Other user's profile + presence: defer past open transition (header can show cached title/avatar from chat).
  useEffect(() => {
    if (!otherParticipantId || chat?.type === 'group') {
      setOtherUser(null);
      return;
    }

    const uid = otherParticipantId;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const applyUser = (data: { id: string; lastActive?: any; [k: string]: any } | null) => {
      if (!data || !isMountedRef.current) return;
      if (chatId && !userDocFirstSnapRef.current) {
        userDocFirstSnapRef.current = true;
        markUserDocFirstSnapshot(chatId);
      }
      const lastActiveTimestamp = typeof data.lastActive === 'number' ? data.lastActive : (data.lastActive ? new Date(data.lastActive).getTime() : undefined);
      const lastActiveDate = typeof data.lastActive === 'string' ? data.lastActive : (data.lastActive ? new Date(data.lastActive).toISOString() : undefined);
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      const isUserOnline = lastActiveTimestamp != null && lastActiveTimestamp > fiveMinutesAgo;
      unstable_batchedUpdates(() => {
        usePresenceStore.getState().setOnline(uid, isUserOnline);
        if (lastActiveTimestamp != null) {
          usePresenceStore.getState().setLastActive(uid, lastActiveTimestamp);
        }
        setOtherUser({
          uid: data.id,
          ...data,
          lastActive: lastActiveDate,
        } as unknown as User);
      });
    };

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      if (Platform.OS !== 'web' && hasNativeFirestore) {
        unsubscribe = subscribeToUserDocNative(uid, applyUser, (error) => {
          if (__DEV__) console.error('User listener error:', error);
        });
      } else {
        const userRef = doc(db, 'users', uid);
        unsubscribe = onSnapshot(userRef, (userDoc) => {
          if (userDoc.exists() && isMountedRef.current) {
            const data = userDoc.data();
            applyUser({
              id: userDoc.id,
              ...data,
              lastActive: data.lastActive?.toDate?.()?.toISOString() || data.lastActive,
              createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
              updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
            });
          }
        }, (error) => {
          if (__DEV__) console.error('User listener error:', error);
        });
      }
    });

    return () => {
      cancelled = true;
      task.cancel?.();
      if (unsubscribe) unsubscribe();
    };
  }, [otherParticipantId, chat?.type]);
  
  /** Firestore typing — never write on every keystroke (was blocking UI / network). */
  const typingFirestoreTimersRef = useRef<{
    toTrue?: ReturnType<typeof setTimeout>;
    toFalse?: ReturnType<typeof setTimeout>;
  }>({});
  useEffect(() => {
    if (!chatId || !user) return;
    const t = typingFirestoreTimersRef.current;
    const clearTypingTimers = () => {
      if (t.toTrue) {
        clearTimeout(t.toTrue);
        t.toTrue = undefined;
      }
      if (t.toFalse) {
        clearTimeout(t.toFalse);
        t.toFalse = undefined;
      }
    };

    if (!messageText.trim()) {
      clearTypingTimers();
      setTypingIndicator(chatId, user.uid, false).catch(() => {});
      return;
    }

    if (!t.toTrue) {
      t.toTrue = setTimeout(() => {
        t.toTrue = undefined;
        setTypingIndicator(chatId, user.uid, true).catch(() => {});
      }, 350);
    }
    if (t.toFalse) clearTimeout(t.toFalse);
    t.toFalse = setTimeout(() => {
      t.toFalse = undefined;
      setTypingIndicator(chatId, user.uid, false).catch(() => {});
    }, 2000);

    return clearTypingTimers;
  }, [messageText, chatId, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !chatId) {
        return () => {};
      }
      setAndroidForegroundChatId(chatId);
      return () => setAndroidForegroundChatId(null);
    }, [chatId]),
  );

  useEffect(() => {
    if (Platform.OS !== 'android' || markRead !== '1' || !chatId) return;
    void clearAndroidChatNotifications(chatId);
  }, [markRead, chatId]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !chatId || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await consumeAndroidPendingReplyJson();
        if (cancelled || !raw) return;
        const o = JSON.parse(raw) as { chatId?: string; body?: string };
        if (o.chatId !== chatId || !o.body?.trim()) return;
        setMessageText(o.body);
        requestAnimationFrame(() => textInputRef.current?.focus());
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, user?.uid]);

  useEffect(() => {
    if (!chatId || !user?.uid) return;
    const cid = chatId;
    const uid = user.uid;
    return () => {
      setTypingIndicator(cid, uid, false).catch(() => {});
    };
  }, [chatId, user?.uid]);

  // Cleanup recording when screen loses focus or app backgrounds
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
          setRecording(null);
          setIsRecording(false);
          setIsRecordingLocked(false);
        }
        stopAllAudioPlayback().catch(() => {});
      };
    }, [])
  );

  // Use refs so the AppState listener never needs to re-register on recording state changes.
  const isRecordingRef = useRef(isRecording);
  const isRecordingLockedRef = useRef(isRecordingLocked);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isRecordingLockedRef.current = isRecordingLocked; }, [isRecordingLocked]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active' && (isRecordingRef.current || isRecordingLockedRef.current)) {
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
          recordingRef.current = null;
          setRecording(null);
          setIsRecording(false);
          setIsRecordingLocked(false);
        }
      }
    });
    return () => sub.remove();
  }, []);
  
  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);
  
  // Mark messages as read (microtask — do not wait for navigation to finish).
  useEffect(() => {
    if (user && chatId && messages.length > 0) {
      queueMicrotask(() => {
        markMessagesAsRead(chatId, user.uid).catch(() => {});
      });
    }
  }, [chatId, user?.uid, messages.length]);
  
  // Memoize incoming messages
  const incomingMessages = useMemo(() => {
    if (!user) return [];
    return messages.filter(
      (m) =>
        m.senderId !== user.uid &&
        m.status !== 'delivered' &&
        m.status !== 'seen' &&
        m.status !== 'pending' &&
        m.status !== 'failed'
    );
  }, [messages, user?.uid]);
  
  // Listen for real-time status updates on incoming messages
  useEffect(() => {
    if (!chatId || !user || incomingMessages.length === 0) return;
    
    queueMicrotask(() => {
      const pending = incomingMessages.filter(m => !deliveredMessageIdsRef.current.has(m.id));
      pending.forEach(m => deliveredMessageIdsRef.current.add(m.id));
      Promise.all(
        pending.map(m =>
          markMessageAsDelivered(chatId, m.id).catch(() => {
            deliveredMessageIdsRef.current.delete(m.id);
          })
        )
      );
    });
  }, [incomingMessages, chatId, user?.uid]);

  useEffect(() => {
    RNAnimated.timing(mediaComposerAnim, {
      toValue: mediaComposerVisible ? 1 : 0,
      duration: mediaComposerVisible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mediaComposerVisible, mediaComposerAnim]);

  useEffect(() => {
    return () => {
      if (mediaProgressRef.current) {
        clearInterval(mediaProgressRef.current);
        mediaProgressRef.current = null;
      }
    };
  }, []);

  const openImageComposer = useCallback((uri: string, dimensions?: { width: number; height: number }) => {
    if (!uri) return;
    setMediaComposerCaption('');
    setMediaComposerAiMode('auto');
    setMediaComposerProgress(0);
    setMediaComposerUri(uri);
    setMediaComposerDimensions(dimensions ?? null);
    setMediaComposerVisible(true);
  }, []);

  const closeImageComposer = useCallback(() => {
    if (mediaComposerSending) return;
    setMediaComposerVisible(false);
    setMediaComposerUri(null);
    setMediaComposerDimensions(null);
    setMediaComposerCaption('');
    setMediaComposerProgress(0);
  }, [mediaComposerSending]);

  const compressImageForUpload = useCallback(async (uri: string): Promise<string> => {
    try {
      const manipulated = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1080 } }],
        {
          compress: 0.78,
          format: ImageManipulator.SaveFormat.JPEG,
        }
      );
      return manipulated?.uri || uri;
    } catch {
      return uri;
    }
  }, []);

  const handleSendComposedImage = useCallback(async () => {
    if (!chatId || !user || !mediaComposerUri) return;
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    if (mediaSendingGuardRef.current) return;
    mediaSendingGuardRef.current = true;
    setMediaComposerSending(true);
    setSending(true);
    setMediaComposerProgress(0.08);
    if (mediaProgressRef.current) {
      clearInterval(mediaProgressRef.current);
      mediaProgressRef.current = null;
    }
    mediaProgressRef.current = setInterval(() => {
      setMediaComposerProgress((p) => (p < 0.9 ? p + 0.06 : p));
    }, 180);
    try {
      const uploadUri = await compressImageForUpload(mediaComposerUri);
      // Compute post-compression dimensions (resize to max 1080px wide, preserving aspect ratio)
      let imageDimensions: { imageWidth?: number; imageHeight?: number } = {};
      if (mediaComposerDimensions) {
        const { width: srcW, height: srcH } = mediaComposerDimensions;
        if (srcW > 0 && srcH > 0) {
          const scale = srcW > 1080 ? 1080 / srcW : 1;
          imageDimensions = {
            imageWidth: Math.round(srcW * scale),
            imageHeight: Math.round(srcH * scale),
          };
        }
      }
      const mediaSendOptions: SendChatMessageOptions | undefined =
        recipientSendOptions || isGywAiChat
          ? {
              ...(recipientSendOptions ?? {}),
              ...(isGywAiChat
                ? {
                    gywAiMultimodal: {
                      aiMode: mediaComposerAiMode,
                      prompt: mediaComposerCaption.trim() || undefined,
                    },
                  }
                : {}),
            }
          : undefined;

      const userImageMessageId = await sendMediaMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL || undefined,
        uploadUri,
        'image',
        mediaComposerCaption.trim() || undefined,
        replyingTo
          ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            }
          : undefined,
        Object.keys(imageDimensions).length > 0 ? imageDimensions : undefined,
        mediaSendOptions
      );

      if (isGywAiChat && userImageMessageId) {
        const aiTempId = `ai-pending-mm-${Date.now()}`;
        const workingLabel = t('messages.gywAiImageWorking');
        useChatStore.getState().addMessage(chatId, {
          id: aiTempId,
          chatId,
          senderId: GYW_AI_SYSTEM_ID,
          senderName: GYW_AI_DISPLAY_NAME,
          senderAvatar: undefined,
          isAI: true,
          text: workingLabel,
          type: 'text',
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          readBy: [GYW_AI_SYSTEM_ID],
          status: 'pending',
          aiMultimodalSourceMessageId: userImageMessageId,
        });

        requestGywAiMultimodal({ chatId, userMessageId: userImageMessageId })
          .then((res) => {
            if (res.kind === 'image' && res.imageUrl) {
              useChatStore.getState().updateMessage(chatId, aiTempId, {
                id: res.messageId,
                type: 'image',
                imageUrl: res.imageUrl,
                text: res.text,
                status: 'sent',
                aiError: undefined,
                aiMultimodalSourceMessageId: userImageMessageId,
              });
            } else {
              useChatStore.getState().updateMessage(chatId, aiTempId, {
                id: res.messageId,
                type: 'text',
                text: res.text ?? '',
                imageUrl: undefined,
                status: 'sent',
                aiError: undefined,
                aiMultimodalSourceMessageId: userImageMessageId,
              });
            }
          })
          .catch((e) => {
            if (__DEV__) console.error('Gyw AI multimodal error:', e);
            useChatStore.getState().updateMessage(chatId, aiTempId, {
              status: 'failed',
              text: t('messages.gywAiUnavailableRetry'),
              aiError: 'unavailable',
            });
          });
      }

      setReplyingTo(null);
      setMediaComposerProgress(1);
      setMediaComposerVisible(false);
      setMediaComposerUri(null);
      setMediaComposerCaption('');
      setMediaComposerAiMode('auto');
      if (pendingMedia === 'true') {
        await AsyncStorage.removeItem('pendingMediaForChannel').catch(() => {});
      }
    } catch (error) {
      if (__DEV__) console.error('Error sending composed image:', error);
      if (error instanceof BlockedPeerSendError) {
        Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      } else {
        Alert.alert(t('common.error'), t('messages.failedToSendImage'));
      }
    } finally {
      if (mediaProgressRef.current) {
        clearInterval(mediaProgressRef.current);
        mediaProgressRef.current = null;
      }
      mediaSendingGuardRef.current = false;
      if (isMountedRef.current) {
        setMediaComposerSending(false);
        setMediaComposerProgress(0);
        setSending(false);
      }
    }
  }, [
    chatId,
    user,
    mediaComposerUri,
    mediaComposerDimensions,
    mediaComposerCaption,
    compressImageForUpload,
    replyingTo,
    recipientSendOptions,
    pendingMedia,
    t,
    directPeerBlocked,
    isGywAiChat,
    mediaComposerAiMode,
  ]);
  
  
  // Handle pending media
  useEffect(() => {
    const handlePendingMedia = async () => {
      if (pendingMedia === 'true' && user && chatId) {
        if (directPeerBlocked) {
          await AsyncStorage.removeItem('pendingMediaForChannel').catch(() => {});
          return;
        }
        try {
          const stored = await AsyncStorage.getItem('pendingMediaForChannel');
          if (stored) {
            const { media: pendingMediaData } = JSON.parse(stored);
            if (pendingMediaData) {
              const mime = pendingMediaData.type as string | undefined;
              const mediaType: 'video' | 'image' | 'file' | 'document' =
                mime?.includes('video') ? 'video' :
                mime?.includes('image') ? 'image' :
                isDocumentLikeMime(mime) ? 'document' : 'file';
              if (mediaType === 'image') {
                await AsyncStorage.removeItem('pendingMediaForChannel');
                openImageComposer(pendingMediaData.uri);
                return;
              }
              const pendingName: string | undefined =
                pendingMediaData.fileName || pendingMediaData.name;
              const pendingSize: number | undefined =
                typeof pendingMediaData.size === 'number' ? pendingMediaData.size : undefined;
              const ext = resolveDocumentExtension(pendingName, mime);
              await sendMediaMessage(
                chatId,
                user.uid,
                user?.displayName || user?.phoneNumber || 'User',
                user?.photoURL || undefined,
                pendingMediaData.uri,
                mediaType,
                pendingName,
                undefined,
                mediaType === 'document'
                  ? {
                      mimeType: mime || 'application/octet-stream',
                      ...(typeof pendingSize === 'number' ? { fileSize: pendingSize } : {}),
                      extension: ext,
                    }
                  : undefined,
                recipientSendOptions
              );
              await AsyncStorage.removeItem('pendingMediaForChannel');
            }
          }
        } catch (error) {
          if (__DEV__) console.error('Error sending pending media:', error);
        }
      }
    };
    
    handlePendingMedia();
  }, [pendingMedia, chatId, user, recipientSendOptions, openImageComposer, directPeerBlocked]);
  
  // ========================================
  // HANDLERS
  // ========================================
  
  const handleSendMessage = () => {
    if (accessRevoked) return;
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    if (chat && user && !chat.participants.includes(user.uid)) return;
    if (!chatId || !messageText.trim() || !user) return;

    const text = messageText.trim();
    const replySnapshot = replyingTo
      ? {
          messageId: replyingTo.id,
          senderName: replyingTo.senderName,
          text: replyingTo.text,
          type: replyingTo.type,
        }
      : undefined;

    const tempId = `pending-${Date.now()}`;
    const now = new Date().toISOString();

    // Optimistic UI first — do not await Firestore before this commit (WhatsApp-style).
    const optimisticMessage: ChatMessage = {
      id: tempId,
      chatId,
      senderId: user.uid,
      senderName: user?.displayName || user?.phoneNumber || 'User',
      senderAvatar: user?.photoURL ?? undefined,
      text,
      type: 'text',
      createdAt: now,
      sentAt: now,
      readBy: [user.uid],
      status: 'pending',
      replyTo: replySnapshot,
    };
    unstable_batchedUpdates(() => {
      suppressNextBottomScrollRef.current = true;
      useChatStore.getState().addMessage(chatId, optimisticMessage);
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      setMessageText('');
      updateComposerSendMic(false);
      setReplyingTo(null);
      setShowEmojiPicker(false);
    });
    if (chatId) AsyncStorage.removeItem(`draft_${chatId}`).catch(() => {});
    queueMicrotask(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });

    pendingTextSendInteractionRef.current = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const messageId = await sendMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            text,
            replySnapshot,
            recipientSendOptions
          );
          useChatStore.getState().updateMessage(chatId, tempId, { id: messageId, status: 'sent' });

          if (isGywAiChat) {
            const aiTempId = `ai-pending-${Date.now()}`;
            const aiOptimistic: ChatMessage = {
              id: aiTempId,
              chatId,
              senderId: GYW_AI_SYSTEM_ID,
              senderName: GYW_AI_DISPLAY_NAME,
              senderAvatar: undefined,
              isAI: true,
              text: 'Gyw AI is thinking…',
              type: 'text',
              createdAt: new Date().toISOString(),
              sentAt: new Date().toISOString(),
              readBy: [GYW_AI_SYSTEM_ID],
              status: 'pending',
            };
            useChatStore.getState().addMessage(chatId, aiOptimistic);

            requestGywAiReply({ chatId, text, contextLimit: 10 })
              .then(({ messageId: aiMessageId, text: aiText }) => {
                useChatStore.getState().updateMessage(chatId, aiTempId, {
                  id: aiMessageId,
                  text: aiText,
                  status: 'sent',
                  aiError: undefined,
                });
              })
              .catch((e) => {
                if (__DEV__) console.error('Gyw AI error:', e);
                useChatStore.getState().updateMessage(chatId, aiTempId, {
                  status: 'failed',
                  text: t('messages.gywAiUnavailableRetry'),
                  aiError: 'unavailable',
                });
              });
          }
        } catch (error) {
          if (__DEV__) console.error('Error sending message:', error);
          useChatStore.getState().updateMessage(chatId, tempId, { status: 'failed' });
          if (error instanceof BlockedPeerSendError) {
            Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
          } else {
            Alert.alert(t('common.error'), t('messages.failedToSend'));
          }
        }
      })();
    });
  };

  const handleRetryAi = useCallback(async (message: ChatMessage) => {
    if (!chatId || !user || !isGywAiChat) return;

    if (message.aiMultimodalSourceMessageId) {
      const srcId = message.aiMultimodalSourceMessageId;
      useChatStore.getState().updateMessage(chatId, message.id, {
        status: 'pending',
        text: t('messages.gywAiImageWorking'),
        aiError: undefined,
      });
      try {
        const res = await requestGywAiMultimodal({ chatId, userMessageId: srcId });
        if (res.kind === 'image' && res.imageUrl) {
          useChatStore.getState().updateMessage(chatId, message.id, {
            id: res.messageId,
            type: 'image',
            imageUrl: res.imageUrl,
            text: res.text,
            status: 'sent',
            aiError: undefined,
            aiMultimodalSourceMessageId: srcId,
          });
        } else {
          useChatStore.getState().updateMessage(chatId, message.id, {
            id: res.messageId,
            type: 'text',
            text: res.text ?? '',
            imageUrl: undefined,
            status: 'sent',
            aiError: undefined,
            aiMultimodalSourceMessageId: srcId,
          });
        }
      } catch (e) {
        if (__DEV__) console.error('Gyw AI multimodal retry error:', e);
        useChatStore.getState().updateMessage(chatId, message.id, {
          status: 'failed',
          text: t('messages.gywAiUnavailableRetry'),
          aiError: 'unavailable',
        });
      }
      return;
    }

    const lastUserText = (() => {
      const msgs = useChatStore.getState().messagesByChat[chatId] || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m?.type === 'text' && m?.senderId === user.uid && m?.text?.trim()) return m.text.trim();
      }
      return '';
    })();
    if (!lastUserText) return;

    useChatStore.getState().updateMessage(chatId, message.id, {
      status: 'pending',
      text: 'Gyw AI is thinking…',
      aiError: undefined,
    });

    try {
      const { messageId, text } = await requestGywAiReply({ chatId, text: lastUserText, contextLimit: 10 });
      useChatStore.getState().updateMessage(chatId, message.id, { id: messageId, text, status: 'sent' });
    } catch (e) {
      if (__DEV__) console.error('Gyw AI retry error:', e);
      useChatStore.getState().updateMessage(chatId, message.id, {
        status: 'failed',
        text: t('messages.gywAiUnavailableRetry'),
        aiError: 'unavailable',
      });
    }
  }, [chatId, user, isGywAiChat, t]);
  
  const handleEmojiSelect = (emoji: string) => {
    setMessageText((prev) => {
      const raw = prev + emoji;
      const next = raw.length > 4000 ? raw.slice(0, 4000) : raw;
      updateComposerSendMic(next.length > 0);
      return next;
    });
    textInputRef.current?.focus();
  };
  
  const handleSwipeToReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message);
  }, []);

  const handleLongPress = useCallback((message: ChatMessage) => {
    if (message.deleted) return;
    setBodyContextMessage(null);
    setActionMenuMessage(message);
  }, []);

  // Stable tap handlers — no deps, never recreated, safe to pass directly to BodySwipeableRow
  const handleTapStable = useCallback(() => {
    setReplyingTo(null);
    setBodyContextMessage(null);
  }, []);

  const handleDoubleTapItem = useCallback((message: ChatMessage) => {
    setReactionTrayMessageId(message.id);
  }, []);
  
  const handleReactionSelect = useCallback(async (messageId: string, emoji: string) => {
    if (!user || !chatId) return;
    try {
      await toggleReaction(chatId, messageId, user.uid, emoji);
    } catch (error) {
      if (__DEV__) console.error('Error toggling reaction:', error);
    }
  }, [user, chatId]);

  const handleRetryMessage = useCallback(async (message: ChatMessage) => {
    if (!user || !chatId || !message.text || message.senderId !== user.uid) return;
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    setSending(true);
    try {
      const messageId = await sendMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL || undefined,
        message.text,
        message.replyTo ? {
          messageId: message.replyTo.messageId,
          senderName: message.replyTo.senderName,
          text: message.replyTo.text,
          type: message.replyTo.type,
        } : undefined,
        recipientSendOptions
      );
      useChatStore.getState().updateMessage(chatId, message.id, { id: messageId, status: 'sent' });
    } catch (error) {
      if (__DEV__) console.error('Retry send error:', error);
      if (error instanceof BlockedPeerSendError) {
        Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      } else {
        Alert.alert(t('common.error'), t('messages.failedToSend'));
      }
    } finally {
      setSending(false);
    }
  }, [user, chatId, t, directPeerBlocked]);
  
  const getRecordingDuration = useCallback(() => {
    if (!recordingRef.current) return 0;
    return (Date.now() - lastStartTimestampRef.current) / 1000;
  }, []);

  const handleReplyPress = useCallback((messageId: string) => {
    // Read from ref — always current, never stale, no dep on messages array needed.
    const index = messagesRef.current.findIndex(msg => msg.id === messageId);
    if (index !== -1 && listRef.current) {
      listRef.current.scrollToIndex({ index, animated: true });
    }
  }, []); // stable for the lifetime of the screen
  
  // ========================================
  // AUDIO RECORDING
  // ========================================
  
  const cleanupRecording = async () => {
    try {
      const rec = recordingRef.current;
      setRecording(null);
      recordingRef.current = null;
      setIsRecording(false);
      
      if (rec) {
        try {
          await rec.stopAndUnloadAsync().catch(() => {});
        } catch (e) {
          try {
            await (rec as any).unloadAsync().catch(() => {});
          } catch {}
        }
      }
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      }).catch(() => {});
    } catch (e) {
      if (__DEV__) console.error('Cleanup recording error:', e);
    }
  };
  
  const startRecording = async (): Promise<boolean> => {
    if (composerInputLocked) return false;
    if (isRecording || isStartingRef.current || isCleaningUpRef.current) return false;
    
    isMicPressedRef.current = true;
    isStartingRef.current = true;
    
    try {
      const perm = await Audio.getPermissionsAsync();
      if (perm.status === 'denied') {
        Alert.alert(
          t('common.permissionRequired'),
          'Microphone access is required to send voice notes. Please enable it in Settings.',
          [{ text: t('common.ok') }]
        );
        isStartingRef.current = false;
        return false;
      }
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('common.permissionRequired'),
          'Microphone access is required to send voice notes.',
          [{ text: t('common.ok') }]
        );
        isStartingRef.current = false;
        return false;
      }
      
      await cleanupRecording();
      await new Promise(resolve => setTimeout(resolve, 150));
      
      if (!isMicPressedRef.current) {
        isStartingRef.current = false;
        await cleanupRecording();
        return false;
      }
      
      // Set audio mode
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      
      if (!isMicPressedRef.current) {
        isStartingRef.current = false;
        await cleanupRecording();
        return false;
      }
      
      // Start recording
      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      
      if (!isMicPressedRef.current) {
        await newRecording.stopAndUnloadAsync().catch(() => {});
        isStartingRef.current = false;
        return false;
      }
      
      recordingRef.current = newRecording;
      setRecording(newRecording);
      setIsRecording(true);
      setIsRecordingLocked(false);
      lastStartTimestampRef.current = Date.now();
      return true;
    } catch (error: any) {
      if (__DEV__) console.error('Failed to start recording:', error);
      
      if (error.message?.includes('Only one Recording')) {
        await cleanupRecording();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          if (!isMicPressedRef.current) {
            isStartingRef.current = false;
            return false;
          }

          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
          });

          const { recording: retryRec } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );

          if (!isMicPressedRef.current) {
            await retryRec.stopAndUnloadAsync().catch(() => {});
            isStartingRef.current = false;
            return false;
          }
          
          recordingRef.current = retryRec;
          setRecording(retryRec);
          setIsRecording(true);
          lastStartTimestampRef.current = Date.now();
        } catch (retryErr) {
          if (__DEV__) console.error('Emergency reset failed:', retryErr);
          Alert.alert(t('common.error'), t('messages.microphoneUnavailable'));
        }
      } else {
        Alert.alert(t('common.error'), t('messages.failedToRecord'));
      }
      return false;
    } finally {
      isStartingRef.current = false;
    }
  };
  
  const stopRecording = async (cancel: boolean = false) => {
    isMicPressedRef.current = false;
    setIsRecordingLocked(false);
    
    // Wait for startRecording to finish if in progress
    let waitAttempts = 0;
    while (isStartingRef.current && waitAttempts < 15) {
      await new Promise(resolve => setTimeout(resolve, 150));
      waitAttempts++;
    }
    
    // ⚠️ CRITICAL FIX: Capture reference BEFORE async operations
    const currentRecording = recordingRef.current;
    
    if (!currentRecording) {
      setIsRecording(false);
      return;
    }
    
    if (isCleaningUpRef.current) return;
    
    // Guard against stopping too fast
    const timeSinceStart = Date.now() - lastStartTimestampRef.current;
    if (timeSinceStart < 300) {
      await new Promise(resolve => setTimeout(resolve, 300 - timeSinceStart));
    }
    
    isCleaningUpRef.current = true;
    
    try {
      setIsRecording(false);
      
      // Get status and duration
      let duration = 0;
      let uri = null;
      
      try {
        const status = await currentRecording.getStatusAsync();
        if (status) {
          duration = (status.durationMillis || 0) / 1000;
          uri = currentRecording.getURI();
        }
      } catch (e: any) {
        if (!e.message?.includes('Recorder does not exist')) {
          if (__DEV__) console.error('Get status error:', e);
        }
      }
      
      // Stop and unload
      try {
        await currentRecording.stopAndUnloadAsync().catch(() => {});
      } catch (e: any) {
        if (!e.message?.includes('Recorder does not exist')) {
          if (__DEV__) console.error('Stop recording error:', e);
        }
      }
      
      setRecording(null);
      recordingRef.current = null;
      
      if (!cancel && uri && user && duration >= 0.5) {
        if (directPeerBlocked) {
          Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
          return;
        }
        setSending(true);
        try {
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            uri,
            'audio',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined,
            { audioDuration: duration },
            recipientSendOptions
          );
          setReplyingTo(null);
        } catch (err) {
          if (__DEV__) console.error('Error sending audio:', err);
          if (err instanceof BlockedPeerSendError) {
            Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
          } else {
            Alert.alert(t('common.error'), t('messages.failedToSendAudio'));
          }
        } finally {
          if (isMountedRef.current) setSending(false);
        }
      }
    } catch (error: any) {
      if (!error.message?.includes('Recorder does not exist')) {
        if (__DEV__) console.error('Failed to stop recording:', error);
      }
      await cleanupRecording();
    } finally {
      isCleaningUpRef.current = false;
    }
  };
  
  // ========================================
  // MEDIA PICKERS
  // ========================================
  
  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCameraRoll'));
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setShowAttachOptions(false);
        const asset = result.assets[0];
        openImageComposer(asset.uri, asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined);
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking image:', error);
    }
  };
  
  const handlePickVideo = async () => {
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCameraRoll'));
        return;
      }
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 60,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setSending(true);
        try {
          const videoUri = result.assets[0].uri;
          // Generate thumbnail from first frame (non-blocking — failure is silently ignored)
          let thumbnailUri: string | undefined;
          try {
            const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0, quality: 0.6 });
            thumbnailUri = thumb.uri;
          } catch {
            // Thumbnail generation failed — video still uploads, shows black placeholder
          }
          await sendMediaMessage(
            chatId,
            user.uid,
            user?.displayName || user?.phoneNumber || 'User',
            user?.photoURL || undefined,
            videoUri,
            'video',
            undefined,
            replyingTo ? {
              messageId: replyingTo.id,
              senderName: replyingTo.senderName,
              text: replyingTo.text,
              type: replyingTo.type,
            } : undefined,
            thumbnailUri ? { thumbnailUri } : undefined,
            recipientSendOptions
          );
          setReplyingTo(null);
        } catch (error) {
          if (__DEV__) console.error('Error sending video:', error);
          if (error instanceof BlockedPeerSendError) {
            Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
          } else {
            Alert.alert(t('common.error'), t('messages.failedToSendVideo'));
          }
        } finally {
          if (isMountedRef.current) {
            setSending(false);
          }
          setShowAttachOptions(false);
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking video:', error);
    }
  };

  const handlePickDocument = useCallback(async () => {
    if (directPeerBlocked) {
      Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
      return;
    }
    if (!user || !chatId) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...DOCUMENT_PICKER_MIME_TYPES],
        // Android: content:// grants read access to the picker result; Storage `putFile` reads later in another
        // context → Permission Denial. Copying yields file:// under app cache. iOS usually returns a readable tmp path.
        copyToCacheDirectory: Platform.OS === 'android',
        multiple: false,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert(t('common.error'), t('messages.documentInvalid'));
        return;
      }

      const name = asset.name?.trim() ? asset.name.trim() : 'document';
      const mimeType = asset.mimeType || 'application/octet-stream';
      const size = typeof asset.size === 'number' ? asset.size : 0;

      if (!isAllowedChatDocument(mimeType, name)) {
        Alert.alert(t('common.error'), t('messages.documentUnsupported'));
        return;
      }

      if (size > MAX_CHAT_DOCUMENT_BYTES) {
        Alert.alert(t('common.error'), t('messages.documentTooLarge'));
        return;
      }

      const extension = resolveDocumentExtension(name, mimeType);

      setShowAttachOptions(false);
      setSending(true);
      try {
        await sendMediaMessage(
          chatId,
          user.uid,
          user?.displayName || user?.phoneNumber || 'User',
          user?.photoURL || undefined,
          asset.uri,
          'document',
          name,
          replyingTo
            ? {
                messageId: replyingTo.id,
                senderName: replyingTo.senderName,
                text: replyingTo.text,
                type: replyingTo.type,
              }
            : undefined,
          {
            mimeType,
            fileSize: size,
            extension,
          },
          recipientSendOptions
        );
        setReplyingTo(null);
      } catch (error) {
        if (__DEV__) console.error('Error sending document:', error);
        if (error instanceof BlockedPeerSendError) {
          Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
        } else {
          Alert.alert(t('common.error'), t('messages.failedToSendDocument'));
        }
      } finally {
        if (isMountedRef.current) setSending(false);
      }
    } catch (error) {
      if (__DEV__) console.error('Error picking document:', error);
      Alert.alert(t('common.error'), t('messages.failedToSendDocument'));
    }
  }, [chatId, user, directPeerBlocked, t, replyingTo, recipientSendOptions]);

  const handleOpenDocument = useCallback(
    (message: ChatMessage) => {
      openChatDocument(message, t, chatId ? { nav: { push: router.push }, chatId } : undefined);
    },
    [t, chatId, router]
  );
  
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('common.permissionRequired'), t('messages.permissionCamera'));
        return;
      }
      
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets[0] && user) {
        setShowAttachOptions(false);
        const asset = result.assets[0];
        openImageComposer(asset.uri, asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined);
      }
    } catch (error) {
      if (__DEV__) console.error('Error taking photo:', error);
    }
  };
  
  // ========================================
  // MEMOIZED VALUES
  // ========================================
  
  // Boolean selector: avoids re-rendering the whole chat on unrelated chats' typing map churn
  const typingActive = usePresenceStore((s) => {
    if (!chatId) return false;
    return s.getTypingNames(chatId, user?.uid).length > 0;
  });

  const typingUiActive = useMemo(
    () => messageStreamHydrated && typingActive,
    [messageStreamHydrated, typingActive]
  );

  const displayName = useMemo(() => {
    if (!chat) return 'Chat';
    if (chat.type === 'group') return chat.name || 'Group Chat';
    if (isGywAiChat) return GYW_AI_DISPLAY_NAME;
    if (otherUser) {
      return `${otherUser.firstName} ${otherUser.lastName}`.trim() || otherUser.username || 'Unknown';
    }
    const otherParticipant = chat.participants.find(p => p !== user?.uid);
    return chat.participantData?.[otherParticipant || '']?.name || 'Unknown';
  }, [chat, otherUser, user?.uid, isGywAiChat]);

  const displayAvatar = useMemo(() => {
    if (!chat) return undefined;
    if (chat.type === 'group') return chat.avatar;
    if (isGywAiChat) return appLogoUri;
    return otherUser?.avatar || chat.participantData?.[otherParticipantId || '']?.avatar;
  }, [chat, otherUser, otherParticipantId, isGywAiChat, appLogoUri]);

  const isOnlineStatus = useMemo(() => {
    try {
      if (!otherUser?.lastActive || chat?.type === 'group') return false;
      const presenceStore = usePresenceStore.getState();
      if (otherParticipantId && presenceStore.onlineUsers?.[otherParticipantId] !== undefined) {
        return presenceStore.onlineUsers[otherParticipantId];
      }
      const lastActive = otherUser.lastActive ? new Date(otherUser.lastActive).getTime() : 0;
      return Date.now() - lastActive < 5 * 60 * 1000;
    } catch {
      return false;
    }
  }, [otherUser?.lastActive, chat?.type, otherParticipantId]);

  const lastSeenText = useMemo(() => {
    try {
      if (!otherUser?.lastActive || chat?.type === 'group') return '';
      if (isOnlineStatus) return '';
      const lastActive = otherUser.lastActive ? new Date(otherUser.lastActive).getTime() : 0;
      const now = Date.now();
      const diffMs = now - lastActive;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffMins < 1) return t('messages.lastSeenJustNow');
      if (diffMins < 60) return t('messages.lastSeenMinutesAgo', { count: diffMins });
      if (diffHours < 24) return t('messages.lastSeenHoursAgo', { count: diffHours });
      if (diffDays < 7) return t('messages.lastSeenDaysAgo', { count: diffDays });
      const dateStr = new Date(lastActive).toLocaleDateString(i18n.language || 'en', {
        month: 'short',
        day: 'numeric',
      });
      return t('messages.lastSeenOn', { date: dateStr });
    } catch {
      return '';
    }
  }, [otherUser?.lastActive, chat?.type, isOnlineStatus, t, i18n.language]);

  const headerLastSeenLine = useMemo(() => {
    if (chat?.type === 'group') {
      const n = chat.participantCount ?? chat.participants?.length ?? 0;
      return t('groups.memberCount', { count: n });
    }
    if (isGywAiChat) return GYW_AI_DISPLAY_NAME;
    return lastSeenText || '\u00a0';
  }, [
    chat?.type,
    chat?.participantCount,
    chat?.participants?.length,
    isGywAiChat,
    lastSeenText,
    t,
  ]);

  const chatMuted = useChatMetaStore(
    useCallback((s) => (chatId ? !!s.byId[chatId]?.muted : false), [chatId])
  );
  const headerMuteRowLabel = useMemo(
    () => (chatMuted ? t('chats.listActions.unmute') : t('chats.listActions.mute')),
    [chatMuted, t]
  );

  const handleHeaderViewContact = useCallback(() => {
    if (!chat) return;
    if (chat.type === 'group') {
      setGroupMembersOpen(true);
      return;
    }
    if (isGywAiChat) {
      Alert.alert(t('messages.viewContact'), t('messages.gywAiNoContact'));
      return;
    }
    const u = otherUser?.username?.trim();
    if (u) {
      router.push({
        pathname: '/(home)/(modal)/find-by-username' as never,
        params: { initialQuery: u } as never,
      });
      return;
    }
    Alert.alert(t('messages.viewContact'), t('messages.contactNoUsername'));
  }, [chat, isGywAiChat, otherUser, router, t]);

  const handleHeaderMuteToggle = useCallback(async () => {
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

  const handleHeaderOpenSearch = useCallback(() => {
    setInChatSearchOpen(true);
    setInChatSearchQuery('');
    setSearchHighlightMessageId(null);
    inChatSearchCursorRef.current = -1;
  }, []);

  const handleHeaderMorePlaceholder = useCallback(() => {
    Alert.alert(t('messages.moreMenu'), t('messages.moreMenuPlaceholder'));
  }, [t]);

  const handleOpenUserProfile = useCallback(() => {
    if (!chatId) return;
    if (chat?.type === 'group') return;
    if (isGywAiChat) {
      Alert.alert(t('messages.viewContact'), t('messages.gywAiNoContact'));
      return;
    }
    if (!otherParticipantId) return;
    router.push({
      pathname: '/(home)/user-profile' as never,
      params: { userId: otherParticipantId, chatId, chatType: 'direct' } as never,
    });
  }, [chatId, chat?.type, isGywAiChat, otherParticipantId, router, t]);

  const headerOpenProfilePress = useMemo(
    () =>
      chat?.type === 'direct' && !isGywAiChat && otherParticipantId ? handleOpenUserProfile : undefined,
    [chat?.type, isGywAiChat, otherParticipantId, handleOpenUserProfile]
  );

  const handleCloseInChatSearch = useCallback(() => {
    setInChatSearchOpen(false);
    setInChatSearchQuery('');
    setSearchHighlightMessageId(null);
    inChatSearchCursorRef.current = -1;
  }, []);

  const runInChatFind = useCallback(() => {
    const q = inChatSearchQuery.trim().toLowerCase();
    if (!q) {
      Alert.alert(t('messages.searchInChat'), t('messages.searchNeedQuery'));
      return;
    }
    const msgs = messagesRef.current;
    if (!msgs.length) return;
    const start = inChatSearchCursorRef.current;
    for (let step = 1; step <= msgs.length; step++) {
      const i = (start + step) % msgs.length;
      const m = msgs[i];
      if (!m || m.type === 'system' || m.deleted || m.type === 'call') continue;
      const text = (m.text || '').toLowerCase();
      if (text.includes(q)) {
        inChatSearchCursorRef.current = i;
        setSearchHighlightMessageId(m.id);
        requestAnimationFrame(() => {
          listRef.current?.scrollToIndex({ index: i, animated: true, viewPosition: 0.35 });
        });
        return;
      }
    }
    Alert.alert(t('messages.searchInChat'), t('messages.searchNoMatch'));
  }, [inChatSearchQuery, t]);

  const listSearchExtraData = `${searchHighlightMessageId ?? ''}|${inChatSearchOpen ? 1 : 0}`;
  
  // ========================================
  // SCROLL & VIEWABILITY
  // ========================================
  
  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{ item: ChatMessage }> }) => {
    if (!user || !chatId) return;
    if (!messageStreamHydratedRef.current) return;

    viewableItems.forEach(({ item }) => {
      const message = item as ChatMessage;
      
      // Mark as delivered (include legacy messages with no status yet)
      if (message.senderId !== user.uid &&
          message.status !== 'delivered' &&
          message.status !== 'seen' &&
          message.status !== 'pending' &&
          message.status !== 'failed' &&
          !deliveredMessageIdsRef.current.has(message.id)) {
        deliveredMessageIdsRef.current.add(message.id);
        markMessageAsDelivered(chatId, message.id).catch(() => {});
      }
      
      // Mark as seen — pass hint data from store to skip redundant Firestore reads
      if (message.senderId !== user.uid &&
          message.status !== 'seen' &&
          !viewedMessageIdsRef.current.has(message.id)) {
        viewedMessageIdsRef.current.add(message.id);
        markMessageAsSeen(chatId, message.id, user.uid, {
          chatType: (chat?.type as 'direct' | 'group') ?? undefined,
          messageReadBy: message.readBy,
          messageSenderId: message.senderId,
          chatParticipants: chat?.participants,
        }).catch(() => {});
      }
    });
  }, [user?.uid, chatId, chat?.type, chat?.participants]);
  
  const handleMediaPress = useCallback((mediaUrl: string, mediaType: 'image' | 'video') => {
    if (mediaType === 'video') {
      setViewingImage(null);
      setViewingVideo(mediaUrl);
      return;
    }
    setViewingVideo(null);
    setViewingImage(mediaUrl);
  }, []);
  
  // Memoize keyExtractor for FlatList stability
  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  
  // Inverted list: index 0 = newest = always at offset 0. No initial scroll needed.
  const onListLayout = useCallback(() => {
    if (chatId) markFlatListLayout(chatId);
  }, [chatId]);

  const onContentSizeChange = useCallback(() => {
    if (!chatId || listContentSizedRef.current) return;
    if (messages.length === 0) return;
    listContentSizedRef.current = true;
    markFlatListContentSized(chatId, messages.length);
  }, [chatId, messages.length]);

  useEffect(() => {
    const prev = prevMessagesLengthRef.current;
    if (messages.length > prev && prev > 0 && isAtBottomRef.current) {
      if (suppressNextBottomScrollRef.current) {
        suppressNextBottomScrollRef.current = false;
      } else {
        // Android: animated scroll + keyboard resize often fight; iOS keeps a light animation.
        const animated = Platform.OS !== 'android';
        listRef.current?.scrollToOffset({ offset: 0, animated });
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);
  
  const viewabilityConfigMemo = useMemo(() => ({
    itemVisiblePercentThreshold: 50,
  }), []);
  
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMoreOlderMessagesRef = useRef(hasMoreOlderMessages);
  useEffect(() => { hasMoreOlderMessagesRef.current = hasMoreOlderMessages; }, [hasMoreOlderMessages]);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent ?? {};
    const contentOffsetY = contentOffset?.y ?? 0;
    const viewH = layoutMeasurement?.height ?? 0;
    const contentH = contentSize?.height ?? 0;
    const distFromBottom = contentH - viewH - contentOffsetY;

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      const msgs = messagesRef.current;
      const messagesLength = msgs.length;
      // Inverted: offset 0 = bottom (newest). Scrolling up increases offset.
      const atBottom = contentOffsetY < 50;
      const scrolledAwayFromBottom = contentOffsetY > 100;
      const distFromOldest = contentH - viewH - contentOffsetY;
      setIsAtBottom((prev) => (prev === atBottom ? prev : atBottom));
      const showFab = scrolledAwayFromBottom && messagesLength > 0;
      setShowNewMessagesButton((prev) => (prev === showFab ? prev : showFab));
      const showOlder = distFromOldest < 150 && messagesLength > 0 && hasMoreOlderMessagesRef.current;
      setShowLoadingOlderBanner((prev) => (prev === showOlder ? prev : showOlder));

      let nextLabel: string | null = null;
      if (messagesLength > 0 && contentOffsetY > 60) {
        const approxIdx = Math.min(Math.max(0, Math.floor(contentOffsetY / 72)), messagesLength - 1);
        const msg = msgs[approxIdx];
        if (msg?.createdAt) nextLabel = formatDateHeader(msg.createdAt);
      }
      setStickyDateLabel((prev) => (prev === nextLabel ? prev : nextLabel));
    }, 50);
  }, []);

  // Count new messages when scrolled up (reset when at bottom)
  useEffect(() => {
    if (isAtBottom) {
      lastReadCountRef.current = messages.length;
      setNewMessagesCount(0);
    } else if (messages.length > lastReadCountRef.current) {
      setNewMessagesCount(messages.length - lastReadCountRef.current);
    }
  }, [messages.length, isAtBottom]);
  
  // Inverted: show date header when this message is from a different day than the one above it
  // (index+1 = older message = displayed above in inverted list)
  const shouldShowDateHeader = useCallback((currentIndex: number): boolean => {
    const msgs = messagesRef.current;
    if (currentIndex === msgs.length - 1) return true; // oldest message always gets a header
    const curr = msgs[currentIndex];
    const older = msgs[currentIndex + 1];
    if (!curr || !older) return true;
    return new Date(curr.createdAt || 0).toDateString() !== new Date(older.createdAt || 0).toDateString();
  }, []);

  const onPullRefresh = useCallback(async () => {
    if (!chatId) return;
    setListRefreshing(true);
    setPaginationBlocking(true);
    const t0 = typeof globalThis !== 'undefined' && (globalThis as any).performance?.now ? (globalThis as any).performance.now() : Date.now();
    try {
      const { loaded, hasMore } = await loadOlderChatMessages(chatId, 30);
      setHasMoreOlderMessages(hasMore);
      if (__DEV__ && loaded === 0 && hasMore) {
        console.warn('[chat] loadOlderChatMessages: no batch loaded; check Firestore / network');
      }
      const t1 = typeof globalThis !== 'undefined' && (globalThis as any).performance?.now ? (globalThis as any).performance.now() : Date.now();
      markPaginationComplete(chatId, t1 - t0);
    } catch (e) {
      if (__DEV__) console.error('[chat] loadOlderChatMessages failed', e);
    } finally {
      setListRefreshing(false);
      setPaginationBlocking(false);
    }
  }, [chatId]);

  const listRefreshControl = useMemo(
    () => <RefreshControl refreshing={listRefreshing} onRefresh={onPullRefresh} />,
    [listRefreshing, onPullRefresh]
  );

  const stickyDateOverlayEl = useMemo(
    () =>
      stickyDateLabel ? (
        <View className="absolute top-0 left-0 right-0 z-10 pt-2" pointerEvents="none">
          <StickyDateHeader label={stickyDateLabel} isDark={!!isDark} />
        </View>
      ) : null,
    [stickyDateLabel, isDark]
  );
  
  const isGroupChat = chat?.type === 'group';

  // Hoisted outside renderMessage — windowWidth never changes mid-session on phones.
  const bubbleMaxWidth = Math.max(0, windowWidth * 0.72 - 16);

  // Pre-built date label style — created once per metaMutedColor change (theme toggle only).
  const dateLabelFullStyle = useMemo(
    () => ({ fontSize: 12, lineHeight: 16, fontWeight: '500' as const, color: metaMutedColor }),
    [metaMutedColor]
  );

  const renderMessage = useCallback(({ item, index }: { item: ChatMessage; index: number }) => {
    const isMyMessage = item.senderId === user?.uid;
    messageRefs.current[item.id] = index;
    const msgs = messagesRef.current;
    const showTail = shouldShowTailInverted(msgs, index);
    const showSenderName = shouldShowSenderInverted(msgs, index);
    const isAiMessage = item.isAI || item.senderId === GYW_AI_SYSTEM_ID;
    const showAvatar = (isGroupChat && showSenderName && !isMyMessage) || (!isMyMessage && isAiMessage && showSenderName);
    const showDateHeader = shouldShowDateHeader(index);
    // In inverted list, the message above visually = index+1 (older)
    const above = index + 1 < msgs.length ? msgs[index + 1] : null;
    const sameCluster =
      !!above &&
      above.senderId === item.senderId &&
      // ISO-8601 arithmetic via getTime() only where we need an exact ms diff
      new Date(item.createdAt || 0).getTime() - new Date(above.createdAt || 0).getTime() <= 2 * 60 * 1000;
    const marginTop = index === 0 ? 0 : sameCluster ? 3 : 12;
    const bubbleMax = bubbleMaxWidth;
    
    if (item.deletedFor && user && item.deletedFor.includes(user.uid)) {
      return null;
    }

    if (item.type === 'system') {
      return (
        <View style={{ marginTop }}>
          {showDateHeader ? (
            <ChatRoomDateDivider
              label={formatDateHeader(item.createdAt)}
              pillSurfaceStyle={bodyDatePillStyle}
              labelStyle={dateLabelFullStyle}
            />
          ) : null}
          <MessageBubble
            message={item}
            isMyMessage={false}
            textColor={textColor}
            textSecondaryColor={textSecondaryColor}
            colorScheme={colorScheme}
            isDark={isDark}
            isGroupChat={!!isGroupChat}
            onReplyPress={handleReplyPress}
            onMediaPress={handleMediaPress}
            onDocumentPress={handleOpenDocument}
            onLocationPress={handleOpenLocation}
            onLongPress={MESSAGE_BUBBLE_NOOP_LONG_PRESS}
            showTail={false}
            showSenderName={false}
            showAvatar={false}
          />
        </View>
      );
    }
    
    if (item.type === 'call') {
      if (item.deleted) {
        return (
          <View style={{ marginTop, alignItems: 'center' }}>
            <Text
              className={clsx('text-xs italic', isDark ? 'text-gray-500' : 'text-gray-500')}
            >
              {CHAT_DELETED_FOR_EVERYONE_TEXT}
            </Text>
          </View>
        );
      }
      return (
        <View style={{ marginTop, alignItems: 'center' }}>
          <View className={clsx(
            'px-4 py-2 rounded-full',
            isDark ? 'bg-gray-800' : 'bg-gray-100'
          )}>
            <Text className={clsx(
              'text-xs',
              isDark ? 'text-gray-300' : 'text-gray-600'
            )}>
              {item.text}
            </Text>
          </View>
        </View>
      );
    }
    
    const isSearchHit = searchHighlightMessageId !== null && item.id === searchHighlightMessageId;

    return (
      <View
        style={[
          { marginTop },
          isSearchHit && {
            paddingHorizontal: 2,
            paddingVertical: 2,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: isDark ? '#60a5fa' : '#2563eb',
          },
        ]}
      >
        {showDateHeader ? (
          <ChatRoomDateDivider
            label={formatDateHeader(item.createdAt)}
            pillSurfaceStyle={bodyDatePillStyle}
            labelStyle={dateLabelFullStyle}
          />
        ) : null}
        
        <View
          style={{ maxWidth: bubbleMax, alignSelf: isMyMessage ? 'flex-end' : 'flex-start' }}
          shouldRasterizeIOS
        >
          <BodySwipeableRow
            message={item}
            isOutgoing={isMyMessage}
            onSwipeReply={handleSwipeToReply}
            onLongPress={handleLongPress}
            onTap={handleTapStable}
            onDoubleTap={handleDoubleTapItem}
          >
            <View shouldRasterizeIOS style={{ width: '100%' }}>
              <MessageBubble
                message={item}
                isMyMessage={isMyMessage}
                textColor={textColor}
                textSecondaryColor={textSecondaryColor}
                colorScheme={colorScheme}
                isDark={isDark}
                isGroupChat={!!isGroupChat}
                onReplyPress={handleReplyPress}
                onMediaPress={handleMediaPress}
                onDocumentPress={handleOpenDocument}
                onLocationPress={handleOpenLocation}
                onLongPress={MESSAGE_BUBBLE_NOOP_LONG_PRESS}
                onRetry={
                  item.isAI || item.senderId === GYW_AI_SYSTEM_ID
                    ? handleRetryAi
                    : handleRetryMessage
                }
                showTail={showTail}
                showSenderName={showSenderName}
                showAvatar={showAvatar}
              />
              {user && item ? (
                <MessageReactions
                  message={item}
                  currentUserId={user.uid}
                  onReactionPress={handleReactionSelect}
                />
              ) : null}
            </View>
          </BodySwipeableRow>
        </View>
      </View>
    );
  }, [
    user?.uid, isDark, colorScheme, textColor, textSecondaryColor, isGroupChat,
    handleReplyPress, handleSwipeToReply, handleLongPress, handleRetryMessage, handleRetryAi,
    handleReactionSelect, handleMediaPress, handleOpenDocument, handleOpenLocation, shouldShowDateHeader,
    handleTapStable, handleDoubleTapItem,
    dateLabelFullStyle, bubbleMaxWidth, bodyDatePillStyle, searchHighlightMessageId,
  ]);

  const closeBodyContext = useCallback(() => setBodyContextMessage(null), []);

  const handleBodyContextReply = useCallback(() => {
    if (bodyContextMessage) setReplyingTo(bodyContextMessage);
    setBodyContextMessage(null);
  }, [bodyContextMessage]);

  const handleBodyContextCopy = useCallback(async () => {
    if (bodyContextMessage?.text) {
      await Clipboard.setStringAsync(bodyContextMessage.text);
    }
    setBodyContextMessage(null);
  }, [bodyContextMessage]);

  const handleBodyContextForward = useCallback(() => {
    setBodyContextMessage(null);
    Alert.alert(t('messages.forwardNotAvailableTitle'), t('messages.forwardNotAvailableBody'));
  }, [t]);

  const handleBodyContextDelete = useCallback(() => {
    if (bodyContextMessage) setActionMenuMessage(bodyContextMessage);
    setBodyContextMessage(null);
  }, [bodyContextMessage]);

  const handleBodyContextInfo = useCallback(() => {
    setBodyContextMessage(null);
    Alert.alert(t('messages.messageInfoNotAvailableTitle'), t('messages.messageInfoNotAvailableBody'));
  }, [t]);

  const handleReactionTrayPick = useCallback(
    async (emoji: string) => {
      if (!reactionTrayMessageId || !user || !chatId) return;
      setReactionTrayMessageId(null);
      try {
        await toggleReaction(chatId, reactionTrayMessageId, user.uid, emoji);
      } catch (e) {
        if (__DEV__) console.error(e);
      }
    },
    [reactionTrayMessageId, user, chatId]
  );

  const groupSheetLabels = useMemo(
    () => ({
      title: t('groups.groupMembers'),
      viewProfile: t('groups.viewProfile'),
      removeFromGroup: t('groups.removeFromGroup'),
      cancel: t('common.cancel'),
      removeConfirmTitle: t('groups.removeMemberConfirmTitle'),
      removeConfirmMessage: t('groups.removeMemberConfirmMessage'),
      removeConfirmAction: t('groups.removeMemberConfirmAction'),
      youBadge: t('groups.memberRowYou'),
    }),
    [t]
  );

  const handleRemoveGroupMemberLocal = useCallback(
    async (targetUid: string) => {
      if (!chatId) return;
      try {
        await removeGroupMemberFromGroup(chatId, targetUid);
        setGroupMembersOpen(false);
      } catch (e) {
        if (__DEV__) console.error(e);
        Alert.alert(t('common.error'), t('groups.removeMemberFailed'));
      }
    },
    [chatId, t]
  );

  const handleViewGroupMemberProfile = useCallback(
    (row: GroupMemberRow) => {
      if (!chatId) return;
      router.push({
        pathname: '/(home)/user-profile' as never,
        params: { userId: row.uid, chatId, chatType: 'group' } as never,
      });
    },
    [router, chatId]
  );

  const openAttachTray = useCallback(() => {
    setShowAttachOptions(true);
    setShowEmojiPicker(false);
  }, []);
  
  // ========================================
  // RENDER
  // ========================================
  
  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#111827' : '#ffffff' }}>
      {/* SafeAreaView handles TOP + sides only. Bottom is handled inside input bar so
          KAV can move it freely above the keyboard on every Android model. */}
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        <RNAnimated.View style={{ flex: 1 }}>
      <ChatRoomHeader
        displayName={displayName}
        avatarUri={displayAvatar}
        typing={typingUiActive}
        online={!isGywAiChat && chat?.type === 'direct' && isOnlineStatus}
        lastSeenLine={headerLastSeenLine}
        showOnlineAvatarBadge={!isGywAiChat && chat?.type === 'direct' && isOnlineStatus}
        callDisabled={isGywAiChat || creatingCall || chat?.type === 'group'}
        hideCallButtons={!!isGywAiChat}
        activeVideoRing={outgoingCallKind === 'video'}
        activeVoiceRing={outgoingCallKind === 'voice'}
        headerSurfaceStyle={headerSurfaceStyle}
        dividerLineStyle={headerDividerLineStyle}
        onlineBadgeSurfaceStyle={headerOnlineBadgeStyle}
        primaryGlyphStyle={headerPrimaryGlyphStyle}
        secondaryGlyphStyle={headerSecondaryGlyphStyle}
        typingDotSurfaceStyle={headerTypingDotStyle}
        menuSheetSurfaceStyle={headerMenuSheetStyle}
        callRingCircleProps={headerCallRingCircleProps}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/chats'))}
        onVideoCall={async () => {
          if (isGywAiChat) return;
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const oid = chat.participants.find(p => p !== user.uid);
          if (!oid) return;
          setCreatingCall(true);
          setOutgoingCallKind('video');
          try {
            const { createCall } = await import('@/lib/services/callService');
            const callId = await createCall(user.uid, oid, 'video', chatId, undefined, user.displayName ?? undefined, user.photoURL ?? undefined);
            router.push(`/(home)/call/${callId}`);
          } catch (error) {
            if (__DEV__) console.error('Error starting video call:', error);
            Alert.alert(t('common.error'), t('messages.failedToStartVideoCall'));
          } finally {
            setOutgoingCallKind(null);
            setCreatingCall(false);
          }
        }}
        onVoiceCall={async () => {
          if (isGywAiChat) return;
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const oid = chat.participants.find(p => p !== user.uid);
          if (!oid) return;
          setCreatingCall(true);
          setOutgoingCallKind('voice');
          try {
            const { createCall } = await import('@/lib/services/callService');
            const callId = await createCall(user.uid, oid, 'audio', chatId, undefined, user.displayName ?? undefined, user.photoURL ?? undefined);
            router.push(`/(home)/call/${callId}`);
          } catch (error) {
            if (__DEV__) console.error('Error starting audio call:', error);
            Alert.alert(t('common.error'), t('messages.failedToStartAudioCall'));
          } finally {
            setOutgoingCallKind(null);
            setCreatingCall(false);
          }
        }}
        onViewContact={handleHeaderViewContact}
        onMuteNotifications={handleHeaderMuteToggle}
        onSearch={handleHeaderOpenSearch}
        onMore={handleHeaderMorePlaceholder}
        muteRowLabel={headerMuteRowLabel}
        onOpenProfilePress={headerOpenProfilePress}
        onGroupInfoPress={
          chat?.type === 'group' && chatId
            ? () => {
                router.push(`/(home)/group-info/${chatId}` as never);
              }
            : undefined
        }
        onAvatarPress={() => {
          if (displayAvatar) setViewingImage(displayAvatar);
        }}
        menuExtraRows={
          chat?.type === 'group' && chatId
            ? [
                {
                  key: 'group-info',
                  label: t('groups.groupInfo'),
                  icon: 'info',
                  onPress: () => {
                    router.push(`/(home)/group-info/${chatId}` as never);
                  },
                },
                {
                  key: 'group-members',
                  label: t('groups.groupMembers'),
                  icon: 'users',
                  onPress: () => setGroupMembersOpen(true),
                },
              ]
            : undefined
        }
      />

      {inChatSearchOpen ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 6,
            columnGap: 8,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: isDark ? '#374151' : '#e5e7eb',
            backgroundColor: isDark ? '#111827' : '#ffffff',
          }}
        >
          <TextInput
            value={inChatSearchQuery}
            onChangeText={setInChatSearchQuery}
            placeholder={t('messages.searchInChatPlaceholder')}
            placeholderTextColor={isDark ? '#9ca3af' : '#6b7280'}
            style={{
              flex: 1,
              minHeight: 40,
              paddingHorizontal: 12,
              borderRadius: 10,
              fontSize: 16,
              color: isDark ? '#f9fafb' : '#111827',
              backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
            }}
            returnKeyType="search"
            onSubmitEditing={runInChatFind}
          />
          <Pressable
            onPress={runInChatFind}
            style={{ paddingHorizontal: 12, paddingVertical: 10 }}
            hitSlop={ICON_HIT_SLOP}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: isDark ? '#93c5fd' : '#2563eb' }}>
              {t('messages.findInChat')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleCloseInChatSearch}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            hitSlop={ICON_HIT_SLOP}
            accessibilityLabel={t('common.cancel')}
          >
            <Feather name="x" size={22} color={iconColor} />
          </Pressable>
        </View>
      ) : null}
      
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={undefined}
        enabled={Platform.OS !== 'android'}
        keyboardVerticalOffset={0}
      >
      <View style={{ flex: 1 }}>
        <ChatRoomBody
          messages={messages}
          screenWidth={windowWidth}
          viewportHeight={viewportHeight}
          keyboardPadAnim={Platform.OS === 'android' ? listKeyboardPadAndroid : keyboardPad}
          listRef={listRef}
          renderItem={renderMessage}
          keyExtractor={keyExtractor}
          typingIncoming={typingUiActive}
          showInitialSkeleton={!messageStreamHydrated && messages.length === 0}
          typingDotSurfaceStyle={headerTypingDotStyle}
          showPaginationLoader={showLoadingOlderBanner}
          paginationBlocking={paginationBlocking}
          onScroll={handleScroll}
          onContentSizeChange={onContentSizeChange}
          onListLayout={onListLayout}
          listExtraData={listSearchExtraData}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfigMemo}
          disableMaintainVisibleContentPosition={!!isGywAiChat}
          refreshControl={listRefreshControl}
          stickyDateOverlay={stickyDateOverlayEl}
          showScrollFab={showNewMessagesButton}
          scrollFabBottom={72}
          scrollFabRight={16}
          onScrollFabPress={onScrollFabPressStable}
          fabSurfaceStyle={bodyFabSurfaceStyle}
          fabIconColor="#ffffff"
          newMessagesBadgeCount={newMessagesCount}
          fabBadgeLabelStyle={listFabBadgeLabelStyleMemo}
          pillSurfaceStyle={bodyDatePillStyle}
          dateLabelStyle={listDateLabelStyleMemo}
          unreadLineStyle={headerDividerLineStyle}
          unreadLabelStyle={listDateLabelStyleMemo}
          contextSheetSurfaceStyle={bodyContextSheetStyle}
          contextRowLabelStyle={listContextRowLabelStyleMemo}
          contextIconColor={iconColor}
          contextDividerStyle={headerDividerLineStyle}
          reactionTraySurfaceStyle={bodyReactionTrayStyle}
          skeletonSurfaceStyle={bodySkeletonStyle}
          insetBottom={insets.bottom}
          contextMessage={bodyContextMessage}
          onCloseContext={closeBodyContext}
          onContextReply={handleBodyContextReply}
          onContextCopy={handleBodyContextCopy}
          onContextForward={handleBodyContextForward}
          onContextDelete={handleBodyContextDelete}
          onContextInfo={handleBodyContextInfo}
          reactionTrayVisible={!!reactionTrayMessageId}
          reactionEmojis={CHAT_REACTION_EMOJIS}
          onReactionSelect={handleReactionTrayPick}
          onReactionTrayDismiss={onReactionTrayDismissStable}
          reactionTrayBottom={96}
        />
        
        {/* ── Input toolbar (spec: min 52 / max 120 row, 12+8 padding, 10px gaps, 48px targets) ── */}
        <View
          style={{
            backgroundColor: isDark ? '#111827' : '#f0f2f5',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: isDark ? '#374151' : '#d1d5db',
            paddingBottom: Math.max(insets.bottom, 8),
            minHeight: 52,
          }}
        >
          <ChatPerfComposerProbe />
          {directPeerBlocked && !accessRevoked ? (
            <View
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: isDark ? '#450a0a' : '#fee2e2',
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: isDark ? '#7f1d1d' : '#fecaca',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#fecaca' : '#991b1b', textAlign: 'center' }}>
                {t('messages.blockedBanner')}
              </Text>
            </View>
          ) : null}
          {replyingTo ? (
            <View
              style={{
                minHeight: 48,
                padding: 8,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: isDark ? '#374151' : '#e5e7eb',
              }}
            >
              <View
                style={{
                  width: 3,
                  height: 32,
                  borderRadius: 2,
                  backgroundColor: '#FF5722',
                  marginRight: 10,
                }}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: '#FF5722',
                    marginBottom: 2,
                  }}
                >
                  {replyingTo.senderId === user?.uid ? t('messages.you') : replyingTo.senderName}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    lineHeight: 18,
                    color: isDark ? '#9ca3af' : '#6b7280',
                  }}
                  numberOfLines={1}
                >
                  {replyingTo.text
                    || (replyingTo.type === 'image' ? `📷 ${t('messages.photo')}`
                    : replyingTo.type === 'video' ? `🎥 ${t('messages.video')}`
                    : replyingTo.type === 'document' || replyingTo.type === 'file' ? `📎 ${t('messages.document')}`
                    : replyingTo.type === 'location' ? `📍 ${t('location.share')}`
                    : t('messages.media'))}
                </Text>
              </View>
              <Pressable
                onPress={() => setReplyingTo(null)}
                hitSlop={ICON_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.closeReplyPreview')}
                style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}
              >
                <Feather name="x" size={16} color={isDark ? '#9ca3af' : '#6b7280'} />
              </Pressable>
            </View>
          ) : null}

          {showAttachOptions ? (
            <View
              style={{
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: isDark ? '#374151' : '#e5e7eb',
                paddingVertical: 12,
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
              }}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 12, alignItems: 'center' }}
              >
                {[
                  { icon: 'image' as const, label: t('messages.photo'), onPress: () => { setShowAttachOptions(false); handlePickImage(); } },
                  { icon: 'video' as const, label: t('messages.video'), onPress: () => { setShowAttachOptions(false); handlePickVideo(); } },
                  { icon: 'file-text' as const, label: t('messages.document'), onPress: () => { void handlePickDocument(); } },
                  { icon: 'map-pin' as const, label: t('location.share'), onPress: () => { if (!composerInputLocked) openLocationAttach(); } },
                ].map(({ icon, label, onPress }, optIdx) => (
                  <Pressable
                    key={icon}
                    onPress={onPress}
                    style={{
                      width: 72,
                      height: 72,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: optIdx < 3 ? 16 : 0,
                    }}
                  >
                    <View
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        backgroundColor: isDark ? '#374151' : '#e5e7eb',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Feather name={icon} size={28} color={iconColor} />
                    </View>
                    <Text style={{ fontSize: 10, marginTop: 4, color: metaMutedColor }} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Modal
            visible={locationSheetOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setLocationSheetOpen(false)}
          >
            <Pressable
              style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
              onPress={() => setLocationSheetOpen(false)}
            >
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={{
                  backgroundColor: isDark ? '#1f2937' : '#ffffff',
                  borderTopLeftRadius: 16,
                  borderTopRightRadius: 16,
                  paddingBottom: insets.bottom + 16,
                  paddingTop: 4,
                }}
              >
                <Text
                  style={{
                    fontWeight: '700',
                    fontSize: 16,
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    color: isDark ? '#f9fafb' : '#111827',
                  }}
                >
                  {t('location.sheetTitle')}
                </Text>
                {(
                  [
                    { label: t('location.sendCurrent'), onPress: () => void sendCurrentLocationAttachment() },
                    { label: t('location.live15'), onPress: () => void sendLiveLocationAttachment(15 * 60 * 1000) },
                    { label: t('location.live1h'), onPress: () => void sendLiveLocationAttachment(60 * 60 * 1000) },
                    { label: t('location.live8h'), onPress: () => void sendLiveLocationAttachment(8 * 60 * 60 * 1000) },
                    { label: t('location.pickOnMap'), onPress: () => openLocationOnMapPicker() },
                  ] as const
                ).map((row, i) => (
                  <Pressable
                    key={row.label}
                    onPress={() => {
                      if (composerInputLocked) return;
                      row.onPress();
                    }}
                    disabled={composerInputLocked}
                    style={{
                      paddingVertical: 14,
                      paddingHorizontal: 18,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: isDark ? '#374151' : '#e5e7eb',
                      opacity: composerInputLocked ? 0.45 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 16, color: isDark ? '#f3f4f6' : '#1f2937' }}>{row.label}</Text>
                  </Pressable>
                ))}
              </Pressable>
            </Pressable>
          </Modal>

          {(isRecording || isRecordingLocked) ? (
            <View style={{ minHeight: 60, justifyContent: 'flex-end' }}>
              <VoiceRecorderBar
                isDark={!!isDark}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
                getRecordingDuration={getRecordingDuration}
                isRecording={isRecording}
                isLocked={isRecordingLocked}
                onLockChange={setIsRecordingLocked}
                isReady={false}
              />
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              paddingHorizontal: 12,
              paddingVertical: 8,
              columnGap: 10,
              minHeight: 52,
            }}
          >
            <Pressable
              onPress={() => {
                if (composerInputLocked) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                openAttachTray();
              }}
              onLongPress={() => {
                if (composerInputLocked) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                openAttachTray();
              }}
              delayLongPress={400}
              style={{
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: composerInputLocked ? 0.45 : 1,
              }}
              hitSlop={ICON_HIT_SLOP}
              accessibilityLabel={t('a11y.attachment')}
            >
              <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="paperclip" size={22} color={iconColor} />
              </View>
            </Pressable>

            <View
              style={{
                flex: 1,
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                borderRadius: 20,
                minHeight: 40,
                maxHeight: 100,
                paddingVertical: 8,
                paddingHorizontal: 12,
              }}
            >
              <TextInput
                ref={textInputRef}
                placeholder={t('messages.typeMessage')}
                placeholderTextColor={colorScheme === 'dark' ? '#6b7280' : '#8696a0'}
                value={messageText}
                onChangeText={(text) => {
                  const next = text.length > 4000 ? text.slice(0, 4000) : text;
                  updateComposerSendMic(next.length > 0);
                  setMessageText(next);
                  if (chatId) {
                    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
                    draftSaveTimerRef.current = setTimeout(() => {
                      draftSaveTimerRef.current = null;
                      AsyncStorage.setItem(`draft_${chatId}`, next).catch(() => {});
                    }, 350);
                  }
                }}
                multiline
                scrollEnabled
                maxLength={4000}
                editable={!composerInputLocked}
                style={{
                  fontSize: 16,
                  lineHeight: 22,
                  color: isDark ? '#f9fafb' : '#111827',
                  minHeight: 24,
                  maxHeight: 84,
                  textAlignVertical: 'top',
                }}
                returnKeyType="default"
                blurOnSubmit={false}
                onFocus={() => {
                  if (composerInputLocked) return;
                  setShowEmojiPicker(false);
                  setShowAttachOptions(false);
                }}
              />
            </View>

            <Pressable
              disabled={sending || composerInputLocked}
              onPress={messageText.trim() && !sending && !composerInputLocked ? handleSendMessage : undefined}
              onPressIn={!messageText.trim() && !sending && !composerInputLocked ? startRecording : undefined}
              onPressOut={!messageText.trim() && !sending && !composerInputLocked ? () => stopRecording(false) : undefined}
              style={{
                width: 48,
                height: 48,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: sending || composerInputLocked ? 0.5 : 1,
              }}
              hitSlop={ICON_HIT_SLOP}
              accessibilityLabel={
                messageText.trim() ? t('messages.sendMessageA11y') : t('messages.recordVoiceMessageA11y')
              }
            >
              {sending ? (
                <ActivityIndicator size="small" color={iconColor} />
              ) : (
                <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <Reanimated.View
                    style={[
                      { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
                      micIconStyle,
                    ]}
                  >
                    <Feather
                      name={isRecording && !messageText.trim() ? 'square' : 'mic'}
                      size={22}
                      color={isRecording && !messageText.trim() ? '#ef4444' : iconColor}
                    />
                  </Reanimated.View>
                  <Reanimated.View
                    pointerEvents="none"
                    style={[
                      { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
                      sendIconStyle,
                    ]}
                  >
                    <Feather name="send" size={22} color={iconColor} />
                  </Reanimated.View>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>

      {accessRevoked ? (
        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 16,
            backgroundColor: isDark ? '#422006' : '#fef3c7',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: isDark ? '#78350f' : '#fcd34d',
          }}
        >
          <Text style={{ fontSize: 13, color: isDark ? '#fde68a' : '#92400e', textAlign: 'center' }}>
            {t('groups.removedFromGroupTitle')}
          </Text>
        </View>
      ) : null}

        </RNAnimated.View>
      </SafeAreaView>

      {user && chat?.type === 'group' ? (
        <GroupMembersSheet
          visible={groupMembersOpen}
          chat={chat}
          currentUserId={user.uid}
          isAdmin={isGroupAdmin}
          onClose={() => setGroupMembersOpen(false)}
          onRemoveMember={handleRemoveGroupMemberLocal}
          onViewProfile={handleViewGroupMemberProfile}
          labels={groupSheetLabels}
        />
      ) : null}

      <Modal
        visible={mediaComposerVisible}
        animationType="none"
        transparent
        onRequestClose={closeImageComposer}
        statusBarTranslucent
      >
        <RNAnimated.View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.96)',
            opacity: mediaComposerAnim,
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 20,
                paddingTop: insets.top + 8,
                paddingHorizontal: 12,
                paddingBottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Pressable
                onPress={closeImageComposer}
                disabled={mediaComposerSending}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.45)',
                }}
              >
                <Feather name="x" size={22} color="#ffffff" />
              </Pressable>
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>{t('messages.photo')}</Text>
              <View style={{ width: 40, height: 40 }} />
            </View>

            <RNAnimated.View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [
                  {
                    scale: mediaComposerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.98, 1],
                    }),
                  },
                ],
              }}
            >
              {!!mediaComposerUri && (
                <Image
                  source={{ uri: mediaComposerUri }}
                  style={{ width: '100%', height: '100%' }}
                  contentFit="contain"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              )}
            </RNAnimated.View>

            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: 10,
                paddingBottom: Math.max(insets.bottom, 12),
                backgroundColor: 'rgba(14,14,14,0.92)',
              }}
            >
              <View
                style={{
                  minHeight: 48,
                  maxHeight: 120,
                  borderRadius: 24,
                  backgroundColor: '#1f1f1f',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  paddingRight: 64,
                  justifyContent: 'center',
                }}
              >
                <TextInput
                  value={mediaComposerCaption}
                  onChangeText={setMediaComposerCaption}
                  placeholder={t('messages.typeMessage')}
                  placeholderTextColor="#8f8f8f"
                  style={{ color: '#ffffff', fontSize: 16, maxHeight: 92 }}
                  multiline
                  returnKeyType="default"
                  editable={!mediaComposerSending}
                />
              </View>

              {isGywAiChat && !mediaComposerSending ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8 }}>
                    {t('messages.gywAiImageModeHint')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(
                      [
                        { mode: 'auto' as const, label: t('messages.gywAiImageModeAuto') },
                        { mode: 'vision' as const, label: t('messages.gywAiImageModeDescribe') },
                        { mode: 'image_gen' as const, label: t('messages.gywAiImageModeCreate') },
                      ] as const
                    ).map(({ mode, label }) => {
                      const selected = mediaComposerAiMode === mode;
                      return (
                        <Pressable
                          key={mode}
                          onPress={() => setMediaComposerAiMode(mode)}
                          style={{
                            paddingHorizontal: 14,
                            paddingVertical: 8,
                            borderRadius: 20,
                            backgroundColor: selected ? '#FF5722' : 'rgba(255,255,255,0.1)',
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: selected ? '#FF5722' : 'rgba(255,255,255,0.2)',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              fontWeight: '600',
                              color: selected ? '#ffffff' : '#e5e7eb',
                            }}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {mediaComposerSending ? (
                <View style={{ marginTop: 10 }}>
                  <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999 }}>
                    <View
                      style={{
                        height: 4,
                        width: `${Math.max(6, Math.min(100, Math.round(mediaComposerProgress * 100)))}%`,
                        backgroundColor: '#FF5722',
                        borderRadius: 999,
                      }}
                    />
                  </View>
                  <Text style={{ color: '#d1d5db', marginTop: 6, fontSize: 12 }}>{t('common.loading')}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleSendComposedImage}
                disabled={mediaComposerSending || !mediaComposerUri}
                style={{
                  position: 'absolute',
                  right: 18,
                  bottom: Math.max(insets.bottom, 14),
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  backgroundColor: '#FF5722',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.28,
                  shadowRadius: 8,
                  elevation: 8,
                  opacity: mediaComposerSending ? 0.8 : 1,
                }}
              >
                {mediaComposerSending ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Feather name="send" size={22} color="#ffffff" />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </RNAnimated.View>
      </Modal>

      <EmojiPicker
        visible={showEmojiPicker}
        onEmojiSelect={handleEmojiSelect}
        onClose={() => setShowEmojiPicker(false)}
      />
      
      <ImageViewer
        visible={!!viewingImage}
        imageUri={viewingImage || ''}
        onClose={() => setViewingImage(null)}
      />
      
      {viewingVideo && <VideoViewerModal videoUrl={viewingVideo} onClose={() => setViewingVideo(null)} />}
      
      {user && (
        <MessageActionMenu
          visible={!!actionMenuMessage}
          message={actionMenuMessage}
          isMyMessage={actionMenuMessage?.senderId === user?.uid}
          currentUserId={user.uid}
          onClose={() => setActionMenuMessage(null)}
          onReactionSelect={handleReactionSelect}
          onReply={() => {
            if (actionMenuMessage) {
              setReplyingTo(actionMenuMessage);
            }
          }}
          onEdit={() => {
            if (actionMenuMessage) {
              setEditingMessage(actionMenuMessage);
            }
          }}
          onDeleteForEveryone={async () => {
            const msg = actionMenuMessage;
            if (!msg || !user || !chatId) return;
            const messageId = msg.id;
            const nowIso = new Date().toISOString();
            const rollback: Partial<ChatMessage> = {
              deleted: msg.deleted,
              deletedForEveryone: msg.deletedForEveryone,
              deletedAt: msg.deletedAt,
              text: msg.text,
            };
            useChatStore.getState().updateMessage(chatId, messageId, {
              deleted: true,
              deletedForEveryone: true,
              deletedAt: nowIso,
              text: CHAT_DELETED_FOR_EVERYONE_TEXT,
            });
            try {
              await deleteMessageForEveryone(chatId, messageId, user.uid);
            } catch (error) {
              if (__DEV__) console.error('Error deleting message for everyone:', error);
              useChatStore.getState().updateMessage(chatId, messageId, rollback);
              Alert.alert(t('common.error'), t('messages.failedToDelete'));
            }
          }}
          onDeleteForMe={async () => {
            const msg = actionMenuMessage;
            if (!msg || !user || !chatId) return;
            const messageId = msg.id;
            const prevDeletedFor = msg.deletedFor ?? [];
            if (prevDeletedFor.includes(user.uid)) return;
            const nextDeletedFor = [...prevDeletedFor, user.uid];
            useChatStore.getState().updateMessage(chatId, messageId, { deletedFor: nextDeletedFor });
            try {
              await deleteMessageForMe(chatId, messageId, user.uid);
            } catch (error) {
              if (__DEV__) console.error('Error deleting message for me:', error);
              useChatStore.getState().updateMessage(chatId, messageId, { deletedFor: prevDeletedFor });
              Alert.alert(t('common.error'), t('messages.failedToDelete'));
            }
          }}
        />
      )}
      
      <EditMessageModal
        visible={!!editingMessage}
        message={editingMessage}
        onClose={() => setEditingMessage(null)}
        onSave={async (newText) => {
          if (!editingMessage || !user || !chatId) return;
          const messageId = editingMessage.id;
          const trimmed = newText.trim();
          if (!trimmed || trimmed === (editingMessage.text ?? '').trim()) {
            setEditingMessage(null);
            return;
          }
          const rollback: Partial<ChatMessage> = {
            text: editingMessage.text,
            edited: editingMessage.edited,
            isEdited: editingMessage.isEdited,
            editedAt: editingMessage.editedAt,
          };
          const nowIso = new Date().toISOString();
          useChatStore.getState().updateMessage(chatId, messageId, {
            text: trimmed,
            edited: true,
            isEdited: true,
            editedAt: nowIso,
          });
          setEditingMessage(null);
          try {
            await editMessage(chatId, messageId, trimmed, user.uid);
          } catch (error) {
            if (__DEV__) console.error('Error editing message:', error);
            useChatStore.getState().updateMessage(chatId, messageId, rollback);
            Alert.alert(t('common.error'), t('messages.failedToEdit'));
          }
        }}
      />
    </View>
  );
};

// Video Viewer Component
const VideoViewerModal = ({ videoUrl, onClose }: { videoUrl: string; onClose: () => void }) => {
  const insets = useSafeAreaInsets();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
  const player = useVideoPlayer(videoUrl, (player) => {
    player.loop = false;
    player.play();
  });
  
  return (
    <Modal
      visible={!!videoUrl}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            paddingBottom: 16,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 20,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
              }}
              activeOpacity={0.7}
            >
              <Feather name="x" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPress={onClose}
        >
          <VideoView
            player={player}
            style={{
              width: SCREEN_WIDTH,
              height: SCREEN_HEIGHT,
            }}
            contentFit="contain"
            nativeControls
          />
        </Pressable>
      </View>
    </Modal>
  );
};

export default ChatScreen;