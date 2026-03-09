import { memo } from 'react';
import { Dimensions, Pressable, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { ChatMessage } from '@/lib/types/chat';
import { formatBubbleTime } from '@/lib/utils/chatUtils';
import AudioMessage from './AudioMessage';
import MessageReactions from './MessageReactions';
import MessageStatusIndicator from './MessageStatusIndicator';
import PreviewAvatar from './PreviewAvatar';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BUBBLE_MAX_WIDTH = SCREEN_WIDTH * 0.75;
const AUDIO_BUBBLE_WIDTH = Math.min(SCREEN_WIDTH * 0.7, 280);

interface MessageBubbleProps {
  message: ChatMessage;
  isMyMessage: boolean;
  textColor: string;
  textSecondaryColor: string;
  colorScheme: 'light' | 'dark';
  isDark: boolean;
  isGroupChat: boolean;
  onReplyPress: (messageId: string) => void;
  onImagePress: (imageUrl: string) => void;
  onLongPress: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  showTail?: boolean;
  showSenderName?: boolean;
  showAvatar?: boolean;
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
  onImagePress,
  onLongPress,
  onRetry,
  showTail = true,
  showSenderName = true,
  showAvatar = false,
}) => {
  if (!message) return null;

  // System message (call log) - center aligned
  if (message.type === 'call') {
    return (
      <View className="items-center my-2" accessibilityRole="text" accessibilityLabel="Call log">
        <View className={clsx(
          'px-4 py-2 rounded-full',
          isDark ? 'bg-gray-800' : 'bg-gray-100'
        )}>
          <Text className={clsx(
            'text-xs',
            isDark ? 'text-gray-300' : 'text-gray-600'
          )}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }

  const isGrouped = !showTail;
  const isFailed = message.status === 'failed';
  const bubbleBg = isMyMessage ? 'bg-[#337E84]' : (colorScheme === 'dark' ? 'bg-gray-700' : 'bg-white');

  return (
    <Pressable
      onLongPress={() => onLongPress(message)}
      className={clsx(
        'flex-row',
        isMyMessage ? 'justify-end' : 'justify-start',
        isGrouped ? 'mb-0.5' : 'mb-2'
      )}
      accessibilityRole="button"
      accessibilityLabel={message.deleted ? 'Deleted message' : message.text || 'Media message'}
    >
      {!isMyMessage && showAvatar && isGroupChat && (
        <View className="mr-2 self-end" style={{ marginBottom: 4 }}>
          <PreviewAvatar name={message.senderName} image={message.senderAvatar} size={28} fontSize={12} />
        </View>
      )}
      <View
        className={clsx(
          'px-4 py-2.5',
          showTail
            ? isMyMessage
              ? 'rounded-2xl rounded-br-sm'
              : 'rounded-2xl rounded-bl-sm'
            : 'rounded-2xl',
          bubbleBg
        )}
        style={[
          { maxWidth: BUBBLE_MAX_WIDTH },
          !isMyMessage && colorScheme === 'light' && { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }
        ]}
      >
        {/* Sender name - first in cluster, group only */}
        {!isMyMessage && showSenderName && isGroupChat && (
          <Text className={clsx('text-xs mb-1 font-medium', textSecondaryColor)}>
            {message.senderName}
          </Text>
        )}

        {/* Reply Preview */}
        {message.replyTo && (
          <Pressable
            onPress={() => onReplyPress(message.replyTo!.messageId)}
            className={clsx(
              'mb-2 pl-3 border-l-2 rounded',
              isMyMessage ? 'border-white/50 bg-white/10' : 'border-gray-400 bg-gray-300/50 dark:bg-gray-600/50'
            )}
          >
            <Text className={clsx(
              'text-xs font-semibold mb-0.5',
              isMyMessage ? 'text-white/90' : textSecondaryColor
            )}>
              {message.replyTo.senderName}
            </Text>
            <Text className={clsx(
              'text-xs',
              isMyMessage ? 'text-white/70' : textSecondaryColor
            )} numberOfLines={2}>
              {message.replyTo.text || (message.replyTo.type === 'image' ? '📷 Photo' : message.replyTo.type === 'video' ? '🎥 Video' : 'Media')}
            </Text>
          </Pressable>
        )}

        {/* Deleted message - prohibition icon */}
        {message.deleted ? (
          <View className="flex-row items-center gap-2">
            <Feather name="slash" size={14} color={isMyMessage ? 'rgba(255,255,255,0.6)' : (isDark ? '#9ca3af' : '#6b7280')} />
            <Text
              className={clsx(
                'text-sm italic',
                isMyMessage ? 'text-white/60' : textSecondaryColor
              )}
            >
              This message was deleted
            </Text>
          </View>
        ) : message.text ? (
          <Text className={clsx('text-base', isMyMessage ? 'text-white' : textColor)}>
            {message.text}
          </Text>
        ) : null}
        
        {/* Image - Blur placeholder while loading, lazy loaded */}
        {message.imageUrl && (
          <Pressable
            onPress={() => onImagePress(message.imageUrl!)}
            className="mt-2 rounded-lg overflow-hidden bg-gray-300 dark:bg-gray-600"
          >
            <ExpoImage
              source={{ uri: message.imageUrl }}
              style={{ width: 250, height: 250, borderRadius: 8 }}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              recyclingKey={message.id}
            />
          </Pressable>
        )}
        
        {/* Video - Lazy loaded with thumbnail */}
        {message.videoUrl && (
          <Pressable
            onPress={() => onImagePress(message.videoUrl!)}
            className="mt-2 rounded-lg overflow-hidden bg-black"
          >
            <View className="w-[250] h-[200] items-center justify-center">
              <ExpoImage
                source={{ uri: message.videoUrl }}
                style={{ width: 250, height: 200, position: 'absolute' }}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={message.id}
              />
              <View className="absolute inset-0 bg-black/40 items-center justify-center">
                <Text className="text-white text-4xl">▶</Text>
              </View>
            </View>
          </Pressable>
        )}
        
        {/* Audio - WhatsApp-style: [Play] [Progress] [Duration] */}
        {message.audioUrl && (
          <View style={{ width: '100%', minWidth: 220, minHeight: 52, maxWidth: AUDIO_BUBBLE_WIDTH }}>
            <AudioMessage
              messageId={message.id}
              uri={message.audioUrl}
              duration={message.audioDuration ?? 0}
              isSender={isMyMessage}
            />
          </View>
        )}
        
        {/* Reactions */}
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <View className="mt-2">
            <MessageReactions
              reactions={message.reactions}
              onReactionPress={() => {}}
            />
          </View>
        )}

        {/* Timestamp + checkmarks inside bubble, bottom-right, transparent overlay */}
        <View className="flex-row items-center justify-end mt-1 gap-1 self-end">
          {message.edited && (
            <Text className={clsx('text-[10px] mr-0.5', isMyMessage ? 'text-white/50' : textSecondaryColor)}>
              (edited)
            </Text>
          )}
          <Text className={clsx('text-[10px]', isMyMessage ? 'text-white/60' : textSecondaryColor)}>
            {formatBubbleTime(message.createdAt || message.sentAt)}
          </Text>
          {isMyMessage && (
            <>
              {isFailed && onRetry ? (
                <Pressable onPress={() => onRetry(message)} className="ml-1" accessibilityLabel="Retry sending">
                  <Feather name="alert-circle" size={12} color="#ef4444" />
                </Pressable>
              ) : (
                <View className="ml-1">
                  <MessageStatusIndicator status={message.status || 'sent'} />
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for better memoization
  // Only re-render if message data actually changed
  
  // Handle undefined messages
  if (!prevProps.message || !nextProps.message) {
    return prevProps.message === nextProps.message;
  }
  
  const messageChanged = 
    prevProps.message.id !== nextProps.message.id ||
    prevProps.message.text !== nextProps.message.text ||
    prevProps.message.status !== nextProps.message.status ||
    prevProps.message.imageUrl !== nextProps.message.imageUrl ||
    prevProps.message.videoUrl !== nextProps.message.videoUrl ||
    prevProps.message.audioUrl !== nextProps.message.audioUrl ||
    prevProps.message.audioDuration !== nextProps.message.audioDuration ||
    JSON.stringify(prevProps.message.reactions || {}) !== JSON.stringify(nextProps.message.reactions || {}) ||
    JSON.stringify(prevProps.message.replyTo || null) !== JSON.stringify(nextProps.message.replyTo || null);
  
  const propsChanged = 
    prevProps.isMyMessage !== nextProps.isMyMessage ||
    prevProps.colorScheme !== nextProps.colorScheme ||
    prevProps.isGroupChat !== nextProps.isGroupChat ||
    prevProps.textColor !== nextProps.textColor ||
    prevProps.textSecondaryColor !== nextProps.textSecondaryColor ||
    prevProps.isDark !== nextProps.isDark ||
    prevProps.showTail !== nextProps.showTail ||
    prevProps.showSenderName !== nextProps.showSenderName ||
    prevProps.showAvatar !== nextProps.showAvatar;
  
  // Return true if nothing changed (should skip re-render)
  return !messageChanged && !propsChanged;
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;

