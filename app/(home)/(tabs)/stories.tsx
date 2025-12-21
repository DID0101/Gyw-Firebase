import { useUser } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import AppMenu from '@/components/AppMenu';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Screen from '@/components/Screen';
import StoryPickerModal from '@/components/StoryPickerModal';

interface Story {
  id: string;
  uri: string;
  type: 'image' | 'video';
  timestamp: string;
  userId: string;
  userName?: string;
  userImage?: string;
}

const StoriesScreen = () => {
  const { user } = useUser();
  const { t } = useTranslation();
  const router = useRouter();
  const [stories, setStories] = useState<Story[]>([]);
  const [myStories, setMyStories] = useState<Story[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const loadStories = async () => {
    try {
      const storedStories = await AsyncStorage.getItem('stories');
      if (storedStories) {
        const parsedStories = JSON.parse(storedStories);
        setStories(parsedStories);
        
        // Filter my stories
        const my = parsedStories.filter((s: Story) => s.userId === user?.id);
        setMyStories(my);
      }
    } catch (error) {
      console.error('Error loading stories:', error);
    }
  };

  useEffect(() => {
    loadStories();
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadStories();
    }, [user?.id])
  );

  const requestPermissions = async () => {
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (cameraStatus !== 'granted' || libraryStatus !== 'granted') {
      Alert.alert(
        t('stories.permissionRequired'),
        t('stories.permissionMessage'),
        [{ text: t('common.cancel') }]
      );
      return false;
    }
    return true;
  };

  const showStoryOptions = () => {
    setShowPicker(true);
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
        await saveStory(result.assets[0]);
      }
    } catch (error) {
      console.error('Error taking photo/video:', error);
      Alert.alert(t('common.error'), t('stories.errorTakingMedia'));
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
        await saveStory(result.assets[0]);
      }
    } catch (error) {
      console.error('Error selecting media:', error);
      Alert.alert(t('common.error'), t('stories.errorSelectingMedia'));
    }
  };

  const saveStory = async (asset: ImagePicker.ImagePickerAsset) => {
    try {
      const story: Story = {
        id: `${user?.id}-${Date.now()}`,
        uri: asset.uri,
        type: asset.type === 'video' ? 'video' : 'image',
        timestamp: new Date().toISOString(),
        userId: user?.id || '',
        userName: user?.fullName || '',
        userImage: user?.imageUrl || '',
      };

      const existingStories = await AsyncStorage.getItem('stories');
      const allStories = existingStories ? JSON.parse(existingStories) : [];
      
      // Add new story at the beginning
      allStories.unshift(story);
      
      // Keep only last 100 stories
      const recentStories = allStories.slice(0, 100);
      
      await AsyncStorage.setItem('stories', JSON.stringify(recentStories));
      await loadStories();
      
      // Navigate to story viewer
      setTimeout(() => {
        router.push(`/(home)/(modal)/story-viewer?storyId=${story.id}`);
      }, 300);
    } catch (error) {
      console.error('Error saving story:', error);
      Alert.alert(t('common.error'), t('stories.errorSavingStory'));
    }
  };

  const handleDeleteStory = async (storyId: string) => {
    try {
      const storedStories = await AsyncStorage.getItem('stories');
      if (storedStories) {
        const stories = JSON.parse(storedStories);
        const updatedStories = stories.filter((s: Story) => s.id !== storyId);
        await AsyncStorage.setItem('stories', JSON.stringify(updatedStories));
        await loadStories();
        Alert.alert(t('common.success'), t('stories.storyDeleted'));
      }
    } catch (error) {
      console.error('Error deleting story:', error);
      Alert.alert(t('common.error'), t('stories.errorDeletingStory'));
    }
  };

  const onLongPressStory = (story: Story) => {
    // Only allow deleting own stories
    if (story.userId !== user?.id) {
      return;
    }

    Alert.alert(
      t('stories.deleteStory'),
      t('stories.confirmDeleteStory'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => handleDeleteStory(story.id),
        },
      ]
    );
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffHours < 1) return t('stories.justNow');
    if (diffHours < 24) return `${diffHours}${t('stories.hoursAgo')}`;
    if (diffDays < 7) return `${diffDays}${t('stories.daysAgo')}`;
    return date.toLocaleDateString();
  };

  return (
    <Screen className="bg-white" viewClassName="flex-1 px-2 sm:px-4 pt-1">
      <View className="flex flex-row items-center justify-between w-full min-h-[32px] flex-shrink-0">
        <AppMenu />
        <View className="flex flex-row items-center gap-4 sm:gap-8">
          <TouchableOpacity onPress={openCamera} activeOpacity={0.7}>
            <Feather name="camera" size={20} color="black" />
          </TouchableOpacity>
        </View>
      </View>
      
      <Button 
        variant="plain" 
        className="flex-row items-center gap-2 sm:gap-3 mt-4 w-full"
        onPress={showStoryOptions}
      >
        <View className="relative w-10 h-10 flex-shrink-0">
          <Avatar
            imageUrl={user?.imageUrl}
            size={40}
            fontSize={16}
            name={user?.fullName!}
          />
          <View className="absolute -bottom-1 -right-1 w-[22px] h-[22px] rounded-full border-[3px] border-white bg-blue-600 flex items-center justify-center">
            <Feather name="plus" size={14} color="white" />
          </View>
        </View>
        <View className="flex-1 min-w-0">
          <Text className="font-semibold text-sm sm:text-base">{t('stories.myStories')}</Text>
          <Text className="text-xs text-gray-500">
            {myStories.length > 0 
              ? `${myStories.length} ${myStories.length === 1 ? t('stories.story') : t('stories.stories')}`
              : t('stories.tapToAdd')
            }
          </Text>
        </View>
      </Button>

      {stories.length > 0 ? (
        <ScrollView className="flex-1 mt-4" showsVerticalScrollIndicator={false}>
          <View className="flex flex-col gap-3">
            {stories.map((story) => (
              <TouchableOpacity
                key={story.id}
                className="flex flex-row items-center gap-3 p-3 bg-gray-50 rounded-xl active:bg-gray-100"
                onPress={() => {
                  router.push(`/(home)/(modal)/story-viewer?storyId=${story.id}`);
                }}
                onLongPress={() => onLongPressStory(story)}
              >
                <View className="relative">
                  {story.type === 'image' ? (
                    <Image
                      source={{ uri: story.uri }}
                      className="w-16 h-16 rounded-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="w-16 h-16 rounded-full bg-gray-300 items-center justify-center">
                      <Feather name="video" size={24} color="black" />
                    </View>
                  )}
                  {story.type === 'video' && (
                    <View className="absolute bottom-0 right-0 bg-blue-600 rounded-full p-1">
                      <Feather name="play" size={12} color="white" />
                    </View>
                  )}
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-base">
                    {story.userName || t('stories.unknown')}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    {formatTime(story.timestamp)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center mt-8">
          <Text className="text-gray-500 text-center">
            {t('stories.noStories')}
          </Text>
        </View>
      )}

      <StoryPickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onCameraPress={openCamera}
        onGalleryPress={openGallery}
      />
    </Screen>
  );
};

export default StoriesScreen;
