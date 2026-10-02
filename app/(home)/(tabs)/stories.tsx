import { useAuth } from '@/contexts/AuthContext';
import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, FlatList, Platform, Text, TouchableOpacity, View } from 'react-native';

import AppImage from '@/components/AppImage';
import AppMenu from '@/components/AppMenu';
import Screen from '@/components/Screen';
import StoryPickerModal from '@/components/StoryPickerModal';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { TAB_HEADER_ICON_SIZE } from '@/lib/ui/tabHeader';
import { useStories } from '@/lib/hooks/useStories';
import { useStorySeenSync } from '@/lib/hooks/useStorySeenSync';
import { useUsersData } from '@/lib/hooks/useUsersData';
import { getStoriesRingListTuning } from '@/lib/perf/listTuning';
import { scheduleLikelyRouteChunksIdle } from '@/lib/perf/navigationPreload';
import { storiesLoadLog } from '@/lib/debug/storiesLoadingTrace';
import { logScreenLifecycle } from '@/lib/debug/runtimeDiagnostics';
import { useProductionScreenTrace } from '@/lib/hooks/useProductionScreenTrace';
import { createStory, legacyStorySeenByUser, type Story } from '@/lib/services/storyService';
import { type StoryGroup } from '@/lib/stories/storyAdPlacement';
import {
  STORY_BORDER_WIDTH,
  STORY_RING_ITEM_WIDTH,
  STORY_SIZE,
} from '@/lib/stories/storyRingLayout';
import { useStoryStore } from '@/store/storyStore';

function groupHasUnseenStories(
  group: Pick<StoryGroup, 'userId' | 'stories'>,
  myUid: string | undefined,
  viewedIds: Record<string, true>
): boolean {
  if (!myUid || group.userId === myUid) return false;
  return group.stories.some(
    (s) => !viewedIds[s.id] && !legacyStorySeenByUser(s, myUid)
  );
}

function storyRingThumbUri(story: Story): string | undefined {
  if (story.mediaType === 'video') return story.thumbnailUrl;
  return story.thumbnailUrl || story.mediaUrl;
}

type StoryRingRowProps = {
  item: StoryGroup;
  myUid?: string;
  colorScheme: 'light' | 'dark';
  textColor: string;
  t: (key: string) => string;
  onOpenViewer: (storyId: string, userId: string) => void;
  onAddMine: () => void;
};

const StoryRingRow = memo(function StoryRingRow({
  item,
  myUid,
  colorScheme,
  textColor,
  t,
  onOpenViewer,
  onAddMine,
}: StoryRingRowProps) {
  const isMyStory = item.userId === myUid;
  const hasUnseen = item.hasUnseen;
  const latestStory = item.stories[0];
  const thumbUri = latestStory ? storyRingThumbUri(latestStory) : undefined;

  return (
    <TouchableOpacity
      onPress={() => {
        if (item.stories.length > 0 && latestStory) {
          onOpenViewer(latestStory.id, item.userId);
        } else if (isMyStory) {
          onAddMine();
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
          borderColor: hasUnseen ? 'transparent' : isMyStory ? '#086da0' : '#9E9E9E',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {hasUnseen && (
          <View
            style={{
              position: 'absolute',
              width: STORY_SIZE + STORY_BORDER_WIDTH * 2,
              height: STORY_SIZE + STORY_BORDER_WIDTH * 2,
              borderRadius: (STORY_SIZE + STORY_BORDER_WIDTH * 2) / 2,
              backgroundColor: '#833AB4',
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
          {latestStory && thumbUri ? (
            <AppImage
              source={{ uri: thumbUri }}
              style={{ width: STORY_SIZE, height: STORY_SIZE }}
              contentFit="cover"
              recyclingKey={thumbUri}
              onLoadStart={() => {
                storiesLoadLog('STORIES_IMAGES_LOAD_START', { storyId: latestStory.id });
              }}
              onLoad={() => {
                storiesLoadLog('STORIES_IMAGES_LOAD_COMPLETE', { storyId: latestStory.id });
              }}
            />
          ) : latestStory?.mediaType === 'video' ? (
            <View className="w-full h-full items-center justify-center bg-gray-300 dark:bg-gray-700">
              <Feather name="video" size={28} color={colorScheme === 'dark' ? 'white' : 'black'} />
            </View>
          ) : latestStory ? (
            <View className="w-full h-full items-center justify-center bg-gray-300 dark:bg-gray-700">
              <Feather name="image" size={28} color={colorScheme === 'dark' ? 'white' : 'black'} />
            </View>
          ) : (
            <View className="w-full h-full items-center justify-center bg-gray-300 dark:bg-gray-700">
              <Feather name="plus" size={28} color={colorScheme === 'dark' ? 'white' : 'black'} />
            </View>
          )}
        </View>

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

      <Text
        className={clsx('text-xs mt-2 max-w-[80px]', textColor)}
        numberOfLines={1}
        style={{ textAlign: 'center' }}
      >
        {isMyStory ? t('stories.myStories') : item.userName || t('stories.unknown')}
      </Text>
    </TouchableOpacity>
  );
}, (prev, next) =>
  prev.item.userId === next.item.userId &&
  prev.item.hasUnseen === next.item.hasUnseen &&
  prev.item.stories.length === next.item.stories.length &&
  (prev.item.stories[0]?.id ?? '') === (next.item.stories[0]?.id ?? '') &&
  prev.myUid === next.myUid &&
  prev.colorScheme === next.colorScheme &&
  prev.textColor === next.textColor &&
  prev.item.userName === next.item.userName &&
  prev.item.userImage === next.item.userImage &&
  prev.onOpenViewer === next.onOpenViewer &&
  prev.onAddMine === next.onAddMine
);

const StoriesScreen = () => {
  const usersFetchLoggedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const firstRenderLoggedRef = useRef(false);
  const listTuning = useMemo(() => getStoriesRingListTuning(), []);

  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  useProductionScreenTrace('StoriesTab', { lang: i18n.language });

  useEffect(() => {
    logScreenLifecycle('Stories', 'MOUNT', {
      mountTimeMs: mountedAtRef.current,
      authUid: user?.uid ?? null,
    });
    storiesLoadLog('STORIES_SCREEN_MOUNT');
  }, []);
  useEffect(() => {
    if (firstRenderLoggedRef.current) return;
    firstRenderLoggedRef.current = true;
    logScreenLifecycle('Stories', 'FIRST_RENDER', {
      elapsedSinceMountMs: Date.now() - mountedAtRef.current,
      authUid: user?.uid ?? null,
    });
  }, [user?.uid]);
  const { colorScheme } = useTheme();
  const router = useRouter();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const { stories, loading: storiesLoading } = useStories();
  const viewedStoryIds = useStoryStore((s) => s.viewedStoryIds);
  useStorySeenSync(user?.uid, stories);
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Get unique user IDs from stories
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    stories.forEach((story) => ids.add(story.userId));
    return Array.from(ids);
  }, [stories]);

  const { usersData } = useUsersData(userIds);

  useEffect(() => {
    if (userIds.length === 0) return;
    storiesLoadLog('STORIES_USERS_FETCH_START', { userIds: userIds.length });
    usersFetchLoggedRef.current = true;
  }, [userIds]);

  useEffect(() => {
    if (!usersFetchLoggedRef.current || userIds.length === 0) return;
    storiesLoadLog('STORIES_USERS_FETCH_COMPLETE', {
      requested: userIds.length,
      resolved: Object.keys(usersData).length,
    });
  }, [userIds, usersData]);

  const storyGroups = useMemo(() => {
    const groupsMap = new Map<string, StoryGroup>();
    
    // Add my stories first
    const myStories = stories.filter((s) => s.userId === user?.uid);
    if (myStories.length > 0 || user?.uid) {
      const userData = user?.uid ? usersData[user.uid] : null;
      groupsMap.set(user?.uid || '', {
        userId: user?.uid || '',
        userName: userData ? `${userData.firstName} ${userData.lastName}`.trim() : user?.displayName || t('stories.myStories'),
        userImage: (userData?.avatar || user?.photoURL) ?? undefined,
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
        } else {
          groupsMap.set(story.userId, {
            userId: story.userId,
            userName,
            userImage,
            stories: [story],
            hasUnseen: false,
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

    const out: StoryGroup[] = [];
    for (const g of groupsMap.values()) {
      out.push({
        ...g,
        hasUnseen: groupHasUnseenStories(g, user?.uid, viewedStoryIds),
      });
    }

    return out;
  }, [stories, usersData, user?.uid, t, viewedStoryIds]);

  const storyRingGetItemLayout = useCallback(
    (_: ArrayLike<StoryGroup> | null | undefined, index: number) => ({
      length: STORY_RING_ITEM_WIDTH,
      offset: STORY_RING_ITEM_WIDTH * index,
      index,
    }),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      setUploading(false);
      scheduleLikelyRouteChunksIdle();
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

  const showStoryOptions = useCallback(() => {
    setShowPicker(true);
  }, []);

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

  const openStoryViewer = useCallback(
    (sid: string, uid: string) => {
      router.push(`/(home)/(modal)/story-viewer?storyId=${sid}&userId=${uid}`);
    },
    [router]
  );

  const renderStoryItem = useCallback(
    ({ item }: { item: StoryGroup }) => (
      <StoryRingRow
        item={item}
        myUid={user?.uid}
        colorScheme={colorScheme}
        textColor={textColor}
        t={t}
        onOpenViewer={openStoryViewer}
        onAddMine={showStoryOptions}
      />
    ),
    [user?.uid, colorScheme, textColor, t, openStoryViewer, showStoryOptions],
  );

  const showStoriesSpinner = storiesLoading && stories.length === 0;

  useEffect(() => {
    logScreenLifecycle('Stories', 'RENDER_STATE', {
      loading: storiesLoading,
      stories: stories.length,
      groups: storyGroups.length,
      showSpinner: showStoriesSpinner,
      authUid: user?.uid ?? null,
    });
  }, [storiesLoading, stories.length, storyGroups.length, showStoriesSpinner, user?.uid]);

  return (
    <Screen viewClassName="flex-1">
      <View className="flex flex-row items-center justify-between w-full min-h-[32px] flex-shrink-0 px-4 pt-2">
        <AppMenu />
        <TouchableOpacity onPress={showStoryOptions} activeOpacity={0.7} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={iconColor} />
          ) : (
            <Feather name="camera" size={TAB_HEADER_ICON_SIZE} color={iconColor} />
          )}
        </TouchableOpacity>
      </View>
      
      {showStoriesSpinner ? (
        <View className="py-12 items-center">
          <ActivityIndicator size="large" color={iconColor} />
        </View>
      ) : null}

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
            getItemLayout={storyRingGetItemLayout}
            initialNumToRender={listTuning.initialNumToRender}
            maxToRenderPerBatch={listTuning.maxToRenderPerBatch}
            windowSize={listTuning.windowSize}
            updateCellsBatchingPeriod={listTuning.updateCellsBatchingPeriod}
            removeClippedSubviews={Platform.OS === 'android'}
          />
        </View>
      ) : !showStoriesSpinner ? (
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
      ) : null}

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
