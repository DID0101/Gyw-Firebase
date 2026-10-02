import { stopAllAudioPlayback } from '@/components/AudioMessage';
import ChatMessageComposer, {
    type ChatMessageComposerHandle,
} from '@/components/chat/ChatMessageComposer';
import ChatMessagesPane from '@/components/chat/ChatMessagesPane';
import ChatRoomBody from '@/components/chat/ChatRoomBody';
import EditMessageModal from '@/components/EditMessageModal';
import type { GroupMemberRow } from '@/components/GroupMembersSheet';
import MessageActionMenu from '@/components/MessageActionMenu';
import MessageBubble from '@/components/MessageBubble';
import MessageReactions from '@/components/MessageReactions';
import StickyDateHeader from '@/components/StickyDateHeader';
import VoiceRecorderBar from '@/components/VoiceRecorderBar';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { startOutgoingCall } from '@/lib/call/startOutgoingCall';
import { useChatWindowResizeProbe } from '@/lib/chat/useChatWindowResizeProbe';
import { formatChatListTitle } from '@/lib/chatDisplayText';
import { getListenerPageSize } from '@/lib/chatMessageLimits';
import {
    consumeAndroidPendingReplyJson,
    setAndroidForegroundChatId,
} from '@/lib/chatNotificationBridge';
import {
    bumpChatPerfRender,
    chatPerfSessionEnd,
    chatPerfSessionStart,
    clearChatOpenMark,
    markChatAfterInteractions,
    markChatCacheHit,
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
import { BlockedPeerSendError } from '@/lib/chatSendGuards';
import { CHAT_DELETED_FOR_EVERYONE_TEXT } from '@/lib/constants/chatMessages';
import {
    GYW_AI_DISPLAY_NAME,
    GYW_AI_SYSTEM_ID,
    type GywAiMultimodalRoutingMode,
} from '@/lib/constants/gywAi';
import { perfScreenOpen } from '@/lib/debug/perfTelemetry';
import {
    DOCUMENT_PICKER_MIME_TYPES,
    isAllowedChatDocument,
    isDocumentLikeMime,
    MAX_CHAT_DOCUMENT_BYTES,
    resolveDocumentExtension,
} from '@/lib/documents/documentUpload';
import { openChatDocument } from '@/lib/documents/openChatDocument';
import { db } from '@/lib/firebase';
import {
    FIRESTORE_SNAPSHOT_OPTS,
    hasNativeFirestore,
    subscribeToChatDocNative,
    subscribeToUserDocNative,
} from '@/lib/firestoreNative';
import { useChatReadReceipts } from '@/lib/hooks/useChatReadReceipts';
import { useChatScrollController } from '@/lib/hooks/useChatScrollController';
import { useLazyComponent } from '@/lib/hooks/useLazyComponent';
import { startLiveLocationPublisher } from '@/lib/location/liveLocationPublisher';
import { formatGeocodeForLocationMessage } from '@/lib/maps/formatGeocodeForLocationMessage';
import { openInNativeMaps } from '@/lib/maps/openInNativeMaps';
import { exitChatScreen } from '@/lib/navigation/exitChat';
import { useNetworkState } from '@/lib/networkState';
import { enqueueOutboxMessage, removeOutboxMessage } from '@/lib/offline/messageOutbox';
import {
  isMediaSendQueuedError,
  sendMediaMessageReliable,
} from '@/lib/offline/mediaSendReliable';
import { isLegacyAndroid } from '@/lib/perf/deviceProfile';
import { navigateOnce } from '@/lib/safeAction';
import { loadOlderChatMessages, setMessageListenerViewerUid, startChatMessageListener, stopChatMessageListener } from '@/lib/services/chatPreloadService';
import {
    deleteMessageForEveryone,
    deleteMessageForMe,
    editMessage,
    removeGroupMemberFromGroup,
    sendLocationMessage,
    sendMessage,
    setTypingIndicator,
    toggleReaction,
    type SendChatMessageOptions,
} from '@/lib/services/chatService';
import { stopPerformanceTrace } from '@/lib/services/performanceService';
import { requestGywAiMultimodal, requestGywAiReply } from '@/lib/services/gywAiService';
import { syncChatReadState } from '@/lib/services/readStateService';
import { setUserChatMuted } from '@/lib/services/userChatMetaService';
import { Chat, ChatMessage, User } from '@/lib/types/chat';
import { getAvatarInitial } from '@/lib/unicodeText';
import { formatDateHeader, shouldShowSenderInverted, shouldShowTailInverted } from '@/lib/utils/chatUtils';
import { useChatMetaStore } from '@/store/chatMetaStore';
import { EMPTY_MESSAGES, useChatStore } from '@/store/chatStore';
import { persistence } from '@/store/persistence';
import { useContactsStore } from '@/store/contactsStore';
import { usePresenceStore } from '@/store/presenceStore';
import { useUserBlocksStore } from '@/store/userBlocksStore';
import Feather from '@expo/vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { doc, onSnapshot } from 'firebase/firestore';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ActivityIndicator,
    Alert,
    AppState,
    AppStateStatus,
    BackHandler,
    Dimensions,
    Easing,
    FlatList,
    I18nManager,
    InteractionManager,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    Animated as RNAnimated,
    Image as RNImage,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    unstable_batchedUpdates,
    useWindowDimensions,
    View
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withSpring,
    withTiming,
    type SharedValue
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

const ICON_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 } as const;

/** WhatsApp/Signal-style compact chat toolbar (logical px). */
const CHAT_HEADER_TOOLBAR_H = 52;
const CHAT_HEADER_AVATAR = 36;
const CHAT_HEADER_ICON = 22;
const CHAT_HEADER_ACTION = 40;
const CHAT_HEADER_ACTION_GAP = 2;
const CHAT_HEADER_TITLE_SIZE = 16;
const CHAT_HEADER_STATUS_SIZE = 12;
const HEADER_ACTION_HIT_SLOP = { top: 8, right: 8, bottom: 8, left: 8 } as const;

const CHAT_REACTION_EMOJIS = ['â¤ï¸', 'ðŸ˜‚', 'ðŸ‘', 'ðŸ˜®', 'ðŸ˜¢'];

/** Stable ref for MessageBubble â€” avoids allocating a new noop each list render. */
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
  /** Opaque style objects from screen (backgrounds, strokes, text) â€” header contains no palette literals */
  headerSurfaceStyle?: object;
  dividerLineStyle?: object;
  onlineBadgeSurfaceStyle?: object;
  primaryGlyphStyle?: object;
  secondaryGlyphStyle?: object;
  typingDotSurfaceStyle?: object;
  menuSheetSurfaceStyle?: object;
  /** Spread onto react-native-svg Circle (stroke, strokeOpacity, â€¦) */
  callRingCircleProps?: Record<string, string | number>;
  onBack: () => void;
  onVideoCall: () => void;
  onVoiceCall: () => void;
  onViewContact: () => void;
  onMuteNotifications: () => void;
  onSearch: () => void;
  onMore: () => void;
  /** Mute row label (Mute vs Unmute) â€” avoids rebuilding the whole menu. */
  muteRowLabel: string;
  onAvatarPress: () => void;
  /** When set, tap on display name + short tap on avatar opens user profile (direct chats). */
  onOpenProfilePress?: () => void;
  /** Group: tap title / subtitle area to open group info. */
  onGroupInfoPress?: () => void;
  /** Optional rows prepended to the header â€œâ€¦â€ sheet (e.g. group members). */
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

const HeaderIconButton = memo(function HeaderIconButton({
  onPress,
  disabled,
  icon,
  label,
  iconColor,
  scaleStyle,
  children,
  onPressIn,
  onPressOut,
}: {
  onPress: () => void;
  disabled?: boolean;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  iconColor?: string;
  scaleStyle?: object;
  children?: React.ReactNode;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: true, radius: CHAT_HEADER_ACTION / 2 }}
      style={{
        width: CHAT_HEADER_ACTION,
        height: CHAT_HEADER_ACTION,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
      hitSlop={HEADER_ACTION_HIT_SLOP}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      {children ?? (
        <Reanimated.View style={[{ alignItems: 'center', justifyContent: 'center' }, scaleStyle]}>
          <Feather name={icon} size={CHAT_HEADER_ICON} color={iconColor} />
        </Reanimated.View>
      )}
    </Pressable>
  );
});

const HeaderTitleBlock = memo(function HeaderTitleBlock({
  displayName,
  lastSeenLine,
  nameAlign,
  primaryGlyphStyle,
  secondaryGlyphStyle,
  typingDotSurfaceStyle,
  typingAnim,
  statusAnim,
  onlineAnim,
  lastSeenAnim,
  onPress,
  onlineLabel,
  a11yLabel,
}: {
  displayName: string;
  lastSeenLine: string;
  nameAlign: 'left' | 'right';
  primaryGlyphStyle?: object;
  secondaryGlyphStyle?: object;
  typingDotSurfaceStyle?: object;
  typingAnim: ReturnType<typeof useAnimatedStyle>;
  statusAnim: ReturnType<typeof useAnimatedStyle>;
  onlineAnim: ReturnType<typeof useAnimatedStyle>;
  lastSeenAnim: ReturnType<typeof useAnimatedStyle>;
  onPress?: () => void;
  onlineLabel: string;
  a11yLabel?: string;
}) {
  const titleStyle = useMemo(
    () => [
      {
        fontSize: CHAT_HEADER_TITLE_SIZE,
        lineHeight: 20,
        fontWeight: '600' as const,
        textAlign: nameAlign,
      },
      primaryGlyphStyle,
    ],
    [nameAlign, primaryGlyphStyle]
  );
  const statusStyle = useMemo(
    () => [
      {
        fontSize: CHAT_HEADER_STATUS_SIZE,
        lineHeight: 15,
        textAlign: nameAlign,
        opacity: 0.72,
      },
      secondaryGlyphStyle,
    ],
    [nameAlign, secondaryGlyphStyle]
  );

  const content = (
    <>
      <Text style={titleStyle} numberOfLines={1} ellipsizeMode="tail">
        {displayName}
      </Text>
      <View style={{ marginTop: 1, minHeight: 15, justifyContent: 'center' }}>
        <Reanimated.View style={[StyleSheet.absoluteFillObject, typingAnim]} pointerEvents="none">
          <HeaderTypingDots dotSurfaceStyle={typingDotSurfaceStyle} />
        </Reanimated.View>
        <Reanimated.View style={statusAnim} pointerEvents="none">
          <Reanimated.View style={[StyleSheet.absoluteFillObject, onlineAnim]}>
            <Text style={statusStyle} numberOfLines={1} ellipsizeMode="tail">
              {onlineLabel}
            </Text>
          </Reanimated.View>
          <Reanimated.View style={[StyleSheet.absoluteFillObject, lastSeenAnim]}>
            <Text style={statusStyle} numberOfLines={1} ellipsizeMode="tail">
              {lastSeenLine}
            </Text>
          </Reanimated.View>
        </Reanimated.View>
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
        style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>{content}</View>;
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
  const onlineLabel = t('chats.online');

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onBack();
  }, [onBack]);

  const handleAvatarPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onOpenProfilePress) onOpenProfilePress();
    else onAvatarPress();
  }, [onOpenProfilePress, onAvatarPress]);

  const handleAvatarLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setAvatarCtxOpen(true);
  }, []);

  const handleTitlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onOpenProfilePress) onOpenProfilePress();
    else if (onGroupInfoPress) onGroupInfoPress();
  }, [onOpenProfilePress, onGroupInfoPress]);

  const handleVideoCall = useCallback(() => {
    if (callDisabled || activeVideoRing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onVideoCall();
  }, [callDisabled, activeVideoRing, onVideoCall]);

  const handleVoiceCall = useCallback(() => {
    if (callDisabled || activeVoiceRing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onVoiceCall();
  }, [callDisabled, activeVoiceRing, onVoiceCall]);

  const handleMenuOpen = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuOpen(true);
  }, []);

  const titlePressHandler =
    onOpenProfilePress || onGroupInfoPress ? handleTitlePress : undefined;

  return (
    <View style={[{ width: '100%' }, headerSurfaceStyle]}>
      <View
        style={{
          height: CHAT_HEADER_TOOLBAR_H,
          paddingHorizontal: 4,
          flexDirection: rowDir,
          alignItems: 'center',
        }}
      >
        <View style={{ opacity: backDisabled ? 0.4 : 1 }} pointerEvents={backDisabled ? 'none' : 'auto'}>
          <HeaderIconButton
            onPress={handleBack}
            icon="arrow-left"
            label={t('a11y.goBack')}
            iconColor={iconTint}
            children={
              <View style={{ transform: [{ rotate: rtl ? '180deg' : '0deg' }] }}>
                <Feather name="arrow-left" size={CHAT_HEADER_ICON} color={iconTint} />
              </View>
            }
          />
        </View>

        <Pressable
          onPress={handleAvatarPress}
          onLongPress={handleAvatarLongPress}
          delayLongPress={400}
          style={{
            width: CHAT_HEADER_ACTION,
            height: CHAT_HEADER_ACTION,
            alignItems: 'center',
            justifyContent: 'center',
            marginHorizontal: 2,
          }}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.openProfile')}
        >
          <View
            style={{
              width: CHAT_HEADER_AVATAR,
              height: CHAT_HEADER_AVATAR,
              borderRadius: CHAT_HEADER_AVATAR / 2,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={{
                  width: CHAT_HEADER_AVATAR,
                  height: CHAT_HEADER_AVATAR,
                  borderRadius: CHAT_HEADER_AVATAR / 2,
                }}
              />
            ) : (
              <View
                style={{
                  width: CHAT_HEADER_AVATAR,
                  height: CHAT_HEADER_AVATAR,
                  borderRadius: CHAT_HEADER_AVATAR / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <Text style={[{ fontSize: 13, fontWeight: '600' }, secondaryGlyphStyle]} numberOfLines={1}>
                  {getAvatarInitial(displayName ?? '')}
                </Text>
              </View>
            )}
            {showOnlineAvatarBadge ? (
              <View
                pointerEvents="none"
                style={[
                  {
                    position: 'absolute',
                    bottom: 0,
                    ...(rtl ? { left: 0 } : { right: 0 }),
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                  },
                  onlineBadgeSurfaceStyle,
                ]}
              />
            ) : null}
          </View>
        </Pressable>

        <HeaderTitleBlock
          displayName={displayName}
          lastSeenLine={lastSeenLine}
          nameAlign={nameAlign}
          primaryGlyphStyle={primaryGlyphStyle}
          secondaryGlyphStyle={secondaryGlyphStyle}
          typingDotSurfaceStyle={typingDotSurfaceStyle}
          typingAnim={typingAnim}
          statusAnim={statusAnim}
          onlineAnim={onlineAnim}
          lastSeenAnim={lastSeenAnim}
          onPress={titlePressHandler}
          onlineLabel={onlineLabel}
          a11yLabel={
            onOpenProfilePress
              ? t('a11y.openProfile')
              : onGroupInfoPress
                ? t('a11y.groupInfo')
                : undefined
          }
        />

        <View style={{ flexDirection: rowDir, alignItems: 'center', columnGap: CHAT_HEADER_ACTION_GAP }}>
          {!hideCallButtons ? (
            <HeaderIconButton
              onPress={handleVideoCall}
              onPressIn={() => !callDisabled && !activeVideoRing && pressIn(videoScale)}
              onPressOut={() => pressOut(videoScale)}
              disabled={callDisabled || activeVideoRing}
              icon="video"
              label={t('calls.videoCall')}
              iconColor={iconTint}
              children={
                <Reanimated.View
                  style={[
                    {
                      width: CHAT_HEADER_ACTION,
                      height: CHAT_HEADER_ACTION,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    videoScaleStyle,
                  ]}
                >
                  <HeaderCallRing
                    active={activeVideoRing}
                    size={CHAT_HEADER_ACTION}
                    circleProps={callRingCircleProps}
                  />
                  <Feather name="video" size={CHAT_HEADER_ICON} color={iconTint} />
                </Reanimated.View>
              }
            />
          ) : null}
          {!hideCallButtons ? (
            <HeaderIconButton
              onPress={handleVoiceCall}
              onPressIn={() => !callDisabled && !activeVoiceRing && pressIn(voiceScale)}
              onPressOut={() => pressOut(voiceScale)}
              disabled={callDisabled || activeVoiceRing}
              icon="phone"
              label={t('calls.audioCall')}
              iconColor={iconTint}
              children={
                <Reanimated.View
                  style={[
                    {
                      width: CHAT_HEADER_ACTION,
                      height: CHAT_HEADER_ACTION,
                      alignItems: 'center',
                      justifyContent: 'center',
                    },
                    voiceScaleStyle,
                  ]}
                >
                  <HeaderCallRing
                    active={activeVoiceRing}
                    size={CHAT_HEADER_ACTION}
                    circleProps={callRingCircleProps}
                  />
                  <Feather name="phone" size={CHAT_HEADER_ICON} color={iconTint} />
                </Reanimated.View>
              }
            />
          ) : null}
          <HeaderIconButton
            onPress={handleMenuOpen}
            icon="more-vertical"
            label={t('messages.moreMenu')}
            iconColor={iconTint}
          />
        </View>
      </View>

      <View
        pointerEvents="none"
        style={[{ height: StyleSheet.hairlineWidth, width: '100%' }, dividerLineStyle]}
      />

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
    </View>
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
  /** First Firestore message snapshot merged â€” ends skeleton; enables typing + read-receipt work. */
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
    if (!chatId) return;
    perfScreenOpen('Chat', { chatId: chatId.slice(0, 8) });
    const task = InteractionManager.runAfterInteractions(() => {
      void import('@/lib/services/callService').catch(() => {});
    });
    return () => task.cancel?.();
  }, [chatId]);
  
  // State
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
  const [creatingCall, setCreatingCall] = useState(false);
  const [outgoingCallKind, setOutgoingCallKind] = useState<'video' | 'voice' | null>(null);
  const [listRefreshing, setListRefreshing] = useState(false);
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
  const { width: windowWidth, height: viewportHeight } = useWindowDimensions();

  /** Load heavy modals on demand only — eager preload blocked Android chat open. */
  const preloadLazyChatUi = false;
  const loadEmojiPicker = useCallback(() => import('@/components/EmojiPicker'), []);
  const loadImageViewer = useCallback(() => import('@/components/ImageViewer'), []);
  const loadGroupMembersSheet = useCallback(() => import('@/components/GroupMembersSheet'), []);
  const LazyEmojiPicker = useLazyComponent(loadEmojiPicker, preloadLazyChatUi || showEmojiPicker);
  const LazyImageViewer = useLazyComponent(loadImageViewer, preloadLazyChatUi || !!viewingImage);
  const LazyGroupMembersSheet = useLazyComponent(
    loadGroupMembersSheet,
    preloadLazyChatUi || groupMembersOpen
  );

  const composerRef = useRef<ChatMessageComposerHandle>(null);

  // Refs
  const messageRefs = useRef<Record<string, number>>({});
  const isCleaningUpRef = useRef(false);
  const isStartingRef = useRef(false);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastStartTimestampRef = useRef<number>(0);
  const isMicPressedRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  /** After optimistic prepend at bottom, skip one auto scrollToOffset (fights keyboard + duplicate scroll). */
  const suppressNextBottomScrollRef = useRef(false);
  /** In-flight text send generation — ignore stale completions after rapid sends. */
  const textSendGenerationRef = useRef(0);
  const visibleLastMessageLogRef = useRef<string | null>(null);
  const inChatSearchCursorRef = useRef(-1);
  const insets = useSafeAreaInsets();
  const isMountedRef = useRef(true);
  const mediaComposerAnim = useRef(new RNAnimated.Value(0)).current;
  const mediaProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaSendingGuardRef = useRef(false);
  const messageListenerViewerUidRef = useRef<string | undefined>(user?.uid);
  messageListenerViewerUidRef.current = user?.uid;

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
          composerRef.current?.setText(draft);
        }
      });
    });
    return () => {
      task.cancel?.();
    };
  }, [chatId]);

  // Hydrate header/title from list cache before first paint (tapâ†’visible shell).
  useLayoutEffect(() => {
    if (!chatId) return;
    const cachedChat = useChatStore.getState().chats.find((c) => c.id === chatId);
    if (cachedChat) {
      setChat(cachedChat);
    }
    const cachedCount = useChatStore.getState().messagesByChat[chatId]?.length ?? 0;
    if (cachedCount > 0) {
      markChatCacheHit(chatId, cachedCount);
    }
    markChatFirstLayout(chatId);
  }, [chatId]);

  const messageCount = useChatStore(
    (state) => (chatId ? state.messagesByChat[chatId]?.length ?? 0 : 0)
  );
  const messagesSource = useChatStore((state) =>
    chatId ? state.messagesSourceByChat[chatId] : undefined
  );
  const { isOnline } = useNetworkState();

  const messagesRef = useRef<ChatMessage[]>(EMPTY_MESSAGES);

  const {
    isAtBottomRef,
    showNewMessagesButton,
    showLoadingOlderBanner,
    stickyDateLabel,
    newMessagesCount,
    handleScroll,
    onScrollFabPress: onScrollFabPressStable,
    handleListContentSizeChange,
  } = useChatScrollController({
    chatId,
    listRef,
    messageCount,
    hasMoreOlderMessages,
    messagesRef,
    suppressNextBottomScrollRef,
    formatDateHeader,
  });

  const { onRootLayout, onFlatListLayout, onComposerLayout } = useChatWindowResizeProbe(
    __DEV__ && !!chatId && Platform.OS === 'android'
  );

  const { onViewableMessages: onViewableMessagesForReceipts } = useChatReadReceipts({
    chatId,
    userId: user?.uid,
    chat,
    streamHydrated: messageStreamHydrated,
  });

  const onReactionTrayDismissStable = useCallback(() => {
    setReactionTrayMessageId(null);
  }, []);

  // ========================================
  // EFFECTS
  // ========================================
  
  useEffect(() => {
    setHasMoreOlderMessages(true);
  }, [chatId]);

  useEffect(() => {
    accessRevokedAlertRef.current = false;
    setAccessRevoked(false);
    messageRefs.current = {};
  }, [chatId]);

  useEffect(() => {
    listContentSizedRef.current = false;
    chatDocFirstSnapRef.current = false;
    userDocFirstSnapRef.current = false;
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    const cachedCount = useChatStore.getState().messagesByChat[chatId]?.length ?? 0;
    const hasCache = cachedCount > 0;
    messageStreamHydratedRef.current = hasCache;
    setMessageStreamHydrated(hasCache);
    if (hydrateFallbackTimerRef.current) {
      clearTimeout(hydrateFallbackTimerRef.current);
      hydrateFallbackTimerRef.current = null;
    }
    if (hasCache) {
      return;
    }
    hydrateFallbackTimerRef.current = setTimeout(() => {
      hydrateFallbackTimerRef.current = null;
      if (!messageStreamHydratedRef.current) {
        messageStreamHydratedRef.current = true;
        setMessageStreamHydrated(true);
      }
    }, 8000);
    return () => {
      if (hydrateFallbackTimerRef.current) {
        clearTimeout(hydrateFallbackTimerRef.current);
        hydrateFallbackTimerRef.current = null;
      }
    };
  }, [chatId]);

  // Disk shard → instant paint; live listener handles network when store is still empty.
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;

    const hydrateFromDisk = async () => {
      const inMemory = useChatStore.getState().messagesByChat[chatId];
      if (inMemory?.length) {
        markMessagesStreamHydrated();
        return;
      }

      try {
        const shards = await persistence.loadShardsForChatIds([chatId]);
        if (cancelled) return;
        const diskMsgs = shards[chatId];
        if (diskMsgs?.length) {
          const store = useChatStore.getState();
          store.setMessagesSource(chatId, 'cache');
          store.setMessages(chatId, diskMsgs, false);
          markMessagesStreamHydrated();
        }
      } catch {
        /* listener is the network fallback */
      }
    };

    void hydrateFromDisk();
    return () => {
      cancelled = true;
    };
  }, [chatId, markMessagesStreamHydrated]);

  useEffect(() => {
    if (!chatId || messageCount === 0) return;
    markMessagesStreamHydrated();
  }, [chatId, messageCount, markMessagesStreamHydrated]);

  useEffect(() => {
    setMessageListenerViewerUid(user?.uid);
  }, [user?.uid]);

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
        getListenerPageSize(),
        () => {
          markMessagesStreamHydrated();
        },
        { viewerUid: messageListenerViewerUidRef.current }
      );
    };
    const scheduleListener = () => {
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
    };
    if (Platform.OS === 'android' && !isLegacyAndroid()) {
      startListener();
    } else {
      raf1 = requestAnimationFrame(scheduleListener);
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
      stopChatMessageListener();
      openPerfReadyRef.current = false;
      openPerfMessagesLoadedRef.current = false;
      clearChatOpenMark(chatId);
      queueMicrotask(() => {
        useChatStore.getState().trimMemoryFootprint([chatId]);
      });
    };
  }, [chatId, markMessagesStreamHydrated]);

  useEffect(() => {
    if (!chatId || !messageStreamHydrated) return;
    void stopPerformanceTrace('chat_room_load', {
      message_count: String(messageCount),
    });
  }, [chatId, messageStreamHydrated, messageCount]);

  useEffect(() => {
    if (!chatId || openPerfMessagesLoadedRef.current) return;
    if (messageCount === 0) return;
    openPerfMessagesLoadedRef.current = true;
    markChatMessagesLoaded(chatId, messageCount);
    const id = requestAnimationFrame(() => {
      if (!openPerfReadyRef.current) {
        openPerfReadyRef.current = true;
        markChatReady(chatId);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [chatId, messageCount]);

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
          exitChatScreen(router);
        },
      },
    ]);
  }, [chatId, router, t]);
  
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
                  user?.uid,
                  participantPhonesRef.current
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
        unsubscribe = onSnapshot(chatRef, FIRESTORE_SNAPSHOT_OPTS, (chatDoc) => {
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
                user?.uid,
                participantPhonesRef.current
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
    if (!chatId || messageCount === 0) return;
    if (didInitialAiScrollRef.current) return;
    didInitialAiScrollRef.current = true;
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [isGywAiChat, chatId, messageCount]);

  const appLogoUri = useMemo(() => {
    try {
      return RNImage.resolveAssetSource(require('../../../assets/images/gyw_fox_logo.png')).uri;
    } catch {
      return undefined;
    }
  }, []);
  
  // Other user's profile + presence: defer past open transition (header can show cached title/avatar from chat).
  useEffect(() => {
    const otherCount = chat?.participants?.filter((p) => p !== user?.uid).length ?? 0;
    if (!otherParticipantId || (chat?.type === 'group' && otherCount !== 1)) {
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
        unsubscribe = onSnapshot(userRef, FIRESTORE_SNAPSHOT_OPTS, (userDoc) => {
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
  
  /** Firestore typing â€” never write on every keystroke (was blocking UI / network). */
  const typingFirestoreTimersRef = useRef<{
    toTrue?: ReturnType<typeof setTimeout>;
    toFalse?: ReturnType<typeof setTimeout>;
  }>({});
  const dismissComposerOverlays = useCallback(() => {
    setShowEmojiPicker(false);
    setShowAttachOptions(false);
  }, []);

  const scheduleComposerTyping = useCallback(
    (hasTrimmedText: boolean) => {
      if (!chatId || !user) return;
      const timers = typingFirestoreTimersRef.current;
      const clearTypingTimers = () => {
        if (timers.toTrue) {
          clearTimeout(timers.toTrue);
          timers.toTrue = undefined;
        }
        if (timers.toFalse) {
          clearTimeout(timers.toFalse);
          timers.toFalse = undefined;
        }
      };

      if (!hasTrimmedText) {
        clearTypingTimers();
        setTypingIndicator(chatId, user.uid, false).catch(() => {});
        return;
      }

      if (!timers.toTrue) {
        timers.toTrue = setTimeout(() => {
          timers.toTrue = undefined;
          setTypingIndicator(chatId, user.uid, true).catch(() => {});
        }, 350);
      }
      if (timers.toFalse) clearTimeout(timers.toFalse);
      timers.toFalse = setTimeout(() => {
        timers.toFalse = undefined;
        setTypingIndicator(chatId, user.uid, false).catch(() => {});
      }, 2000);
    },
    [chatId, user],
  );

  useEffect(() => {
    return () => {
      const timers = typingFirestoreTimersRef.current;
      if (timers.toTrue) clearTimeout(timers.toTrue);
      if (timers.toFalse) clearTimeout(timers.toFalse);
      if (chatId && user?.uid) {
        setTypingIndicator(chatId, user.uid, false).catch(() => {});
      }
    };
  }, [chatId, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      if (!chatId || !user?.uid) return () => {};
      if (Platform.OS === 'android') {
        setAndroidForegroundChatId(chatId);
      }
      useChatStore.getState().bulkResetUnreadForUser(user.uid, [chatId]);
      void syncChatReadState({
        chatId,
        userId: user.uid,
        source: markRead === '1' ? 'notification_action' : 'chatroom_open',
        skipStoreReset: true,
        deferNativeAndFirestore: true,
      }).catch(() => {});
      return () => {
        if (Platform.OS === 'android') {
          setAndroidForegroundChatId(null);
        }
      };
    }, [chatId, user?.uid, markRead]),
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        exitChatScreen(router);
        return true;
      });
      return () => sub.remove();
    }, [router]),
  );

  useEffect(() => {
    if (Platform.OS !== 'android' || !chatId || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await consumeAndroidPendingReplyJson();
        if (cancelled || !raw) return;
        const o = JSON.parse(raw) as { chatId?: string; body?: string };
        if (o.chatId !== chatId || !o.body?.trim()) return;
        composerRef.current?.setText(o.body);
        requestAnimationFrame(() => composerRef.current?.focus());
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

      const userImageMessageId = await sendMediaMessageReliable(
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
      } else if (isMediaSendQueuedError(error)) {
        Alert.alert(t('common.error'), t('messages.mediaQueuedForRetry', { defaultValue: 'Upload queued — will retry when you are back online.' }));
        setMediaComposerVisible(false);
        setMediaComposerUri(null);
        setMediaComposerCaption('');
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
              await sendMediaMessageReliable(
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
    const text = composerRef.current?.getTrimmedText() ?? '';
    if (!chatId || !text || !user) return;
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

    // Optimistic UI first â€” do not await Firestore before this commit (WhatsApp-style).
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
    const lastPreview = {
      text: text.substring(0, 100),
      senderId: user.uid,
      createdAt: now,
    };
    unstable_batchedUpdates(() => {
      suppressNextBottomScrollRef.current = true;
      useChatStore.getState().addMessage(chatId, optimisticMessage);
      useChatStore.getState().updateChat(chatId, {
        lastMessage: lastPreview,
        lastMessageAt: now,
        lastSenderId: user.uid,
        updatedAt: now,
      });
      composerRef.current?.clear();
      setReplyingTo(null);
      setShowEmojiPicker(false);
    });
    if (chatId) AsyncStorage.removeItem(`draft_${chatId}`).catch(() => {});
    void enqueueOutboxMessage({
      tempId,
      chatId,
      senderId: user.uid,
      senderName: user?.displayName || user?.phoneNumber || 'User',
      senderAvatar: user?.photoURL ?? undefined,
      text,
      replyTo: replySnapshot,
      sendOptions: recipientSendOptions,
      createdAt: now,
    });
    queueMicrotask(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });

    const sendGen = ++textSendGenerationRef.current;
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
          if (sendGen !== textSendGenerationRef.current) return;
          useChatStore.getState().updateMessage(chatId, tempId, { id: messageId, status: 'sent' });
          void removeOutboxMessage(tempId);

          if (isGywAiChat) {
            const aiTempId = `ai-pending-${Date.now()}`;
            const aiOptimistic: ChatMessage = {
              id: aiTempId,
              chatId,
              senderId: GYW_AI_SYSTEM_ID,
              senderName: GYW_AI_DISPLAY_NAME,
              senderAvatar: undefined,
              isAI: true,
              text: 'Gyw AI is thinkingâ€¦',
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
          if (sendGen !== textSendGenerationRef.current) return;
          if (__DEV__) console.error('Error sending message:', error);
          useChatStore.getState().updateMessage(chatId, tempId, { status: 'failed' });
          if (error instanceof BlockedPeerSendError) {
            Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
          } else {
            Alert.alert(t('common.error'), t('messages.failedToSend'));
          }
        }
    })();
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
      text: 'Gyw AI is thinkingâ€¦',
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
    composerRef.current?.appendText(emoji);
    composerRef.current?.focus();
  };
  
  const handleSwipeToReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message);
  }, []);

  const handleLongPress = useCallback((message: ChatMessage) => {
    if (message.deleted) return;
    setBodyContextMessage(null);
    setActionMenuMessage(message);
  }, []);

  // Stable tap handlers â€” no deps, never recreated, safe to pass directly to BodySwipeableRow
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
    // Read from ref â€” always current, never stale, no dep on messages array needed.
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
    
    // âš ï¸ CRITICAL FIX: Capture reference BEFORE async operations
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
          await sendMediaMessageReliable(
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
          } else if (isMediaSendQueuedError(err)) {
            Alert.alert(t('common.error'), t('messages.mediaQueuedForRetry', { defaultValue: 'Upload queued — will retry when you are back online.' }));
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
          // Generate thumbnail from first frame (non-blocking â€” failure is silently ignored)
          let thumbnailUri: string | undefined;
          try {
            const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 0, quality: 0.6 });
            thumbnailUri = thumb.uri;
          } catch {
            // Thumbnail generation failed â€” video still uploads, shows black placeholder
          }
          await sendMediaMessageReliable(
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
          } else if (isMediaSendQueuedError(error)) {
            Alert.alert(t('common.error'), t('messages.mediaQueuedForRetry', { defaultValue: 'Upload queued — will retry when you are back online.' }));
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
        // context â†’ Permission Denial. Copying yields file:// under app cache. iOS usually returns a readable tmp path.
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
        await sendMediaMessageReliable(
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
        } else if (isMediaSendQueuedError(error)) {
          Alert.alert(t('common.error'), t('messages.mediaQueuedForRetry', { defaultValue: 'Upload queued — will retry when you are back online.' }));
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

  const contactsRevision = useContactsStore((s) => s.revision);
  const contactsReady = useContactsStore((s) => s.contactsReady);
  const displayName = useMemo(() => {
    if (!chat) return 'Chat';
    if (isGywAiChat) return GYW_AI_DISPLAY_NAME;
    const otherParticipant = chat.participants.find((p) => p !== user?.uid);
    const participantDataName = otherParticipant
      ? chat.participantData?.[otherParticipant]?.name
      : undefined;
    const participantDataPhone = otherParticipant
      ? (chat.participantData?.[otherParticipant] as { phoneNumber?: string } | undefined)
          ?.phoneNumber
      : undefined;
    return formatChatListTitle({
      type: chat.type,
      name: chat.name,
      otherUser,
      participantDataName,
      participantDataPhone,
      participantCount: chat.participants?.length ?? 0,
      fallbackUnknown: t('calls.unknown'),
      fallbackGroup: t('chats.groupChat'),
    });
  }, [chat, otherUser, otherUser?.phoneNumber, user?.uid, isGywAiChat, contactsRevision, contactsReady, t]);

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

  const showSyncingSubtitle =
    isOnline &&
    !messageStreamHydrated &&
    messageCount > 0 &&
    (messagesSource === 'cache' || messagesSource === 'warm' || messagesSource === undefined);

  const headerLastSeenLine = useMemo(() => {
    if (showSyncingSubtitle && !typingUiActive) {
      return 'Syncingâ€¦';
    }
    if (chat?.type === 'group') {
      const n = chat.participantCount ?? chat.participants?.length ?? 0;
      return t('groups.memberCount', { count: n });
    }
    if (isGywAiChat) return GYW_AI_DISPLAY_NAME;
    return lastSeenText || '\u00a0';
  }, [
    showSyncingSubtitle,
    typingUiActive,
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
  
  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item: ChatMessage }> }) => {
      if (__DEV__) {
        const newestId = messagesRef.current[0]?.id ?? null;
        const visibleNewest = !!newestId && viewableItems.some((v) => v.item?.id === newestId);
        const logKey = `${newestId ?? 'none'}:${visibleNewest ? 1 : 0}:${viewableItems.length}`;
        if (visibleLastMessageLogRef.current !== logKey) {
          visibleLastMessageLogRef.current = logKey;
          console.log('CHAT_VISIBLE_LAST_MESSAGE', {
            newestId,
            visible: visibleNewest,
            visibleCount: viewableItems.length,
          });
        }
      }
      if (!messageStreamHydratedRef.current) return;
      onViewableMessagesForReceipts(viewableItems.map((v) => v.item));
    },
    [onViewableMessagesForReceipts]
  );
  
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
    if (chatId && !listContentSizedRef.current) {
      const count = messagesRef.current.length;
      if (count > 0) {
        listContentSizedRef.current = true;
        markFlatListContentSized(chatId, count);
      }
    }
    handleListContentSizeChange();
  }, [chatId, handleListContentSizeChange]);

  const viewabilityConfigMemo = useMemo(() => ({
    itemVisiblePercentThreshold: 50,
  }), []);

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

  const participantPhones = useMemo(() => {
    const map: Record<string, string> = {};
    if (user?.uid && user.phoneNumber) map[user.uid] = user.phoneNumber;
    if (otherUser?.uid && otherUser.phoneNumber) map[otherUser.uid] = otherUser.phoneNumber;
    return map;
  }, [user?.uid, user?.phoneNumber, otherUser?.uid, otherUser?.phoneNumber]);

  const participantPhonesRef = useRef(participantPhones);
  participantPhonesRef.current = participantPhones;

  // Hoisted outside renderMessage â€” windowWidth never changes mid-session on phones.
  const bubbleMaxWidth = Math.max(0, windowWidth * 0.72 - 16);

  // Pre-built date label style â€” created once per metaMutedColor change (theme toggle only).
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
                participantPhones={participantPhones}
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
    handleTapStable, handleDoubleTapItem, participantPhones, contactsRevision,
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
    <View style={{ flex: 1, backgroundColor: isDark ? '#111827' : '#ffffff' }} onLayout={onRootLayout}>
      {/* Native adjustResize: flex column — header | FlatList (flex:1) | composer. No absolute composer. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, minHeight: 0 }}>
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
        onBack={() => exitChatScreen(router)}
        onVideoCall={() => {
          if (isGywAiChat) return;
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const oid = chat.participants.find((p) => p !== user.uid);
          if (!oid) return;
          setCreatingCall(true);
          setOutgoingCallKind('video');
          startOutgoingCall({
            router,
            callerId: user.uid,
            calleeId: oid,
            callType: 'video',
            chatId,
            callerName: user.displayName ?? undefined,
            callerAvatar: user.photoURL ?? undefined,
          });
          setTimeout(() => {
            setOutgoingCallKind(null);
            setCreatingCall(false);
          }, 3000);
        }}
        onVoiceCall={() => {
          if (isGywAiChat) return;
          if (!chat || !user || chat.type === 'group' || creatingCall) return;
          const oid = chat.participants.find((p) => p !== user.uid);
          if (!oid) return;
          setCreatingCall(true);
          setOutgoingCallKind('voice');
          startOutgoingCall({
            router,
            callerId: user.uid,
            calleeId: oid,
            callType: 'audio',
            chatId,
            callerName: user.displayName ?? undefined,
            callerAvatar: user.photoURL ?? undefined,
          });
          setTimeout(() => {
            setOutgoingCallKind(null);
            setCreatingCall(false);
          }, 3000);
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
                navigateOnce(router, 'push', `/(home)/group-info/${chatId}` as never);
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
                    navigateOnce(router, 'push', `/(home)/group-info/${chatId}` as never);
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
      
      <View style={{ flex: 1, minHeight: 0 }}>
        <View style={{ flex: 1, minHeight: 0 }}>
        <ChatMessagesPane chatId={chatId!}>
          {(messages) => {
            messagesRef.current = messages;
            return (
        <ChatRoomBody
          messages={messages}
          screenWidth={windowWidth}
          viewportHeight={viewportHeight}
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
          onListContainerLayout={onFlatListLayout}
          listExtraData={listSearchExtraData}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfigMemo}
          disableMaintainVisibleContentPosition={!!isGywAiChat}
          refreshControl={listRefreshControl}
          stickyDateOverlay={stickyDateOverlayEl}
          showScrollFab={showNewMessagesButton}
          scrollFabBottom={16}
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
            );
          }}
        </ChatMessagesPane>
        </View>

        {/* Input toolbar (spec: min 52 / max 120 row, 12+8 padding, 10px gaps, 48px targets) */}
        <View
          onLayout={onComposerLayout}
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
                    || (replyingTo.type === 'image' ? `ðŸ“· ${t('messages.photo')}`
                    : replyingTo.type === 'video' ? `ðŸŽ¥ ${t('messages.video')}`
                    : replyingTo.type === 'document' || replyingTo.type === 'file' ? `ðŸ“Ž ${t('messages.document')}`
                    : replyingTo.type === 'location' ? `ðŸ“ ${t('location.share')}`
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

          <ChatMessageComposer
            ref={composerRef}
            chatId={chatId}
            isDark={!!isDark}
            colorScheme={colorScheme}
            locked={composerInputLocked}
            sending={sending}
            isRecording={isRecording}
            iconColor={iconColor}
            onTypingActivity={scheduleComposerTyping}
            onSend={handleSendMessage}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onOpenAttach={openAttachTray}
            onDismissOverlays={dismissComposerOverlays}
          />
        </View>
      </View>

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

        </View>
      </SafeAreaView>

      {user && chat?.type === 'group' && LazyGroupMembersSheet ? (
        <LazyGroupMembersSheet
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

      {LazyEmojiPicker ? (
        <LazyEmojiPicker
          visible={showEmojiPicker}
          onEmojiSelect={handleEmojiSelect}
          onClose={() => setShowEmojiPicker(false)}
        />
      ) : null}

      {LazyImageViewer ? (
        <LazyImageViewer
          visible={!!viewingImage}
          imageUri={viewingImage || ''}
          onClose={() => setViewingImage(null)}
        />
      ) : null}
      
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
