import { Entypo, Feather, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, Text, View } from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import UserCard from '@/components/UserCard';
import { useAuth } from '@/contexts/AuthContext';
import { useUsers } from '@/lib/hooks/useUsers';
import { getOrCreateDirectChat } from '@/lib/services/chatService';

const NewMessageScreen = () => {
  const router = useRouter();
  const { callType, media } = useLocalSearchParams<{ callType?: string; media?: string }>();
  const { user } = useAuth();
  const { users, loading: loadingUsers } = useUsers();
  const { t } = useTranslation();
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: string } | null>(null);

  // Filter out current user from the list
  const contacts = users.filter(u => u.uid !== user?.uid);

  useEffect(() => {
    const loadPendingMedia = async () => {
      if (media === 'true') {
        try {
          const stored = await AsyncStorage.getItem('pendingMedia');
          if (stored) {
            setPendingMedia(JSON.parse(stored));
          }
        } catch (error) {
          console.error('Error loading pending media:', error);
        }
      }
    };
    loadPendingMedia();
  }, [media]);

  const onSelectUser = useCallback(async (userId: string) => {
    if (!user) return;

    try {
      // Get or create chat
      const chatId = await getOrCreateDirectChat(user.uid, userId);
      
      // If media is provided, send it to the chat
      if (media === 'true' && pendingMedia) {
        // Store media and navigate to chat - media will be sent when chat opens
        try {
          await AsyncStorage.setItem('pendingMediaForChannel', JSON.stringify({
            channelId: chatId,
            media: pendingMedia,
          }));
          
          // Clear the general pending media
          await AsyncStorage.removeItem('pendingMedia');
          
          // Navigate to chat - media will be sent automatically
          router.dismissTo({
            pathname: '/chat/[id]',
            params: { id: chatId, pendingMedia: 'true' },
          });
        } catch (error) {
          console.error('Error preparing media:', error);
          // Still navigate to chat
          router.dismissTo({
            pathname: '/chat/[id]',
            params: { id: chatId },
          });
        }
        return;
      }
      
      // If callType is provided, start a call instead of going to chat
      if (callType === 'audio' || callType === 'video') {
        router.dismissTo({
          pathname: '/call/[id]',
          params: { 
            id: chatId, 
            updateCall: 'true',
            ...(callType === 'video' && { video: 'true' }),
          },
        });
      } else {
        // Default behavior: go to chat
        router.dismissTo({
          pathname: '/chat/[id]',
          params: { id: chatId },
        });
      }
    } catch (error) {
      console.error('Error creating/accessing chat:', error);
    }
  }, [user, router, callType, media, pendingMedia]);

  return (
    <Screen viewClassName="flex-1 pt-1 px-2 sm:px-4">
      {pendingMedia && (
        <View className="w-full items-center py-4 border-b border-gray-200 dark:border-gray-700 mb-4">
          <Text className="text-base font-semibold mb-3 text-gray-800 dark:text-gray-200">
            {t('chats.selectContactToSend')}
          </Text>
          <View className="w-32 h-32 rounded-lg overflow-hidden">
            {pendingMedia.type === 'video' ? (
              <View className="w-full h-full bg-gray-200 dark:bg-gray-700 items-center justify-center">
                <Feather name="video" size={40} color="#337E84" />
              </View>
            ) : (
              <Image 
                source={{ uri: pendingMedia.uri }} 
                className="w-full h-full"
                resizeMode="cover"
              />
            )}
          </View>
        </View>
      )}
      <View className="w-full flex-shrink-0">
        <Link href="/new-group" asChild>
          <Button
            variant="plain"
            className="bg-white flex-row items-center justify-between rounded-t-lg pt-0.5"
          >
            <View className="px-4">
              <MaterialIcons name="people-outline" size={24} color="black" />
            </View>
            <View className="flex-row flex-grow items-center justify-between gap-2 border-b border-gray-200">
              <Text>{t('chats.newGroup')}</Text>
              <View className="p-2">
                <Entypo name="chevron-small-right" size={24} color="gray" />
              </View>
            </View>
          </Button>
        </Link>
        <Link href="/find-by-username" asChild>
          <Button
            variant="plain"
            className="bg-white flex-row items-center justify-between pb-0.5"
          >
            <View className="px-4">
              <Feather name="at-sign" size={24} color="black" />
            </View>
            <View className="flex-row flex-grow items-center justify-between gap-2 border-b border-gray-200">
              <Text>{t('chats.findByUsername')}</Text>
              <View className="p-2">
                <Entypo name="chevron-small-right" size={24} color="gray" />
              </View>
            </View>
          </Button>
        </Link>
        <Link href="/find-by-contact" asChild>
          <Button
            variant="plain"
            className="bg-white flex-row items-center justify-between rounded-b-lg pb-0.5"
          >
            <View className="px-4">
              <MaterialIcons name="contact-phone" size={24} color="black" />
            </View>
            <View className="flex-row flex-grow items-center justify-between gap-2">
              <Text>{t('chats.findByContact')}</Text>
              <View className="p-2">
                <Entypo name="chevron-small-right" size={24} color="gray" />
              </View>
            </View>
          </Button>
        </Link>
      </View>
      {loadingUsers && (
        <View className="flex items-center justify-center py-4">
          <Spinner />
        </View>
      )}
      {!loadingUsers && contacts.length > 0 && (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.uid}
          className="flex-1 mt-4"
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          removeClippedSubviews={true}
          initialNumToRender={10}
          maxToRenderPerBatch={5}
          windowSize={5}
          renderItem={({ item: contact }) => (
            <UserCard
              user={{
                id: contact.uid,
                name: `${contact.firstName} ${contact.lastName}`,
                username: contact.username,
                image: contact.avatar,
              } as any}
              onPress={() => onSelectUser(contact.uid)}
            />
          )}
        />
      )}
      {!loadingUsers && contacts.length === 0 && (
        <View className="flex-1 items-center justify-center py-8">
          <Text className="text-gray-500 dark:text-gray-400 text-center">
            No contacts found
          </Text>
        </View>
      )}
    </Screen>
  );
};

export default NewMessageScreen;
