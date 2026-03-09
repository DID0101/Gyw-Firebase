import { useAuth } from '@/contexts/AuthContext';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Image, Text, TouchableOpacity, View } from 'react-native';

import AppMenu from '@/components/AppMenu';
import Screen from '@/components/Screen';
import StoryPickerModal from '@/components/StoryPickerModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { useStories } from '@/lib/hooks/useStories';
import { useUsersData } from '@/lib/hooks/useUsersData';
import { createStory } from '@/lib/services/storyService';
import { Story } from '@/lib/services/storyService';
import { useStoryStore } from '@/store/storyStore';

interface StoryGroup {
  userId: string;
  userName?: string;
  userImage?: string;
  stories: Story[];
  hasUnseen: boolean;
}

const StoriesScreen = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const router = useRouter();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const { stories, loading: storiesLoading } = useStories();
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Get unique user IDs from stories
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    stories.forEach((story) => ids.add(story.userId));
    return Array.from(ids);
  }, [stories]);

  const { usersData } = useUsersData(userIds);

  // Group stories by user
  const storyGroups = useMemo(() => {
    const groupsMap = new Map<string, StoryGroup>();
    
    // Add my stories first
    const myStories = stories.filter((s) => s.userId === user?.uid);
    if (myStories.length > 0 || user?.uid) {
      const userData = user?.uid ? usersData[user.uid] : null;
      groupsMap.set(user?.uid || '', {
        userId: user?.uid || '',
        userName: userData ? `${userData.firstName} ${userData.lastName}`.trim() : user?.displayName || t('stories.myStories'),
        userImage: userData?.avatar || user?.photoURL,
        stories: myStories,
        hasUnseen: false, // Own stories are always "seen"
      });
    }
    
    // Add other users' stories
    stories.forEach((story) => {
      if (story.userId !== user?.uid) {
        const existing = groupsMap.get(story.userId);
        const userData = usersData[story.userId];
        const userName = userData 
          ? `${userData.firstName} ${userData.lastName}`.trim() 
          : 'Unknown';
        const userImage = userData?.avatar;
        
        if (existing) {
          existing.stories.push(story);
          // Check if any story is unseen (not in viewers)
          if (!existing.hasUnseen) {
            const isViewed = story.viewers.some((v) => v.userId === user?.uid);
            if (!isViewed) {
              existing.hasUnseen = true;
            }
          }
        } else {
          const isViewed = story.viewers.some((v) => v.userId === user?.uid);
          groupsMap.set(story.userId, {
            userId: story.userId,
            userName,
            userImage,
            stories: [story],
            hasUnseen: !isViewed,
          });
        }
      }
    });
    
    // Sort stories within each group by createdAt (newest first)
    groupsMap.forEach((group) => {
      group.stories.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    
    return Array.from(groupsMap.values());
  }, [stories, usersData, user?.uid, t]);

  useFocusEffect(
    useCallback(() => {
      // Reset uploading state when screen comes into focus
      setUploading(false);
    }, [])
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
      Alert.alert(t('common.error'), t('stories.errorSelectingMedia'));
    }
  };

  const saveStory = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user?.uid) return;
    
    setUploading(true);
    setShowPicker(false); // Close modal
    
    try {
      const mediaType = asset.type === 'video' ? 'video' : 'image';
      const storyId = await createStory(user.uid, asset.uri, mediaType);
      
      // Reset uploading state before navigation
      setUploading(false);
      
      // Navigate to story viewer with the newly created story
      setTimeout(() => {
        router.push(`/(home)/(modal)/story-viewer?storyId=${storyId}&userId=${user.uid}`);
      }, 300);
    } catch (error: any) {
      const errorMessage = error?.message || t('stories.errorSavingStory');
      Alert.alert(t('common.error'), errorMessage);
      setUploading(false); // Reset uploading state on error
    }
  };

  const STORY_SIZE = 72;
  const STORY_BORDER_WIDTH = 3;

  const renderStoryItem = useCallback(({ item }: { item: StoryGroup }) => {
    const isMyStory = item.userId === user?.uid;
    const hasUnseen = item.hasUnseen;
    const latestStory = item.stories[0];
    
    return (
      <TouchableOpacity
        key={item.userId}
        onPress={() => {
          if (item.stories.length > 0) {
            router.push(`/(home)/(modal)/story-viewer?storyId=${latestStory.id}&userId=${item.userId}`);
          } else if (isMyStory) {
            showStoryOptions();
          }
        }}
        className="items-center mx-2"
        activeOpacity={0.8}
      >
        <View
          style={{
            width: STORY_SIZE + STORY_BORDER_WIDTH * 2,
            height: STORY_SIZE + STORY_BORDER_WIDTH * 2,
            borderRadius: (STORY_SIZE + STORY_BORDER_WIDTH * 2) / 2,
            padding: STORY_BORDER_WIDTH,
            backgroundColor: '#FFFFFF',
            borderWidth: hasUnseen ? 0 : STORY_BORDER_WIDTH,
            borderColor: hasUnseen ? 'transparent' : (isMyStory ? '#086da0' : '#9E9E9E'),
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {/* Gradient border effect for unviewed stories */}
          {hasUnseen && (
            <View
              style={{
                position: 'absolute',
                width: STORY_SIZE + STORY_BORDER_WIDTH * 2,
                height: STORY_SIZE + STORY_BORDER_WIDTH * 2,
                borderRadius: (STORY_SIZE + STORY_BORDER_WIDTH * 2) / 2,
                backgroundColor: '#833AB4', // Purple gradient base
                padding: STORY_BORDER_WIDTH,
              }}
            >
              <View
                style={{
                  width: STORY_SIZE,
                  height: STORY_SIZE,
                  borderRadius: STORY_SIZE / 2,
                  backgroundColor: colorScheme === 'dark' ? '#1F1F1F' : '#FFFFFF',
                }}
              />
            </View>
          )}
          
          {/* Story content */}
          <View
            style={{
              width: STORY_SIZE,
              height: STORY_SIZE,
              borderRadius: STORY_SIZE / 2,
              overflow: 'hidden',
              backgroundColor: colorScheme === 'dark' ? '#2F2F2F' : '#E0E0E0',
              borderWidth: hasUnseen ? 3 : 0,
              borderColor: '#FFFFFF',
            }}
          >
            {latestStory ? (
              latestStory.mediaType === 'image' ? (
                <Image
                  source={{ uri: latestStory.mediaUrl }}
                  style={{ width: STORY_SIZE, height: STORY_SIZE }}
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center bg-gray-300 dark:bg-gray-700">
                  {latestStory.thumbnailUrl ? (
                    <Image
                      source={{ uri: latestStory.thumbnailUrl }}
                      style={{ width: STORY_SIZE, height: STORY_SIZE }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Feather name="video" size={28} color={colorScheme === 'dark' ? 'white' : 'black'} />
                  )}
                </View>
              )
            ) : (
              <View className="w-full h-full items-center justify-center bg-gray-300 dark:bg-gray-700">
                <Feather name="plus" size={28} color={colorScheme === 'dark' ? 'white' : 'black'} />
              </View>
            )}
          </View>
          
          {/* Plus icon for my story */}
          {isMyStory && (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: '#086da0',
                borderWidth: 3,
                borderColor: '#FFFFFF',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Feather name="plus" size={14} color="white" />
            </View>
          )}
        </View>
        
        {/* Username below story */}
        <Text
          className={clsx('text-xs mt-2 max-w-[80px]', textColor)}
          numberOfLines={1}
          style={{ textAlign: 'center' }}
        >
          {isMyStory ? t('stories.myStories') : (item.userName || t('stories.unknown'))}
        </Text>
      </TouchableOpacity>
    );
  }, [user?.uid, router, colorScheme, textColor, t]);

  if (storiesLoading) {
    return (
      <Screen viewClassName="flex-1">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={iconColor} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen viewClassName="flex-1">
      <View className="flex flex-row items-center justify-between w-full min-h-[32px] flex-shrink-0 px-4 pt-2">
        <AppMenu />
        <TouchableOpacity onPress={showStoryOptions} activeOpacity={0.7} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : (
            <Feather name="camera" size={20} color={iconColor} />
          )}
        </TouchableOpacity>
      </View>
      
      {/* Horizontal scrollable stories */}
      {storyGroups.length > 0 ? (
        <View className="py-4 border-b" style={{ borderBottomColor: colorScheme === 'dark' ? '#2F2F2F' : '#E0E0E0' }}>
          <FlatList
            data={storyGroups}
            renderItem={renderStoryItem}
            keyExtractor={(item) => item.userId}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 8 }}
            initialNumToRender={6}
            windowSize={5}
            removeClippedSubviews={true}
          />
        </View>
      ) : (
        <View className="py-8 items-center border-b" style={{ borderBottomColor: colorScheme === 'dark' ? '#2F2F2F' : '#E0E0E0' }}>
          <Text className={clsx('text-center', textSecondaryColor)}>
            {t('stories.noStories')}
          </Text>
          <TouchableOpacity
            onPress={showStoryOptions}
            className="mt-4 px-6 py-3 rounded-full"
            style={{ backgroundColor: colorScheme === 'dark' ? '#2F2F2F' : '#E0E0E0' }}
            disabled={uploading}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={iconColor} />
            ) : (
              <Text className={clsx('font-semibold', textColor)}>{t('stories.tapToAdd')}</Text>
            )}
          </TouchableOpacity>
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
