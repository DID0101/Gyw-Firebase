import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Alert, 
  Dimensions, 
  Image, 
  Modal, 
  Pressable, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import { 
  getStory, 
  getUserStories, 
  viewStory, 
  toggleLikeStory,
  Story 
} from '@/lib/services/storyService';
import { getOrCreateDirectChat, sendMediaMessage } from '@/lib/services/chatService';
import { useUsersData } from '@/lib/hooks/useUsersData';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5 seconds for images

const StoryViewer = () => {
  const router = useRouter();
  const { storyId, userId } = useLocalSearchParams<{ storyId: string; userId?: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [stories, setStories] = useState<Story[]>([]);
  const [currentStory, setCurrentStory] = useState<Story | null>(null);
  const [videoUri, setVideoUri] = useState<string>('');
  const [isLiked, setIsLiked] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preloadedNextStory, setPreloadedNextStory] = useState<Story | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextStoryImageRef = useRef<string | null>(null);
  const currentVideoUriRef = useRef<string>('');
  
  // Initialize video player with a stable placeholder URL
  // The player source should not change frequently to avoid recreation
  const placeholderVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  const player = useVideoPlayer(placeholderVideoUrl);

  // Load stories for the user
  useEffect(() => {
    const loadStories = async () => {
      try {
        if (userId) {
          const userStories = await getUserStories(userId);
          setStories(userStories);
          
          // Find current story index
          const index = userStories.findIndex((s) => s.id === storyId);
          if (index >= 0) {
            setCurrentStoryIndex(index);
            setCurrentStory(userStories[index]);
          } else if (userStories.length > 0) {
            setCurrentStoryIndex(0);
            setCurrentStory(userStories[0]);
          }
        } else {
          // Fallback: load single story
          const story = await getStory(storyId);
          if (story) {
            setStories([story]);
            setCurrentStory(story);
            setCurrentStoryIndex(0);
          }
        }
      } catch (error) {
        Alert.alert(t('common.error'), t('stories.failedToLoad'));
      }
    };
    
    loadStories();
  }, [storyId, userId, t]);

  // Mark story as viewed
  useEffect(() => {
    if (currentStory && user?.uid) {
      viewStory(currentStory.id, user.uid).catch((err) => {
        if (__DEV__) console.warn('[StoryViewer] viewStory failed:', err);
      });
    }
  }, [currentStory?.id, user?.uid]);

  // Update like status
  useEffect(() => {
    if (currentStory && user?.uid) {
      setIsLiked(currentStory.likes.includes(user.uid));
    }
  }, [currentStory, user?.uid]);

  // Preload next story
  useEffect(() => {
    if (stories.length > 0 && currentStoryIndex < stories.length - 1) {
      const nextStory = stories[currentStoryIndex + 1];
      setPreloadedNextStory(nextStory);
      
      // Preload next story image (React Native Image component preloads automatically when rendered)
      if (nextStory.mediaType === 'image') {
        nextStoryImageRef.current = nextStory.mediaUrl;
        // Image will be preloaded when it's rendered in the UI
      }
    } else {
      setPreloadedNextStory(null);
      nextStoryImageRef.current = null;
    }
  }, [stories, currentStoryIndex]);

  // Configure video player when URI or paused state changes
  useEffect(() => {
    if (!player || !videoUri) return;
    
    // Only update if URI has changed
    if (videoUri !== currentVideoUriRef.current && videoUri !== placeholderVideoUrl) {
      currentVideoUriRef.current = videoUri;
      
      // Use replaceAsync to load the new video
      const timer = setTimeout(() => {
        if (player && videoUri) {
          player.replaceAsync(videoUri).then(() => {
            if (player) {
              try {
                player.loop = false;
                player.muted = false;
                player.currentTime = 0;
                if (!paused) {
                  player.play();
                }
              } catch (error) {
                // Ignore configuration errors
              }
            }
          }).catch((error) => {
            if (__DEV__) console.warn('[StoryViewer] Video replaceAsync failed:', error);
          });
        }
      }, 300);
      
      return () => clearTimeout(timer);
    } else if (videoUri === currentVideoUriRef.current) {
      // URI hasn't changed, just update play/pause state
      try {
        if (!paused) {
          player.play();
        } else {
          player.pause();
        }
      } catch (error) {
        // Ignore errors
      }
    }
  }, [videoUri, paused, player, placeholderVideoUrl]);

  // Handle video player - reset properly when story changes
  useEffect(() => {
    if (currentStory?.mediaType === 'video' && currentStory.mediaUrl) {
      // Update video URI - this will trigger player update in the other useEffect
      setVideoUri(currentStory.mediaUrl);
    } else {
      setVideoUri('');
      currentVideoUriRef.current = '';
      if (player) {
        try {
          player.pause();
          player.currentTime = 0;
        } catch (error) {
          // Ignore errors if player is not ready
        }
      }
    }
  }, [currentStory?.id, currentStory?.mediaType, currentStory?.mediaUrl, player]);

  const handleNextStory = useCallback(() => {
    if (currentStoryIndex < stories.length - 1) {
      setProgress(0);
      const nextIndex = currentStoryIndex + 1;
      setCurrentStoryIndex(nextIndex);
      setCurrentStory(stories[nextIndex]);
      if (player) {
        player.pause();
        player.currentTime = 0;
        // Video will be loaded via the useEffect hook
      }
    } else {
      // Close viewer (modal - use dismiss)
      if (router.canGoBack()) {
        router.back();
      } else {
        router.dismiss();
      }
    }
  }, [currentStoryIndex, stories, router, player]);

  const handlePreviousStory = useCallback(() => {
    if (currentStoryIndex > 0) {
      setProgress(0);
      const prevIndex = currentStoryIndex - 1;
      setCurrentStoryIndex(prevIndex);
      setCurrentStory(stories[prevIndex]);
      if (player) {
        player.pause();
        player.currentTime = 0;
        // Video will be loaded via the useEffect hook
      }
    }
  }, [currentStoryIndex, stories, player]);

  // Progress bar for images (avoid calling handleNextStory inside setState updater to prevent setState-during-render warning)
  useEffect(() => {
    if (currentStory?.mediaType === 'image' && !paused) {
      progressIntervalRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            setTimeout(handleNextStory, 0);
            return 0;
          }
          return prev + 2; // Update every 100ms (5s total)
        });
      }, 100);
    } else {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [currentStory, paused, handleNextStory]);

  // Handle tap navigation (left/right) - must be after handleNextStory/handlePreviousStory
  const handleTap = useCallback((event: any) => {
    const { locationX, locationY } = event.nativeEvent;
    const screenCenter = SCREEN_WIDTH / 2;
    const bottomAreaHeight = 150; // Height of bottom action area
    
    // Don't trigger navigation if tap is in bottom action area
    if (locationY > SCREEN_HEIGHT - bottomAreaHeight) {
      return;
    }
    
    if (locationX < screenCenter) {
      // Tap on left side - previous story
      handlePreviousStory();
    } else {
      // Tap on right side - next story
      handleNextStory();
    }
  }, [handleNextStory, handlePreviousStory]);

  const handleLike = async () => {
    if (!currentStory || !user?.uid) return;
    
    try {
      const newLiked = await toggleLikeStory(currentStory.id, user.uid);
      setIsLiked(newLiked);
      
      // Update local story
      setCurrentStory({
        ...currentStory,
        likes: newLiked
          ? [...currentStory.likes, user.uid]
          : currentStory.likes.filter((id) => id !== user.uid),
      });
    } catch (error) {
      Alert.alert(t('common.error'), t('stories.failedToLike'));
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !currentStory || !user) return;
    
    setLoading(true);
    try {
      // Get or create chat with story owner
      const chatId = await getOrCreateDirectChat(user.uid, currentStory.userId);
      
      // Send reply message with story thumbnail and reply text
      const { sendMessage } = await import('@/lib/services/chatService');
      await sendMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL ?? undefined,
        `${t('stories.replyToStory')} ${storyOwnerName}\n\n${replyText}`,
        {
          messageId: currentStory.id,
          senderName: storyOwnerName,
          text: currentStory.caption || (currentStory.mediaType === 'video' ? 'Video' : 'Photo'),
          type: currentStory.mediaType,
        }
      );
      
      // Also send the story media as a separate message for better UX
      await sendMediaMessage(
        chatId,
        user.uid,
        user?.displayName || user?.phoneNumber || 'User',
        user?.photoURL ?? undefined,
        currentStory.mediaUrl,
        currentStory.mediaType === 'video' ? 'video' : 'image'
      );
      
      setShowReplyModal(false);
      setReplyText('');
      Alert.alert(t('common.success'), t('stories.replySent'));
    } catch (error) {
      Alert.alert(t('common.error'), t('stories.errorSendingReply'));
    } finally {
      setLoading(false);
    }
  };

  // Handle press in (pause)
  const handlePressIn = useCallback(() => {
    setPaused(true);
    if (player && currentStory?.mediaType === 'video') {
      player.pause();
    }
  }, [player, currentStory]);

  // Handle press out (resume)
  const handlePressOut = useCallback(() => {
    setPaused(false);
    if (player && currentStory?.mediaType === 'video') {
      player.play();
    }
  }, [player, currentStory]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) {
      return t('stories.justNow');
    } else if (diffMinutes < 60) {
      return `${diffMinutes} ${t('stories.minutesAgo')}`;
    } else if (diffHours < 24) {
      return `${diffHours} ${t('stories.hoursAgo')}`;
    } else {
      return `${Math.floor(diffHours / 24)} ${t('stories.daysAgo')}`;
    }
  };

  const storyOwnerId = currentStory?.userId || userId || '';
  const { usersData } = useUsersData(storyOwnerId ? [storyOwnerId] : []);
  const storyOwner = storyOwnerId ? usersData[storyOwnerId] : null;
  const storyOwnerName = storyOwner
    ? (`${storyOwner.firstName ?? ''} ${storyOwner.lastName ?? ''}`).trim() || storyOwner.username || 'Unknown'
    : 'Unknown';
  const storyOwnerImage = storyOwner?.avatar;

  if (!currentStory) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {/* Progress bars */}
      {stories.length > 1 && (
        <View 
          className="absolute top-0 left-0 right-0 z-20 flex-row gap-1 px-2 pt-safe"
          style={{ paddingTop: insets.top + 8 }}
        >
          {stories.map((story, index) => (
            <View
              key={story.id}
              className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden"
            >
              <View
                className="h-full bg-white rounded-full"
                style={{
                  width: index < currentStoryIndex 
                    ? '100%' 
                    : index === currentStoryIndex 
                      ? `${progress}%` 
                      : '0%',
                }}
              />
            </View>
          ))}
        </View>
      )}

      {/* Header */}
      <View 
        className="absolute top-0 left-0 right-0 z-10 flex-row items-center justify-between px-4"
        style={{ paddingTop: insets.top + (stories.length > 1 ? 40 : 12) }}
      >
        <View className="flex-row items-center gap-3 flex-1">
          <Avatar
            imageUrl={storyOwnerImage}
            size={32}
            fontSize={14}
            name={storyOwnerName}
          />
          <View className="flex-1">
            <Text className="text-white font-semibold text-base">
              {storyOwnerName}
            </Text>
            <Text className="text-white/70 text-xs">
              {formatTime(currentStory.createdAt)}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.dismiss())}
          className="w-8 h-8 items-center justify-center"
        >
          <Feather name="x" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Story Content */}
      <Pressable 
        className="flex-1 items-center justify-center bg-black"
        onPress={handleTap}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {currentStory.mediaType === 'image' ? (
          <Image
            source={{ uri: currentStory.mediaUrl }}
            style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
            resizeMode="contain"
          />
        ) : videoUri && player ? (
          <VideoView
            player={player}
            style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
            contentFit="contain"
            nativeControls={false}
          />
        ) : (
          <ActivityIndicator size="large" color="white" />
        )}
      </Pressable>

      {/* Bottom Actions */}
      <View 
        className="absolute bottom-0 left-0 right-0 z-20 flex-row items-center justify-center gap-6 px-4 py-6"
        style={{ paddingBottom: insets.bottom + 24 }}
        pointerEvents="box-none"
      >
        <TouchableOpacity 
          className="items-center"
          onPress={handleLike}
          onPressIn={(e) => e.stopPropagation()}
        >
          <View className={`w-14 h-14 ${isLiked ? 'bg-red-500/80' : 'bg-white/20'} rounded-full items-center justify-center`}>
            <Feather 
              name="heart" 
              size={24} 
              color="white"
              fill={isLiked ? "white" : "none"}
            />
          </View>
          <Text className="text-white/70 text-xs mt-2">{t('stories.like')}</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          className="items-center"
          onPress={() => setShowReplyModal(true)}
          onPressIn={(e) => e.stopPropagation()}
        >
          <View className="w-14 h-14 bg-white/20 rounded-full items-center justify-center">
            <Feather name="message-circle" size={24} color="white" />
          </View>
          <Text className="text-white/70 text-xs mt-2">{t('stories.reply')}</Text>
        </TouchableOpacity>
      </View>

      {/* Reply Modal */}
      <Modal
        visible={showReplyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReplyModal(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 items-center justify-end"
          onPress={() => setShowReplyModal(false)}
        >
          <Pressable
            className="w-full bg-white rounded-t-3xl p-6 pb-safe"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 24 }}
          >
            <View className="items-center mb-4">
              <View className="w-12 h-1 bg-gray-300 rounded-full mb-4" />
              <Text className="text-xl font-semibold">{t('stories.reply')}</Text>
              <Text className="text-sm text-gray-500 mt-1">
                {t('stories.replyTo')} {storyOwnerName}
              </Text>
            </View>

            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder={t('stories.typeReply')}
              multiline
              numberOfLines={4}
              className="border border-gray-300 rounded-xl p-4 min-h-[100px] text-base"
              textAlignVertical="top"
            />

            <View className="flex-row gap-3 mt-4">
              <Button
                variant="plain"
                className="flex-1 bg-gray-100 rounded-xl py-3"
                onPress={() => {
                  setShowReplyModal(false);
                  setReplyText('');
                }}
              >
                <Text className="font-semibold text-gray-700">{t('common.cancel')}</Text>
              </Button>
              <Button
                variant="plain"
                className="flex-1 bg-[#FF5722] rounded-xl py-3"
                onPress={handleReply}
                disabled={loading || !replyText.trim()}
              >
                <Text className="font-semibold text-white">
                  {loading ? t('common.loading') : t('stories.send')}
                </Text>
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

export default StoryViewer;
