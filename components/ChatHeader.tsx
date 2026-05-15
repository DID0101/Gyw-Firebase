import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { Chat, User } from '@/lib/types/chat';
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

  const { t } = useTranslation();
  const memberLine =
    chat?.type === 'group'
      ? t('groups.memberCount', { count: chat.participants?.length ?? 0 })
      : '';

  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 10,
        borderBottomWidth: 0.5,
        borderBottomColor: isDark ? '#374151' : '#e5e7eb',
        backgroundColor: isDark ? '#111827' : '#ffffff',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {/* Left: back + avatar + name */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <Pressable
          onPress={onBack}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 22,
            opacity: pressed ? 0.6 : 1,
          })}
          hitSlop={4}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true, radius: 22 }}
          accessibilityLabel={t('a11y.goBack')}
        >
          <Ionicons name="chevron-back" size={26} color={iconColor} />
        </Pressable>

        <View style={{ position: 'relative', marginLeft: 2 }}>
          <PreviewAvatar
            name={displayName}
            image={displayAvatar}
            size={40}
            fontSize={16}
          />
          {chat?.type === 'direct' && isOnline && (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: '#FF5722',
                borderWidth: 2,
                borderColor: isDark ? '#111827' : '#ffffff',
              }}
            />
          )}
        </View>

        <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: isDark ? '#f9fafb' : '#111827',
            }}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {chat?.type === 'direct' && lastSeenText ? (
            <Text
              style={{ fontSize: 11.5, marginTop: 1, color: isDark ? '#6b7280' : '#6b7280' }}
              numberOfLines={1}
            >
              {lastSeenText}
            </Text>
          ) : chat?.type === 'group' ? (
            <Text
              style={{ fontSize: 11.5, marginTop: 1, color: isDark ? '#6b7280' : '#6b7280' }}
              numberOfLines={1}
            >
              {memberLine}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Right: call buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable
          onPress={creatingCall ? undefined : onVideoCall}
          disabled={creatingCall}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 22,
            opacity: pressed || creatingCall ? 0.5 : 1,
          })}
          hitSlop={4}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true, radius: 22 }}
          accessibilityLabel={t('calls.videoCall')}
        >
          <Feather name="video" size={22} color={creatingCall ? '#9ca3af' : iconColor} />
        </Pressable>
        <Pressable
          onPress={creatingCall ? undefined : onAudioCall}
          disabled={creatingCall}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 22,
            opacity: pressed || creatingCall ? 0.5 : 1,
            marginRight: 4,
          })}
          hitSlop={4}
          android_ripple={{ color: 'rgba(0,0,0,0.1)', borderless: true, radius: 22 }}
          accessibilityLabel={t('calls.audioCall')}
        >
          <Feather name="phone" size={21} color={creatingCall ? '#9ca3af' : iconColor} />
        </Pressable>
      </View>
    </View>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;

