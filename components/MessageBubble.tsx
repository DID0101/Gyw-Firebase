import { memo, useMemo } from 'react';
import { Dimensions, Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { ChatMessage } from '@/lib/types/chat';
import { formatBubbleTime } from '@/lib/utils/chatUtils';
import AudioMessage from './AudioMessage';
import MessageStatusIndicator from './MessageStatusIndicator';
import PreviewAvatar from './PreviewAvatar';
import { GYW_AI_DISPLAY_NAME, GYW_AI_SYSTEM_ID } from '@/lib/constants/gywAi';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// Bubble max = 72% of screen — comfortable on phones from 320px to 428px wide
const BUBBLE_MAX_WIDTH = Math.min(SCREEN_WIDTH * 0.72, 320);
// Image fills the bubble minus a small inset
const IMAGE_WIDTH = Math.min(SCREEN_WIDTH * 0.62, 260);
const IMAGE_HEIGHT = Math.round(IMAGE_WIDTH * 0.75);
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
  onLongPress: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  showTail?: boolean;
  showSenderName?: boolean;
  showAvatar?: boolean;
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
  onLongPress,
  onRetry,
  showTail = true,
  showSenderName = true,
  showAvatar = false,
}) => {
  if (!message) return null;

  const isAiMessage = message.isAI || message.senderId === GYW_AI_SYSTEM_ID;
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
    if (message.imageWidth && message.imageHeight && message.imageWidth > 0) {
      return Math.round(IMAGE_WIDTH * message.imageHeight / message.imageWidth);
    }
    return IMAGE_HEIGHT;
  }, [message.imageWidth, message.imageHeight]);

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
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  const isFailed = message.status === 'failed';

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

  // Time + status meta line
  const timeLabel = formatBubbleTime(message.createdAt || message.sentAt);

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
      accessibilityLabel={message.deleted ? 'Deleted message' : message.text || 'Media message'}
    >
      {/* Receiver avatar in group chats */}
      {!isMyMessage && showAvatar && (isGroupChat || isAiMessage) ? (
        <View className="mr-1.5 self-end mb-0.5">
          <PreviewAvatar
            name={isAiMessage ? GYW_AI_DISPLAY_NAME : message.senderName}
            image={isAiMessage ? aiAvatarUri : message.senderAvatar}
            size={30}
            fontSize={12}
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
            {isAiMessage ? GYW_AI_DISPLAY_NAME : message.senderName}
          </Text>
        )}

        {/* Reply preview */}
        {message.replyTo && (
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
              {message.replyTo.senderName}
            </Text>
            <Text
              style={{
                fontSize: 11.5,
                color: isMyMessage ? 'rgba(255,255,255,0.65)' : (isDark ? '#9ca3af' : '#6b7280'),
              }}
              numberOfLines={2}
            >
              {message.replyTo.text
                || (message.replyTo.type === 'image' ? '📷 Photo'
                : message.replyTo.type === 'video' ? '🎥 Video'
                : '🎤 Voice message')}
            </Text>
          </Pressable>
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
              This message was deleted
            </Text>
          </View>
        ) : message.text ? (
          <Text
            style={{
              fontSize: 15,
              lineHeight: 21,
              color: isMyMessage ? '#ffffff' : (isAiMessage ? (isDark ? '#e0e7ff' : '#111827') : (isDark ? '#f3f4f6' : '#111827')),
            }}
          >
            {message.text}
          </Text>
        ) : null}

        {/* Image */}
        {message.imageUrl && (
          <Pressable
            onPress={() => onMediaPress(message.imageUrl!, 'image')}
            style={{
              marginTop: message.text ? 6 : 0,
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
              transition={200}
              cachePolicy="disk"
              recyclingKey={message.id}
              placeholder={message.blurhash ? { blurhash: message.blurhash } : { color: '#374151' }}
            />
          </Pressable>
        )}

        {/* Video */}
        {message.videoUrl && (
          <Pressable
            onPress={() => onMediaPress(message.videoUrl!, 'video')}
            style={{
              marginTop: message.text ? 6 : 0,
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
        {message.audioUrl && (
          <View style={{ width: AUDIO_WIDTH, minHeight: 52 }}>
            <AudioMessage
              messageId={message.id}
              uri={message.audioUrl}
              duration={message.audioDuration ?? 0}
              isSender={isMyMessage}
            />
          </View>
        )}

        {/* Timestamp + read receipt — bottom-right, always */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginTop: 3,
            gap: 3,
          }}
        >
          {message.edited && (
            <Text
              style={{
                fontSize: 10,
                color: isMyMessage ? 'rgba(255,255,255,0.5)' : (isDark ? '#6b7280' : '#9ca3af'),
                marginRight: 2,
              }}
            >
              edited
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
                accessibilityLabel="Retry sending"
              >
                <Feather name="alert-circle" size={13} color="#ef4444" />
              </Pressable>
            ) : (
              <MessageStatusIndicator status={message.status || 'sent'} size={13} />
            )
          )}

          {!isMyMessage && isAiMessage && isFailed && onRetry ? (
            <Pressable onPress={() => onRetry(message)} hitSlop={8} accessibilityLabel="Retry Gyw AI">
              <Feather name="refresh-ccw" size={13} color={isDark ? '#c7d2fe' : '#4f46e5'} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}, (prev, next) => {
  if (!prev.message || !next.message) return prev.message === next.message;

  return (
    prev.message.id === next.message.id &&
    prev.message.text === next.message.text &&
    prev.message.status === next.message.status &&
    prev.message.deleted === next.message.deleted &&
    prev.message.edited === next.message.edited &&
    prev.message.imageUrl === next.message.imageUrl &&
    prev.message.videoUrl === next.message.videoUrl &&
    prev.message.audioUrl === next.message.audioUrl &&
    prev.message.audioDuration === next.message.audioDuration &&
    areReactionMapsEqual(prev.message.reactions, next.message.reactions) &&
    isReplyRefEqual(prev.message.replyTo, next.message.replyTo) &&
    prev.isMyMessage === next.isMyMessage &&
    prev.colorScheme === next.colorScheme &&
    prev.isGroupChat === next.isGroupChat &&
    prev.isDark === next.isDark &&
    prev.showTail === next.showTail &&
    prev.showSenderName === next.showSenderName &&
    prev.showAvatar === next.showAvatar
  );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
