import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, Share, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FlatList } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';

import AppMenu from '@/components/AppMenu';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import CallItem from '@/components/CallItem';
import Screen from '@/components/Screen';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { getCallHistory } from '@/lib/services/callService';
import { getUser } from '@/lib/services/chatService';
import { Call } from '@/lib/types/call';
import { User } from '@/lib/types/chat';
import { useCallStore } from '@/store/callStore';
import { useChatStore } from '@/store/chatStore';
import clsx from 'clsx';

const CallsScreen = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const { colorScheme } = useTheme();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-600', 'text-gray-400');
  const borderColor = useThemeClassName('border-gray-200', 'border-gray-700');
  const dotColor = useThemeClassName('text-gray-400', 'text-gray-500');
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const iconSecondaryColor = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';
  // Read calls from store instead of local state
  const calls = useCallStore((state) => state.calls);
  const chats = useChatStore((state) => state.chats);
  const [userData, setUserData] = useState<Record<string, User>>({});
  const userDataLoadedRef = useRef(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [creatingCall, setCreatingCall] = useState(false);
  const [showCallLinkModal, setShowCallLinkModal] = useState(false);
  const [showCallTypeModal, setShowCallTypeModal] = useState(false);
  const [callLink, setCallLink] = useState<string>('');

  // Sync calls from Firestore in background (silent update)
  const syncCallHistory = useCallback(async (force = false) => {
    if (!user?.uid) return;
    // Skip if already loaded (unless forced)
    if (userDataLoadedRef.current && !force) return;

    let callHistory: Call[] = [];
    try {
      callHistory = await getCallHistory(user.uid, 50);
      useCallStore.getState().setCalls(callHistory);
    } catch (error) {
      // Fallback: use calls from store (e.g. from preload) when sync fails
      callHistory = useCallStore.getState().calls;
    }

    // Fetch user data only for IDs not already cached
    const userIds = new Set<string>();
    callHistory.forEach(call => {
      if (!userData[call.callerId]) userIds.add(call.callerId);
      if (!userData[call.receiverId]) userIds.add(call.receiverId);
    });

    if (userIds.size > 0) {
      const userDataMap: Record<string, User> = { ...userData };
      await Promise.all(
        Array.from(userIds).map(async (userId) => {
          try {
            const userInfo = await getUser(userId);
            if (userInfo) userDataMap[userId] = userInfo;
          } catch (error) {
            // Silently fail - user fetch errors are not critical
          }
        })
      );
      setUserData(userDataMap);
    }
    userDataLoadedRef.current = true;
  }, [user?.uid]);

  // Sync on first focus only; re-sync when new calls arrive (calls array changes)
  useFocusEffect(
    useCallback(() => {
      syncCallHistory();
    }, [syncCallHistory])
  );

  // Re-fetch user data when new call participants appear
  useEffect(() => {
    if (!userDataLoadedRef.current) return;
    const missing = calls.some(c => !userData[c.callerId] || !userData[c.receiverId]);
    if (missing) syncCallHistory(true);
  }, [calls]);

  // TODO: Enhance call records with user names from Firestore when WebRTC is implemented

  const formatDuration = useCallback((seconds: number) => {
    if (!seconds || seconds === 0) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const formatDate = useCallback((timestamp: string) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return t('calls.justNow') || 'Just now';
      if (diffMins < 60) return `${diffMins}${t('calls.minutesAgo') || 'm ago'}`;
      if (diffHours < 24) return `${diffHours}${t('calls.hoursAgo') || 'h ago'}`;
      if (diffDays < 7) return `${diffDays}${t('calls.daysAgo') || 'd ago'}`;
      const formatted = date.toLocaleDateString();
      return formatted || '';
    } catch (error) {
      return '';
    }
  }, [t]);

  const handleCallPress = useCallback(async (call: Call) => {
    if (call.chatId) {
      router.push(`/(home)/chat/${call.chatId}`);
    } else if (creatingCall) {
      return;
    } else {
      const otherUserId = call.callerId === user?.uid ? call.receiverId : call.callerId;
      setCreatingCall(true);
      try {
        const { getOrCreateDirectChat } = await import('@/lib/services/chatService');
        const { createCall } = await import('@/lib/services/callService');
        const chatId = await getOrCreateDirectChat(user!.uid, otherUserId);
        const callType: 'audio' | 'video' = call.type === 'video' ? 'video' : 'audio';
        const newCallId = await createCall(
          user!.uid,
          otherUserId,
          callType,
          chatId,
          undefined,
          user!.displayName ?? undefined,
          user!.photoURL ?? undefined,
        );
        router.push(`/(home)/call/${newCallId}`);
      } catch (error) {
        if (__DEV__) console.error('Error initiating call:', error);
        Alert.alert(t('common.error'), t('calls.failedToInitiate'));
      } finally {
        setCreatingCall(false);
      }
    }
  }, [router, user?.uid, creatingCall]);

  const handleStartCall = useCallback(() => {
    setCreatingLink(false);
    setShowCallTypeModal(true);
  }, []);

  const handleAudioCall = useCallback(() => {
    setShowCallTypeModal(false);
    router.push({
      pathname: '/(home)/(modal)/new-message',
      params: { callType: 'audio' },
    });
  }, [router]);

  const handleVideoCall = useCallback(() => {
    setShowCallTypeModal(false);
    router.push({
      pathname: '/(home)/(modal)/new-message',
      params: { callType: 'video' },
    });
  }, [router]);

  const handleShareLink = async () => {
    try {
      await Share.share({
        message: callLink,
        title: t('calls.createCallLink'),
      });
    } catch (error) {
      if (__DEV__) console.error('Error sharing:', error);
    }
  };

  const handleCopyLink = async () => {
    try {
      await Clipboard.setStringAsync(callLink);
      Alert.alert(t('common.success'), t('calls.callLinkCopied'));
    } catch (error) {
      if (__DEV__) console.error('Error copying:', error);
    }
  };

  const handleCreateCallLink = async () => {
    if (!user?.uid) return;
    
    setCreatingLink(true);
    setShowCallTypeModal(true);
  };

  const handleCreateAudioCallLink = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setShowCallTypeModal(false);
      setCreatingLink(true);
      
      const { createCallLink } = await import('@/lib/services/callService');
      const { linkId, linkUrl } = await createCallLink(user.uid, 'audio');
      
      setCallLink(linkUrl);
      setShowCallLinkModal(true);
      
      // Auto-copy to clipboard
      await Clipboard.setStringAsync(linkUrl);
    } catch (error: any) {
      const errorMessage = error?.message || t('calls.errorCreatingLink');
      Alert.alert(t('common.error'), errorMessage);
    } finally {
      setCreatingLink(false);
    }
  }, [user?.uid, t]);

  const handleCreateVideoCallLink = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setShowCallTypeModal(false);
      setCreatingLink(true);
      
      const { createCallLink } = await import('@/lib/services/callService');
      const { linkId, linkUrl } = await createCallLink(user.uid, 'video');
      
      setCallLink(linkUrl);
      setShowCallLinkModal(true);
      
      // Auto-copy to clipboard
      await Clipboard.setStringAsync(linkUrl);
    } catch (error: any) {
      const errorMessage = error?.message || t('calls.errorCreatingLink');
      Alert.alert(t('common.error'), errorMessage);
    } finally {
      setCreatingLink(false);
    }
  }, [user?.uid, t]);

  return (
    <Screen viewClassName="flex-1 px-2 sm:px-4 items-start">
      <View className="flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <AppMenu />
        <View className="flex flex-row items-center gap-4 sm:gap-8">
          <Button variant="plain" onPress={handleStartCall}>
            <Feather name="phone" size={20} color={iconColor} />
          </Button>
        </View>
      </View>
      <Button
        variant="plain"
        className="flex flex-row items-center justify-center gap-2 sm:gap-4 mt-4 w-full"
        onPress={handleCreateCallLink}
        disabled={creatingLink}
      >
        <Feather name="link" size={20} color={creatingLink ? iconSecondaryColor : iconColor} />
        <Text className={clsx('font-semibold text-sm sm:text-base', creatingLink ? textSecondaryColor : textColor)}>
          {creatingLink ? t('common.loading') : t('calls.createCallLink')}
        </Text>
      </Button>
      {calls.length === 0 ? (
        <View className="flex-1 w-full flex-col items-center justify-center mt-8 px-4">
          <Text className={clsx('font-semibold text-base sm:text-lg', textColor)}>{t('calls.noRecentCalls')}</Text>
          <Text className={clsx('text-xs sm:text-sm text-center mt-2', textSecondaryColor)}>
            {t('calls.getStartedCalling')}
          </Text>
        </View>
      ) : (
        <View className="flex-1 w-full mt-4">
          <FlatList
            data={calls}
            keyExtractor={(item) => item.id}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
            initialNumToRender={15}
            windowSize={10}
            renderItem={({ item: call }) => {
            const otherUserId = call.callerId === user?.uid ? call.receiverId : call.callerId;
            const otherUser = userData[otherUserId];
            const chat = call.chatId ? chats.find(c => c.id === call.chatId) : undefined;
            const nameFromChat = chat?.participantData?.[otherUserId]?.name;
            const nameFromUser = otherUser
              ? `${otherUser.firstName} ${otherUser.lastName}`.trim() || otherUser.username
              : '';
            const participantName = nameFromUser || nameFromChat || t('calls.unknown');
            const isMissed = call.status === 'missed';
            const isRejected = call.status === 'rejected';
            const isCompleted = call.status === 'ended' && !!call.duration && call.duration > 0;
            const durationText = isCompleted ? formatDuration(call.duration || 0) : '';
            const dateText = formatDate(call.createdAt) || 'Unknown';
            
            return (
              <CallItem
                call={call}
                participantName={participantName}
                isMissed={isMissed}
                isRejected={isRejected}
                isCompleted={isCompleted}
                durationText={durationText}
                dateText={dateText}
                textColor={textColor}
                textSecondaryColor={textSecondaryColor}
                borderColor={borderColor}
                dotColor={dotColor}
                iconColor={iconColor}
                iconSecondaryColor={iconSecondaryColor}
                colorScheme={colorScheme}
                onPress={handleCallPress}
                avatarImage={otherUser?.avatar || chat?.participantData?.[otherUserId]?.avatar}
                missedText={t('calls.missed')}
                rejectedText={t('calls.rejected')}
              />
            );
          }}
          />
        </View>
      )}

      {/* Call Link Modal */}
      <Modal
        visible={showCallLinkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCallLinkModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 items-center justify-center px-4"
          onPress={() => setShowCallLinkModal(false)}
        >
          <Pressable
            className={clsx('w-full max-w-md rounded-3xl p-6', useThemeClassName('bg-white', 'bg-gray-900'))}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-6">
              <View className={clsx('w-16 h-16 rounded-full items-center justify-center mb-4', useThemeClassName('bg-orange-100', 'bg-orange-900/30'))}>
                <Feather name="check" size={32} color="#FF5722" />
              </View>
              <Text className={clsx('text-2xl font-bold mb-2', textColor)}>{t('calls.callLinkCreated')}</Text>
              <Text className={clsx('text-sm text-center', textSecondaryColor)}>{t('calls.callLinkCopied')}</Text>
            </View>

            <View className={clsx('p-4 rounded-2xl mb-6', useThemeClassName('bg-gray-50', 'bg-gray-800'))}>
              <TextInput
                value={callLink}
                editable={false}
                multiline
                className="text-sm font-mono"
                style={{ color: colorScheme === 'dark' ? '#ffffff' : '#000000' }}
              />
            </View>

            <View className="gap-3">
              <TouchableOpacity
                onPress={handleShareLink}
                className={clsx('flex-row items-center justify-center gap-3 p-4 rounded-2xl', useThemeClassName('bg-[#FF5722]', 'bg-[#FF5722]'))}
                activeOpacity={0.8}
              >
                <Feather name="share-2" size={20} color="#ffffff" />
                <Text className="text-white font-semibold text-base">{t('calls.shareLink')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleCopyLink}
                className={clsx('flex-row items-center justify-center gap-3 p-4 rounded-2xl border-2', useThemeClassName('bg-white border-gray-300', 'bg-gray-800 border-gray-700'))}
                activeOpacity={0.8}
              >
                <Feather name="copy" size={20} color={iconColor} />
                <Text className={clsx('font-semibold text-base', textColor)}>{t('common.copy')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowCallLinkModal(false)}
                className="p-4 items-center"
              >
                <Text className={clsx('font-semibold text-base', textSecondaryColor)}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Call Type Selection Modal */}
      <Modal
        visible={showCallTypeModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowCallTypeModal(false);
          setCreatingLink(false);
        }}
      >
        <Pressable
          className="flex-1 bg-black/50 items-center justify-end"
          onPress={() => setShowCallTypeModal(false)}
        >
          <Pressable
            className={clsx('w-full rounded-t-3xl p-6 pb-safe', useThemeClassName('bg-white', 'bg-gray-900'))}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-6">
              <View className={clsx('w-12 h-1 rounded-full mb-4', useThemeClassName('bg-gray-300', 'bg-gray-600'))} />
              <Text className={clsx('text-xl font-semibold', textColor)}>
                {creatingLink ? t('calls.createCallLink') : t('calls.startCall')}
              </Text>
              <Text className={clsx('text-sm mt-1', textSecondaryColor)}>
                {creatingLink ? t('calls.chooseCallTypeForLink') : t('calls.chooseCallType')}
              </Text>
            </View>

            <View className="gap-3">
              <TouchableOpacity
                onPress={creatingLink ? handleCreateAudioCallLink : handleAudioCall}
                className={clsx('flex-row items-center gap-4 p-4 rounded-2xl', useThemeClassName('bg-gray-50', 'bg-gray-800'))}
                activeOpacity={0.7}
              >
                <View className={clsx('w-12 h-12 rounded-full items-center justify-center', useThemeClassName('bg-blue-100', 'bg-blue-900/30'))}>
                  <Feather name="phone" size={24} color="#FF5722" />
                </View>
                <View className="flex-1">
                  <Text className={clsx('text-base font-semibold', textColor)}>{t('calls.audioCall')}</Text>
                  <Text className={clsx('text-sm', textSecondaryColor)}>
                    {creatingLink ? t('calls.createAudioCallLink') : t('calls.audioCallDescription')}
                  </Text>
                </View>
                <Feather name="chevron-right" size={20} color="#9CA3AF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={creatingLink ? handleCreateVideoCallLink : handleVideoCall}
                className={clsx('flex-row items-center gap-4 p-4 rounded-2xl', useThemeClassName('bg-gray-50', 'bg-gray-800'))}
                activeOpacity={0.7}
              >
                <View className={clsx('w-12 h-12 rounded-full items-center justify-center', useThemeClassName('bg-purple-100', 'bg-purple-900/30'))}>
                  <Feather name="video" size={24} color="#FF5722" />
                </View>
                <View className="flex-1">
                  <Text className={clsx('text-base font-semibold', textColor)}>{t('calls.videoCall')}</Text>
                  <Text className={clsx('text-sm', textSecondaryColor)}>
                    {creatingLink ? t('calls.createVideoCallLink') : t('calls.videoCallDescription')}
                  </Text>
                </View>
                <Feather name="chevron-right" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                setShowCallTypeModal(false);
                setCreatingLink(false);
              }}
              className="mt-4 p-4 items-center"
              activeOpacity={0.7}
            >
              <Text className={clsx('text-base font-semibold', textSecondaryColor)}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
};

export default CallsScreen;
