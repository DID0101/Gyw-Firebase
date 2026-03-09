import { useAuth } from '@/contexts/AuthContext';
import Feather from '@expo/vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import clsx from 'clsx';
import * as ImagePicker from 'expo-image-picker';
import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';

import AppMenu from '@/components/AppMenu';
import Button from '@/components/Button';
import PreviewAvatar from '@/components/PreviewAvatar';
import Screen from '@/components/Screen';
import ScreenLoading from '@/components/ScreenLoading';
import StoryPickerModal from '@/components/StoryPickerModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useChats } from '@/lib/hooks/useChats';
import { useUsersData } from '@/lib/hooks/useUsersData';
import { warmChat } from '@/lib/services/chatPreloadService';
import { useThemeClassName } from '@/lib/themeUtils';
import { Chat } from '@/lib/types/chat';
import { usePresenceStore } from '@/store/presenceStore';

const ChatsScreen = () => {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const [showPicker, setShowPicker] = useState(false);
  const { chats, loading } = useChats(user?.uid || '');

  const totalUnread = useMemo(() => {
    if (!user?.uid) return 0;
    return chats.reduce((sum, chat) => sum + (chat.unreadCount?.[user.uid] ?? 0), 0);
  }, [chats, user?.uid]);

  // Get all participant user IDs
  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    chats.forEach(chat => {
      chat.participants.forEach(id => {
        if (id !== user?.uid) ids.add(id);
      });
    });
    return Array.from(ids);
  }, [chats, user?.uid]);
  
  // Fetch user data for all participants
  const { usersData } = useUsersData(participantIds);
  
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
        router.push({
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
        router.push({
          pathname: '/(home)/(modal)/new-message',
          params: { media: 'true' },
        });
      }
    } catch (error) {
      // Silently fail - media picker errors are not critical
    }
  };

  const goToChat = useCallback((chatId: string) => {
    // Use push for faster navigation (immediate, no animation delay)
    router.push(`/chat/${chatId}`);
  }, [router]);

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

  // Get online status from presence store
  const onlineUsers = usePresenceStore((state) => state.onlineUsers);
  
  const isOnline = (userId?: string) => {
    if (!userId) return false;
    // Check presence store first, fallback to lastActive calculation
    if (onlineUsers[userId] !== undefined) {
      return onlineUsers[userId] === true;
    }
    // Fallback: calculate from lastActive
    const userData = usersData[userId];
    if (!userData?.lastActive) return false;
    const lastActive = new Date(userData.lastActive);
    const now = new Date();
    const diffMs = now.getTime() - lastActive.getTime();
    return diffMs < 5 * 60 * 1000; // Online if active in last 5 minutes
  };

  const renderChatItem = useCallback(({ item }: { item: Chat }) => {
    const otherParticipant = item.participants.find(p => p !== user?.uid);
    const otherUser = otherParticipant ? usersData[otherParticipant] : null;
    
    // Get display name and avatar
    const displayName = item.type === 'group' 
      ? item.name || t('chats.groupChat')
      : otherUser 
        ? `${otherUser.firstName} ${otherUser.lastName}`.trim() || otherUser.username || t('calls.unknown')
        : t('calls.unknown');
    
    const avatar = item.type === 'group'
      ? item.avatar
      : otherUser?.avatar;
    
    const unreadCount = item.unreadCount?.[user?.uid || ''] || 0;
    const isUnread = unreadCount > 0;
    const online = item.type === 'direct' && otherParticipant ? isOnline(otherParticipant) : false;
    
    // Format last message
    let lastMessageText = t('messages.noMessagesYet');
    if (item.lastMessage) {
      // Check if it's a call message
      if (item.lastMessage.type === 'call') {
        const callType = item.lastMessage.callType === 'video' ? '📹' : '📞';
        if (item.lastMessage.callStatus === 'missed') {
          lastMessageText = `${callType} ${item.lastMessage.callType === 'video' ? t('calls.missedVideoCall') : t('calls.missedAudioCall')}`;
        } else if (item.lastMessage.callStatus === 'rejected') {
          lastMessageText = `${callType} ${item.lastMessage.callType === 'video' ? t('calls.videoCall') : t('calls.audioCall')} ${t('messages.callRejected')}`;
        } else if (item.lastMessage.callStatus === 'ended') {
          if (item.lastMessage.callDuration && item.lastMessage.callDuration > 0) {
            const minutes = Math.floor(item.lastMessage.callDuration / 60);
            const seconds = item.lastMessage.callDuration % 60;
            const durationText = minutes > 0 
              ? `${minutes}:${seconds.toString().padStart(2, '0')}`
              : `${seconds}s`;
            lastMessageText = `${callType} ${item.lastMessage.callType === 'video' ? t('calls.videoCall') : t('calls.audioCall')} ${t('messages.callDuration')} ${durationText}`;
          } else {
            lastMessageText = `${callType} ${item.lastMessage.callType === 'video' ? t('calls.videoCall') : t('calls.audioCall')}`;
          }
        } else {
          lastMessageText = item.lastMessage.text || t('messages.call');
        }
      } else if (item.lastMessage.text) {
        lastMessageText = item.lastMessage.senderId === user?.uid 
          ? `${t('messages.you')}: ${item.lastMessage.text}`
          : item.lastMessage.text;
      } else {
        lastMessageText = item.lastMessage.senderId === user?.uid ? t('messages.youSentMedia') : t('messages.mediaMessage');
      }
    }

    return (
      <Pressable
        onPressIn={() => {
          // Warm chat immediately when user shows intent (non-blocking)
          warmChat(item.id, 20);
          // Prefetch route immediately (prepares JS bundle)
          router.prefetch(`/chat/${item.id}`);
        }}
        onPress={() => {
          // Navigate immediately - no delays or blocking
          goToChat(item.id);
        }}
        className={clsx(
          'flex-row items-center px-4 py-3 border-b',
          borderColor,
          isUnread && bgColor
        )}
        style={({ pressed }) => ({
          opacity: pressed ? 0.7 : 1,
          backgroundColor: pressed ? (colorScheme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)') : undefined,
        })}
      >
        <View className="relative">
          <PreviewAvatar 
            name={displayName}
            image={avatar}
            size={56}
            fontSize={20}
          />
          {online && (
            <View className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-900" />
          )}
        </View>
        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between mb-1">
            <Text
              className={clsx(
                'text-base flex-1',
                isUnread ? 'font-bold' : 'font-semibold',
                textColor
              )}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            {item.lastMessageAt && (
              <Text className={clsx('text-xs ml-2', textSecondaryColor)}>
                {formatTime(item.lastMessageAt)}
              </Text>
            )}
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
                  backgroundColor: '#337E84',
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
      </Pressable>
    );
  }, [user, usersData, goToChat, textColor, textSecondaryColor, borderColor, bgColor, colorScheme, router, t]);

  if (loading) {
    return <ScreenLoading />;
  }

  return (
    <Screen viewClassName="flex-1 px-2 sm:px-4">
      <View className="flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <AppMenu />
        <View className="flex flex-row items-center gap-2 sm:gap-4">
          <Button variant="plain" onPress={() => setShowPicker(true)}>
            <Feather name="camera" size={20} color={iconColor} />
          </Button>
          <Link href="/new-message" asChild>
            <Button variant="plain" className="pl-2 sm:pl-4 py-1">
              <Feather name="edit" size={18} color={iconColor} />
            </Button>
          </Link>
        </View>
      </View>
      <View className="flex-1 min-h-0">
        {chats.length === 0 ? (
          <View className="flex-1 items-center justify-center p-8">
            <Text className="text-gray-500 dark:text-gray-400 text-center text-lg mb-2">
              No chats yet
            </Text>
            <Text className="text-gray-400 dark:text-gray-500 text-center">
              Start a new conversation by tapping the edit button
            </Text>
          </View>
        ) : (
          <FlatList
            data={chats}
            renderItem={renderChatItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 10 }}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            initialNumToRender={15}
            windowSize={10}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>
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
