import { Entypo, Feather, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Text, View } from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
const NewMessageScreen = () => {
  const { callType, media } = useLocalSearchParams<{ callType?: string; media?: string }>();
  const { t } = useTranslation();
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: string } | null>(null);

  const searchHref = {
    pathname: '/(home)/(modal)/find-by-username' as const,
    params: {
      ...(callType ? { callType: String(callType) } : {}),
      ...(media ? { media: String(media) } : {}),
    },
  };

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
                <Feather name="video" size={40} color="#FF5722" />
              </View>
            ) : (
              <Image source={{ uri: pendingMedia.uri }} className="w-full h-full" resizeMode="cover" />
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
        <Link href={searchHref} asChild>
          <Button
            variant="plain"
            className="bg-white flex-row items-center justify-between rounded-b-lg pb-0.5"
          >
            <View className="px-4">
              <Feather name="search" size={22} color="black" />
            </View>
            <View className="flex-row flex-grow items-center justify-between gap-2">
              <Text>{t('chats.newChat')}</Text>
              <View className="p-2">
                <Entypo name="chevron-small-right" size={24} color="gray" />
              </View>
            </View>
          </Button>
        </Link>
      </View>
      <View className="flex-1" />
    </Screen>
  );
};

export default NewMessageScreen;
