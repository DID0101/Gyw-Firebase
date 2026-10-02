import { bumpChatPerfRender } from '@/lib/chatOpenPerf';
import { CHAT_DELETED_FOR_EVERYONE_TEXT } from '@/lib/constants/chatMessages';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dimensions, Image as RNImage, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { isLowTierAndroid } from '@/lib/perf/deviceProfile';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { ChatMessage } from '@/lib/types/chat';
import { formatBubbleTime } from '@/lib/utils/chatUtils';
import AudioMessage from './AudioMessage';
import { DocumentMessageRow } from './DocumentMessageRow';
import LocationMessageBubble from './LocationMessageBubble';
import MessageStatusIndicator from './MessageStatusIndicator';
import PreviewAvatar from './PreviewAvatar';
import { GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';
import { resolveMessageSenderLabel, safePreviewText } from '@/lib/chatDisplayText';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const LOW_TIER_MEDIA = Platform.OS === 'android' && isLowTierAndroid();
// Bubble max = 72% of screen — comfortable on phones from 320px to 428px wide
const BUBBLE_MAX_WIDTH = Math.min(SCREEN_WIDTH * 0.72, LOW_TIER_MEDIA ? 280 : 320);
// Image fills the bubble minus a small inset (smaller decode on API ≤29)
const IMAGE_WIDTH = Math.min(SCREEN_WIDTH * (LOW_TIER_MEDIA ? 0.58 : 0.62), LOW_TIER_MEDIA ? 220 : 260);
const IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 0.75);
const LIST_IMAGE_PRIORITY = LOW_TIER_MEDIA ? ('low' as const) : ('normal' as const);
const AUDIO_WIDTH = Math.min(SCREEN_WIDTH * 0.65, 280);

interface MessageBubbleProps {
  message: ChatMessage;
  isMyMessage: boolean;
  textColor: string;
  textSecondaryColor: string;
  colorScheme: 'light' | 'dark';
  isDark: boolean;
  isGroupChat: boolean;
  onReplyPress: (messageId: string) => void;
  onMediaPress: (mediaUrl: string, mediaType: 'image' | 'video') => void;
  onDocumentPress?: (message: ChatMessage) => void;
  onLocationPress?: (message: ChatMessage) => void;
  onLongPress: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  showTail?: boolean;
  showSenderName?: boolean;
  showAvatar?: boolean;
  /** senderId → phone for local contact name resolution in groups */
  participantPhones?: Record<string, string | null | undefined>;
}

function areReactionMapsEqual(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const av = a[key];
    const bv = b[key];
    if (!Array.isArray(av) || !Array.isArray(bv)) return false;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i += 1) {
      if (av[i] !== bv[i]) return false;
    }
  }
  return true;
}

function isReplyRefEqual(
  a: ChatMessage['replyTo'],
  b: ChatMessage['replyTo']
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    a.messageId === b.messageId &&
    a.senderName === b.senderName &&
    a.text === b.text &&
    a.type === b.type
  );
}

const MessageBubble = memo<MessageBubbleProps>(({
  message,
  isMyMessage,
  textColor,
  textSecondaryColor,
  colorScheme,
  isDark,
  isGroupChat,
  onReplyPress,
  onMediaPress,
  onDocumentPress,
  onLocationPress,
  onLongPress,
  onRetry,
  showTail = true,
  showSenderName = true,
  showAvatar = false,
  participantPhones,
}) => {
  if (__DEV__) bumpChatPerfRender('MessageBubble');

  const { t } = useTranslation();
  const isAiMessage = !!(message && (message.isAI || message.senderId === GYW_AI_SYSTEM_ID));
  const aiAvatarUri = useMemo(() => {
    if (!isAiMessage) return undefined;
    try {
      return RNImage.resolveAssetSource(require('../assets/images/gyw_fox_logo.png')).uri;
    } catch {
      return undefined;
    }
  }, [isAiMessage]);

  // Compute display height from stored dimensions; fall back to fixed 4:3 ratio
  const imageDisplayHeight = useMemo(() => {
    if (message?.imageWidth && message?.imageHeight && message.imageWidth > 0) {
      return Math.round(IMAGE_WIDTH * message.imageHeight / message.imageWidth);
    }
    return IMAGE_HEIGHT;
  }, [message?.imageWidth, message?.imageHeight]);

  const timeLabel = useMemo(
    () => (message ? formatBubbleTime(message.createdAt || message.sentAt) : ''),
    [message]
  );

  if (!message) return null;

  const senderLabel = isAiMessage
    ? GYW_AI_DISPLAY_NAME
    : resolveMessageSenderLabel(
        {
          senderName: message.senderName,
          phoneNumber: participantPhones?.[message.senderId],
        },
        'Unknown'
      );
  const messageBodyText = safePreviewText(message.text, 10000);
  const replySenderLabel = resolveMessageSenderLabel(
    { senderName: message.replyTo?.senderName },
    'Unknown'
  );
  const replyBodyText = safePreviewText(message.replyTo?.text, 500);

  // ── Lightweight system line (member_removed, etc.) ──────────────────────
  if (message.type === 'system') {
    const label = messageBodyText;
    return (
      <View className="items-center my-1.5 px-6" accessibilityRole="text">
        <Text
          className={clsx('text-xs text-center', isDark ? 'text-gray-500' : 'text-gray-500')}
          numberOfLines={4}
        >
          {label || ' '}
        </Text>
      </View>
    );
  }

  // ── Call system message ──────────────────────────────────────────────────
  if (message.type === 'call') {
    return (
      <View className="items-center my-2" accessibilityRole="text">
        <View className={clsx(
          'flex-row items-center gap-2 px-4 py-1.5 rounded-full',
          isDark ? 'bg-gray-800' : 'bg-gray-100'
        )}>
          <Feather
            name="phone"
            size={12}
            color={isDark ? '#9ca3af' : '#6b7280'}
          />
          <Text className={clsx('text-xs', isDark ? 'text-gray-300' : 'text-gray-600')}>
            {messageBodyText}
          </Text>
        </View>
      </View>
    );
  }

  const isFailed = message.status === 'failed';
  const isDeletedEveryone = !!message.deleted;

  /** WhatsApp-style: time + ticks live inside the document card when it is the only payload. */
  const documentOwnsFooter =
    !isDeletedEveryone &&
    !!message.fileUrl &&
    (message.type === 'document' || message.type === 'file') &&
    !messageBodyText &&
    !message.imageUrl &&
    !message.videoUrl &&
    !message.audioUrl;

  const locationOwnsFooter =
    !isDeletedEveryone &&
    message.type === 'location' &&
    !!message.previewUrl &&
    !messageBodyText;

  const liveLocationExpired =
    !!message.isLive &&
    !!message.expiresAt &&
    !Number.isNaN(Date.parse(message.expiresAt)) &&
    Date.parse(message.expiresAt) <= Date.now();

  // Bubble colors — my messages: brand teal; theirs: white (light) / dark-gray (dark)
  const myBg    = '#FF5722';
  const theirBg = isDark ? '#1f2937' : '#ffffff';
  const aiBg = isDark ? '#312e81' : '#eef2ff'; // indigo-ish, distinct from normal chats
  const bubbleBg = isAiMessage ? aiBg : (isMyMessage ? myBg : theirBg);

  // Tail border-radius: WhatsApp-style pointy corner
  const borderRadius = showTail
    ? isMyMessage
      ? { borderRadius: 18, borderBottomRightRadius: 4 }
      : { borderRadius: 18, borderBottomLeftRadius: 4 }
    : { borderRadius: 18 };

  return (
    <Pressable
      onLongPress={() => onLongPress(message)}
      delayLongPress={400}
      className={clsx(
        'flex-row',
        isMyMessage ? 'justify-end' : 'justify-start',
        showTail ? 'mb-1' : 'mb-0.5'
      )}
      accessibilityRole="button"
      accessibilityLabel={message.deleted ? 'Deleted message' : messageBodyText || 'Media message'}
    >
      {/* Receiver avatar in group chats */}
      {!isMyMessage && showAvatar && (isGroupChat || isAiMessage) ? (
        <View className="mr-1.5 self-end mb-0.5">
          <PreviewAvatar
            name={senderLabel}
            image={isAiMessage ? aiAvatarUri : message.senderAvatar}
            size={30}
            fontSize={12}
            imagePriority={LIST_IMAGE_PRIORITY}
          />
        </View>
      ) : !isMyMessage && (isGroupChat || isAiMessage) ? (
        <View style={{ width: 31.5 + 6 }} />
      ) : null}

      <View
        style={[
          {
            maxWidth: BUBBLE_MAX_WIDTH,
            paddingHorizontal: 10,
            paddingVertical: 7,
            backgroundColor: bubbleBg,
            ...borderRadius,
          },
          !isMyMessage && {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: isDark ? 0 : 0.07,
            shadowRadius: 2,
            elevation: 1,
          },
        ]}
      >
        {/* Group sender name */}
        {!isMyMessage && showSenderName && (isGroupChat || isAiMessage) && (
          <Text
            style={{ fontSize: 12, fontWeight: '600', marginBottom: 2 }}
            className={textSecondaryColor}
          >
            {senderLabel}
          </Text>
        )}

        {/* Reply preview — hidden when deleted for everyone (tombstone only) */}
        {!isDeletedEveryone && message.replyTo && (
          <Pressable
            onPress={() => onReplyPress(message.replyTo!.messageId)}
            style={{
              marginBottom: 6,
              paddingLeft: 8,
              paddingVertical: 4,
              borderLeftWidth: 3,
              borderLeftColor: isMyMessage ? 'rgba(255,255,255,0.6)' : '#FF5722',
              borderRadius: 4,
              backgroundColor: isMyMessage ? 'rgba(255,255,255,0.12)' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
            }}
          >
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: '600',
                marginBottom: 1,
                color: isMyMessage ? 'rgba(255,255,255,0.85)' : '#FF5722',
              }}
              numberOfLines={1}
            >
              {replySenderLabel}
            </Text>
            <Text
              style={{
                fontSize: 11.5,
                color: isMyMessage ? 'rgba(255,255,255,0.65)' : (isDark ? '#9ca3af' : '#6b7280'),
              }}
              numberOfLines={2}
            >
              {replyBodyText
                || (message.replyTo.type === 'image' ? '📷 Photo'
                : message.replyTo.type === 'video' ? '🎥 Video'
                : message.replyTo.type === 'document' || message.replyTo.type === 'file' ? '📎 Document'
                : message.replyTo.type === 'location' ? '📍 Location'
                : '🎤 Voice message')}
            </Text>
          </Pressable>
        )}

        {/* Story reply context (DM from story viewer) */}
        {!isDeletedEveryone && message.storyReply && message.type === 'text' && (
          <View
            style={{
              marginTop: message.replyTo ? 4 : 0,
              marginBottom: 6,
              flexDirection: 'row',
              alignItems: 'center',
              padding: 6,
              borderRadius: 8,
              borderLeftWidth: 3,
              borderLeftColor: isMyMessage ? 'rgba(255,255,255,0.55)' : '#FF5722',
              backgroundColor: isMyMessage ? 'rgba(255,255,255,0.1)' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
            }}
          >
            {message.storyReply.thumbnailUrl ||
            (message.storyReply.mediaUrl && message.storyReply.mediaType !== 'video') ? (
              <ExpoImage
                source={{ uri: message.storyReply.thumbnailUrl || message.storyReply.mediaUrl }}
                style={{ width: 40, height: 52, borderRadius: 6 }}
                contentFit="cover"
                priority={LIST_IMAGE_PRIORITY}
              />
            ) : (
              <View
                style={{
                  width: 40,
                  height: 52,
                  borderRadius: 6,
                  backgroundColor: isMyMessage ? 'rgba(255,255,255,0.15)' : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather
                  name={message.storyReply.mediaType === 'video' ? 'film' : 'image'}
                  size={18}
                  color={isMyMessage ? 'rgba(255,255,255,0.9)' : '#FF5722'}
                />
              </View>
            )}
            <View style={{ marginLeft: 8, flexShrink: 1, justifyContent: 'center' }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  marginBottom: 2,
                  color: isMyMessage ? 'rgba(255,255,255,0.9)' : '#FF5722',
                }}
                numberOfLines={1}
              >
                {t('stories.replyContext')}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: isMyMessage ? 'rgba(255,255,255,0.75)' : (isDark ? '#d1d5db' : '#4b5563'),
                }}
                numberOfLines={2}
              >
                {message.storyReply.previewLabel?.trim() || '—'}
              </Text>
            </View>
          </View>
        )}

        {/* Deleted message */}
        {message.deleted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather
              name="slash"
              size={13}
              color={isMyMessage ? 'rgba(255,255,255,0.5)' : (isDark ? '#6b7280' : '#9ca3af')}
            />
            <Text
              style={{
                fontSize: 14,
                fontStyle: 'italic',
                color: isMyMessage ? 'rgba(255,255,255,0.55)' : (isDark ? '#6b7280' : '#9ca3af'),
              }}
            >
              {CHAT_DELETED_FOR_EVERYONE_TEXT}
            </Text>
          </View>
        ) : messageBodyText ? (
          <Text
            style={{
              fontSize: 15,
              lineHeight: 21,
              color: isMyMessage ? '#ffffff' : (isAiMessage ? (isDark ? '#e0e7ff' : '#111827') : (isDark ? '#f3f4f6' : '#111827')),
            }}
          >
            {messageBodyText}
          </Text>
        ) : null}

        {/* Image */}
        {!isDeletedEveryone && message.imageUrl && (
          <Pressable
            onPress={() => onMediaPress(message.imageUrl!, 'image')}
            style={{
              marginTop: messageBodyText ? 6 : 0,
              borderRadius: 10,
              overflow: 'hidden',
              width: IMAGE_WIDTH,
              height: imageDisplayHeight,
              backgroundColor: isDark ? '#374151' : '#e5e7eb',
            }}
          >
            <ExpoImage
              source={{ uri: message.imageUrl }}
              style={{ width: IMAGE_WIDTH, height: imageDisplayHeight }}
              contentFit="cover"
              transition={LOW_TIER_MEDIA ? 0 : 200}
              priority={LIST_IMAGE_PRIORITY}
              cachePolicy="disk"
              recyclingKey={message.id}
              placeholder={message.blurhash ? { blurhash: message.blurhash } : { color: '#374151' }}
            />
          </Pressable>
        )}

        {/* Video */}
        {!isDeletedEveryone && message.videoUrl && (
          <Pressable
            onPress={() => onMediaPress(message.videoUrl!, 'video')}
            style={{
              marginTop: messageBodyText ? 6 : 0,
              borderRadius: 10,
              overflow: 'hidden',
              width: IMAGE_WIDTH,
              height: IMAGE_HEIGHT,
              backgroundColor: '#000',
            }}
          >
            {message.videoThumbnailUrl ? (
              <ExpoImage
                source={{ uri: message.videoThumbnailUrl }}
                style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT, position: 'absolute' }}
                contentFit="cover"
                priority={LIST_IMAGE_PRIORITY}
                cachePolicy="disk"
                recyclingKey={`thumb-${message.id}`}
              />
            ) : null}
            <View
              style={{
                ...StyleSheet.absoluteFillObject,
                backgroundColor: 'rgba(0,0,0,0.35)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Feather name="play" size={20} color="#fff" />
              </View>
            </View>
          </Pressable>
        )}

        {/* Audio */}
        {!isDeletedEveryone && message.audioUrl && (
          <View style={{ width: AUDIO_WIDTH, minHeight: 52 }}>
            <AudioMessage
              messageId={message.id}
              uri={message.audioUrl}
              duration={message.audioDuration ?? 0}
              isSender={isMyMessage}
            />
          </View>
        )}

        {!isDeletedEveryone && message.type === 'location' && message.previewUrl && (
          <View style={{ marginTop: messageBodyText ? 6 : 0 }}>
            <LocationMessageBubble
              message={message}
              isMyMessage={isMyMessage}
              isDark={isDark}
              timeLabel={timeLabel}
              isFailed={isFailed}
              liveLocationExpired={liveLocationExpired}
              locationOwnsFooter={locationOwnsFooter}
              onOpenMaps={() => onLocationPress?.(message)}
              onRetry={isMyMessage && isFailed && onRetry ? () => onRetry(message) : undefined}
            />
            {locationOwnsFooter && (message.edited || message.isEdited) ? (
              <Text
                style={{
                  fontSize: 10,
                  color: isMyMessage ? 'rgba(255,255,255,0.5)' : (isDark ? '#6b7280' : '#9ca3af'),
                  marginTop: 4,
                  textAlign: 'right',
                }}
              >
                {t('messages.edited')}
              </Text>
            ) : null}
          </View>
        )}

        {!isDeletedEveryone && message.fileUrl && (message.type === 'document' || message.type === 'file') && (
          <DocumentMessageRow
            fileName={message.fileName || t('messages.document')}
            fileSize={message.fileSize}
            mimeType={message.mimeType}
            extension={message.extension}
            isMyMessage={isMyMessage}
            isDark={isDark}
            onOpen={() => onDocumentPress?.(message)}
            showEmbeddedFooter={documentOwnsFooter}
            timeLabel={documentOwnsFooter ? timeLabel : undefined}
            messageStatus={message.status}
            isFailed={isFailed}
            onRetryPress={isMyMessage && isFailed && onRetry ? () => onRetry(message) : undefined}
            edited={!!(message.edited || message.isEdited)}
            isPending={message.status === 'pending'}
          />
        )}

        {/* Timestamp + read receipt — hidden when document / location card embeds its own footer */}
        {!documentOwnsFooter && !locationOwnsFooter ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
              marginTop: 3,
              gap: 3,
            }}
          >
            {(message.edited || message.isEdited) && (
              <Text
                style={{
                  fontSize: 10,
                  color: isMyMessage ? 'rgba(255,255,255,0.5)' : (isDark ? '#6b7280' : '#9ca3af'),
                  marginRight: 2,
                }}
              >
                {t('messages.edited')}
              </Text>
            )}
            <Text
              style={{
                fontSize: 10.5,
                color: isMyMessage ? 'rgba(255,255,255,0.6)' : (isDark ? '#6b7280' : '#9ca3af'),
              }}
            >
              {timeLabel}
            </Text>
            {isMyMessage && (
              isFailed && onRetry ? (
                <Pressable
                  onPress={() => onRetry(message)}
                  hitSlop={8}
                  accessibilityLabel={t('a11y.retrySending')}
                >
                  <Feather name="alert-circle" size={13} color="#ef4444" />
                </Pressable>
              ) : (
                <MessageStatusIndicator status={message.status || 'sent'} size={13} />
              )
            )}

            {!isMyMessage && isAiMessage && isFailed && onRetry ? (
              <Pressable onPress={() => onRetry(message)} hitSlop={8} accessibilityLabel={t('a11y.retryGywAi')}>
                <Feather name="refresh-ccw" size={13} color={isDark ? '#c7d2fe' : '#4f46e5'} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}, (prev, next) => {
  if (!prev.message || !next.message) return prev.message === next.message;

  const readByEqual =
    prev.message.readBy === next.message.readBy ||
    (Array.isArray(prev.message.readBy) &&
      Array.isArray(next.message.readBy) &&
      prev.message.readBy.length === next.message.readBy.length &&
      prev.message.readBy.every((id, i) => id === next.message.readBy![i]));

  const deletedForEqual =
    prev.message.deletedFor === next.message.deletedFor ||
    (Array.isArray(prev.message.deletedFor) &&
      Array.isArray(next.message.deletedFor) &&
      prev.message.deletedFor.length === next.message.deletedFor.length &&
      prev.message.deletedFor.every((id, i) => id === next.message.deletedFor![i]));

  return (
    prev.message.id === next.message.id &&
    prev.message.type === next.message.type &&
    prev.message.systemKind === next.message.systemKind &&
    prev.message.text === next.message.text &&
    prev.message.aiMode === next.message.aiMode &&
    prev.message.aiMultimodalSourceMessageId === next.message.aiMultimodalSourceMessageId &&
    prev.message.aiMultimodalRoute === next.message.aiMultimodalRoute &&
    prev.message.status === next.message.status &&
    prev.message.deleted === next.message.deleted &&
    prev.message.edited === next.message.edited &&
    prev.message.isEdited === next.message.isEdited &&
    prev.message.imageUrl === next.message.imageUrl &&
    prev.message.imageWidth === next.message.imageWidth &&
    prev.message.imageHeight === next.message.imageHeight &&
    prev.message.blurhash === next.message.blurhash &&
    prev.message.videoUrl === next.message.videoUrl &&
    prev.message.videoThumbnailUrl === next.message.videoThumbnailUrl &&
    prev.message.audioUrl === next.message.audioUrl &&
    prev.message.audioDuration === next.message.audioDuration &&
    prev.message.fileUrl === next.message.fileUrl &&
    prev.message.fileName === next.message.fileName &&
    prev.message.mimeType === next.message.mimeType &&
    prev.message.fileSize === next.message.fileSize &&
    prev.message.extension === next.message.extension &&
    prev.message.latitude === next.message.latitude &&
    prev.message.longitude === next.message.longitude &&
    prev.message.previewUrl === next.message.previewUrl &&
    prev.message.placeName === next.message.placeName &&
    prev.message.placeAddress === next.message.placeAddress &&
    prev.message.isLive === next.message.isLive &&
    prev.message.expiresAt === next.message.expiresAt &&
    areReactionMapsEqual(prev.message.reactions, next.message.reactions) &&
    isReplyRefEqual(prev.message.replyTo, next.message.replyTo) &&
    readByEqual &&
    deletedForEqual &&
    prev.isMyMessage === next.isMyMessage &&
    prev.colorScheme === next.colorScheme &&
    prev.isGroupChat === next.isGroupChat &&
    prev.isDark === next.isDark &&
    prev.textColor === next.textColor &&
    prev.textSecondaryColor === next.textSecondaryColor &&
    prev.showTail === next.showTail &&
    prev.showSenderName === next.showSenderName &&
    prev.showAvatar === next.showAvatar &&
    prev.onReplyPress === next.onReplyPress &&
    prev.onMediaPress === next.onMediaPress &&
    prev.onDocumentPress === next.onDocumentPress &&
    prev.onLocationPress === next.onLocationPress &&
    prev.onLongPress === next.onLongPress &&
    prev.onRetry === next.onRetry
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
