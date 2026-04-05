import { memo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import clsx from 'clsx';
import { Chat, User } from '@/lib/types/chat';
import Button from './Button';
import PreviewAvatar from './PreviewAvatar';

interface ChatHeaderProps {
  chat: Chat | null;
  otherUser: User | null;
  isOnline: boolean;
  lastSeenText: string;
  displayName: string;
  displayAvatar: string | undefined;
  textColor: string;
  textSecondaryColor: string;
  borderColor: string;
  iconColor: string;
  isDark: boolean;
  onBack: () => void;
  onVideoCall: () => void;
  onAudioCall: () => void;
  creatingCall?: boolean;
}

const ChatHeader = memo<ChatHeaderProps>((props: ChatHeaderProps | undefined) => {
  // Some fast reload/navigation sequences can briefly pass undefined props through memo.
  // Default to a safe object so we never crash while auth hydrates.
  const {
    chat,
    otherUser,
    isOnline,
    lastSeenText,
    displayName,
    displayAvatar,
    textColor,
    textSecondaryColor,
    borderColor,
    iconColor,
    isDark,
    onBack,
    onVideoCall,
    onAudioCall,
    creatingCall = false,
  } = (props ?? ({} as any)) as ChatHeaderProps;

  return (
    <View className={clsx(
      'px-4 py-3 border-b',
      borderColor,
      isDark ? 'bg-gray-900' : 'bg-white'
    )}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3 flex-1 min-w-0">
          <Button variant="plain" onPress={onBack}>
            <Ionicons name="chevron-back" size={24} color={iconColor} />
          </Button>
          <View className="relative">
            <PreviewAvatar 
              name={displayName}
              image={displayAvatar}
              size={40}
              fontSize={16}
            />
            {chat?.type === 'direct' && isOnline && (
              <View className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-900" />
            )}
          </View>
          <View className="flex-1 min-w-0 ml-2">
            <Text className={clsx('text-base font-semibold', textColor)} numberOfLines={1}>
              {displayName}
            </Text>
            {chat?.type === 'direct' && (
              <Text className={clsx('text-xs mt-0.5', textSecondaryColor)} numberOfLines={1}>
                {lastSeenText}
              </Text>
            )}
            {chat?.type === 'group' && (
              <Text className={clsx('text-xs mt-0.5', textSecondaryColor)} numberOfLines={1}>
                {chat.participants.length} members
              </Text>
            )}
          </View>
        </View>
        <View className="flex-row items-center gap-2 flex-shrink-0">
          <Button variant="plain" onPress={creatingCall ? undefined : onVideoCall} disabled={creatingCall}>
            <Feather name="video" size={22} color={creatingCall ? '#9ca3af' : iconColor} />
          </Button>
          <Button variant="plain" onPress={creatingCall ? undefined : onAudioCall} disabled={creatingCall}>
            <Feather name="phone" size={20} color={creatingCall ? '#9ca3af' : iconColor} />
          </Button>
        </View>
      </View>
    </View>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;

