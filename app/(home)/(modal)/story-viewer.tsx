import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
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
import { BlockedPeerSendError } from '@/lib/chatSendGuards';
import {
  getStory,
  getUserStories,
  viewStory,
  toggleLikeStory,
  subscribeStoryLikeState,
  subscribeStoryLikesSheet,
  subscribeStoryViewsSheet,
  type StoryLikeRow,
  type StoryViewRow,
  type Story,
} from '@/lib/services/storyService';
import { getOrCreateDirectChat, sendMessage } from '@/lib/services/chatService';
import { useUsersData } from '@/lib/hooks/useUsersData';
import { useStoryStore } from '@/store/storyStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5 seconds for images

const StoryViewSheetRow = memo(function StoryViewSheetRow({
  item,
  formatRel,
}: {
  item: StoryViewRow;
  formatRel: (timestamp: string) => string;
}) {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
      <Avatar imageUrl={item.avatarUrl} size={44} fontSize={14} name={item.username || item.viewerId} />
      <View className="ml-3 flex-1 min-w-0">
        <Text className="font-semibold text-base text-gray-900" numberOfLines={1}>
          {item.username || item.viewerId}
        </Text>
        <Text className="text-gray-500 text-xs mt-0.5" numberOfLines={1}>
          {item.viewedAt ? formatRel(item.viewedAt) : ''}
        </Text>
      </View>
    </View>
  );
});

const StoryLikeSheetRow = memo(function StoryLikeSheetRow({
  item,
  formatRel,
}: {
  item: StoryLikeRow;
  formatRel: (timestamp: string) => string;
}) {
  return (
    <View className="flex-row items-center px-4 py-3 border-b border-gray-100">
      <Avatar imageUrl={item.avatarUrl} size={44} fontSize={14} name={item.username || item.userId} />
      <View className="ml-3 flex-1 min-w-0">
        <Text className="font-semibold text-base text-gray-900" numberOfLines={1}>
          {item.username || item.userId}
        </Text>
        <Text className="text-gray-500 text-xs mt-0.5" numberOfLines={1}>
          {item.createdAt ? formatRel(item.createdAt) : ''}
        </Text>
      </View>
    </View>
  );
});

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
  const [likeState, setLikeState] = useState({ liked: false, likeCount: 0, capped: false });
  const [likeOptimistic, setLikeOptimistic] = useState<boolean | null>(null);
  const [viewerRows, setViewerRows] = useState<StoryViewRow[]>([]);
  const [likerRows, setLikerRows] = useState<StoryLikeRow[]>([]);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [engagementTab, setEngagementTab] = useState<'views' | 'likes'>('views');
  const viewedSessionRef = useRef<Set<string>>(new Set());
  const likeScale = useRef(new Animated.Value(1)).current;
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

  const activeStoryIdRef = useRef<string | null>(null);
  activeStoryIdRef.current = currentStory?.id ?? null;

  // Debounced view record (subcollection); skip repeat in same session to limit writes while rewatching.
  useEffect(() => {
    if (!currentStory?.id || !user?.uid) return;
    if (currentStory.userId === user.uid) return;
    const sid = currentStory.id;
    const viewTimer = setTimeout(() => {
      if (activeStoryIdRef.current !== sid) return;
      if (viewedSessionRef.current.has(sid)) return;
      useStoryStore.getState().markStoryViewed(sid, user.uid);
      void viewStory(sid, user.uid)
        .then(() => {
          viewedSessionRef.current.add(sid);
        })
        .catch((err) => {
          useStoryStore.getState().unmarkStoryViewed(sid, user.uid);
          if (__DEV__) console.warn('[StoryViewer] viewStory failed:', err);
        });
    }, 500);
    return () => clearTimeout(viewTimer);
  }, [currentStory?.id, currentStory?.userId, user?.uid]);

  useEffect(() => {
    setLikeOptimistic(null);
  }, [currentStory?.id]);

  // Realtime likes (subcollection; capped count for scale).
  useEffect(() => {
    if (!currentStory?.id || !user?.uid) return;
    const unsub = subscribeStoryLikeState(
      currentStory.id,
      user.uid,
      (s) => setLikeState(s),
      () => {}
    );
    return unsub;
  }, [currentStory?.id, user?.uid]);

  // Seed like from legacy story doc until first snapshot.
  useEffect(() => {
    if (!currentStory || !user?.uid) return;
    const legacy = currentStory.likes?.includes(user.uid);
    if (legacy) {
      setLikeState((prev) => ({ ...prev, liked: true }));
    }
  }, [currentStory?.id, currentStory?.likes, user?.uid]);

  // Owner: live viewer + liker lists for bottom sheet (newest first, capped page size).
  const isStoryOwner = !!(user?.uid && currentStory?.userId && user.uid === currentStory.userId);
  useEffect(() => {
    if (!currentStory?.id || !isStoryOwner) {
      setViewerRows([]);
      setLikerRows([]);
      return;
    }
    const unsubViews = subscribeStoryViewsSheet(
      currentStory.id,
      (rows) => setViewerRows(rows),
      () => {},
      72
    );
    const unsubLikes = subscribeStoryLikesSheet(
      currentStory.id,
      (rows) => setLikerRows(rows),
      () => {},
      72
    );
    return () => {
      unsubViews();
      unsubLikes();
    };
  }, [currentStory?.id, isStoryOwner]);

  const narrativePaused = useMemo(
    () => paused || showReplyModal || engagementOpen,
    [paused, showReplyModal, engagementOpen]
  );

  const isOwnerRef = useRef(false);
  isOwnerRef.current = isStoryOwner;
  const ownerSwipePan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          isOwnerRef.current && g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx) + 6,
        onPanResponderRelease: (_e, g) => {
          if (isOwnerRef.current && g.dy < -52) {
            setEngagementTab('views');
            setEngagementOpen(true);
          }
        },
      }),
    []
  );

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
                if (!narrativePaused) {
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
        if (!narrativePaused) {
          player.play();
        } else {
          player.pause();
        }
      } catch (error) {
        // Ignore errors
      }
    }
  }, [videoUri, narrativePaused, player, placeholderVideoUrl]);

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
    if (currentStory?.mediaType === 'image' && !narrativePaused) {
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
  }, [currentStory, narrativePaused, handleNextStory]);

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

  const displayLiked = likeOptimistic ?? likeState.liked;

  const pulseLike = useCallback(() => {
    Animated.sequence([
      Animated.timing(likeScale, { toValue: 1.18, duration: 90, useNativeDriver: true }),
      Animated.spring(likeScale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, [likeScale]);

  const handleLike = async () => {
    if (!currentStory || !user?.uid) return;

    const prevLiked = displayLiked;
    const prevCount = likeState.likeCount;
    const prevCapped = likeState.capped;
    pulseLike();
    setLikeOptimistic(!prevLiked);
    setLikeState((s) => ({
      ...s,
      likeCount: Math.max(0, s.likeCount + (prevLiked ? -1 : 1)),
      liked: !prevLiked,
    }));

    try {
      await toggleLikeStory(currentStory.id, user.uid);
      setLikeOptimistic(null);
    } catch (error) {
      setLikeOptimistic(null);
      setLikeState((s) => ({ ...s, liked: prevLiked, likeCount: prevCount, capped: prevCapped }));
      Alert.alert(t('common.error'), t('stories.failedToLike'));
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !currentStory || !user?.uid) return;

    const previewLabel =
      currentStory.caption?.trim() ||
      (currentStory.mediaType === 'video' ? t('messages.video') : t('messages.photo'));

    setLoading(true);
    try {
      const chatId = await getOrCreateDirectChat(user.uid, currentStory.userId);

      await sendMessage(
        chatId,
        user.uid,
        user.displayName || user.phoneNumber || 'User',
        user.photoURL ?? undefined,
        replyText.trim(),
        undefined,
        {
          recipientUserIds: [currentStory.userId],
          storyReply: {
            storyId: currentStory.id,
            storyOwnerId: currentStory.userId,
            previewLabel,
            mediaUrl: currentStory.mediaUrl,
            thumbnailUrl: currentStory.thumbnailUrl,
            mediaType: currentStory.mediaType,
          },
        }
      );

      setShowReplyModal(false);
      setReplyText('');
      Alert.alert(t('common.success'), t('stories.replySent'));
    } catch (error) {
      if (error instanceof BlockedPeerSendError) {
        Alert.alert(t('common.error'), t('messages.blockedCannotSend'));
        return;
      }
      console.error('Error sending reply:', error);
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
    if (showReplyModal || engagementOpen) return;
    setPaused(false);
    if (player && currentStory?.mediaType === 'video') {
      player.play();
    }
  }, [player, currentStory, showReplyModal, engagementOpen]);

  const formatTime = useCallback(
    (timestamp: string) => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 1) {
        return t('stories.justNow');
      }
      if (diffMinutes < 60) {
        return `${diffMinutes} ${t('stories.minutesAgo')}`;
      }
      if (diffHours < 24) {
        return `${diffHours} ${t('stories.hoursAgo')}`;
      }
      return `${Math.floor(diffHours / 24)} ${t('stories.daysAgo')}`;
    },
    [t]
  );

  const renderViewerSheetItem = useCallback(
    ({ item }: { item: StoryViewRow }) => <StoryViewSheetRow item={item} formatRel={formatTime} />,
    [formatTime]
  );

  const renderLikerSheetItem = useCallback(
    ({ item }: { item: StoryLikeRow }) => <StoryLikeSheetRow item={item} formatRel={formatTime} />,
    [formatTime]
  );

  const viewCountLabel = useMemo(() => {
    if (viewerRows.length >= 72) return '72+';
    return String(viewerRows.length);
  }, [viewerRows.length]);

  const likeCountLabel = useMemo(() => {
    if (likeState.capped || likeState.likeCount >= 400) return '400+';
    return String(likeState.likeCount);
  }, [likeState.capped, likeState.likeCount]);

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
        <View className="flex-row items-center gap-3 flex-1 min-w-0">
          <Avatar
            imageUrl={storyOwnerImage}
            size={32}
            fontSize={14}
            name={storyOwnerName}
          />
          <View className="flex-1 min-w-0">
            <Text className="text-white font-semibold text-base" numberOfLines={1}>
              {storyOwnerName}
            </Text>
            <Text className="text-white/70 text-xs" numberOfLines={1}>
              {formatTime(currentStory.createdAt)}
            </Text>
            {isStoryOwner && (
              <>
                <View className="flex-row flex-wrap gap-x-3 gap-y-1 mt-1">
                  <TouchableOpacity
                    onPress={() => {
                      setEngagementTab('views');
                      setEngagementOpen(true);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text className="text-white/90 text-xs font-medium">
                      {t('stories.viewsCount', { count: viewCountLabel })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setEngagementTab('likes');
                      setEngagementOpen(true);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text className="text-white/90 text-xs font-medium">
                      {t('stories.likesCount', { count: likeCountLabel })}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text className="text-white/50 text-[10px] mt-0.5" numberOfLines={1}>
                  {t('stories.swipeUpForActivity')}
                </Text>
              </>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.dismiss())}
          className="w-8 h-8 items-center justify-center shrink-0"
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
        {...(isStoryOwner ? ownerSwipePan.panHandlers : {})}
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
          className="items-center max-w-[88px]"
          onPress={handleLike}
          onPressIn={(e) => e.stopPropagation()}
        >
          <Animated.View style={{ transform: [{ scale: likeScale }] }}>
            <View
              className={`w-14 h-14 ${displayLiked ? 'bg-red-500/80' : 'bg-white/20'} rounded-full items-center justify-center`}
            >
              <Feather name="heart" size={24} color="white" fill={displayLiked ? 'white' : 'none'} />
            </View>
          </Animated.View>
          <Text className="text-white/70 text-xs mt-1 text-center" numberOfLines={1}>
            {likeState.capped ? `${likeState.likeCount}+` : likeState.likeCount}
          </Text>
          <Text className="text-white/50 text-[10px] mt-0.5 text-center" numberOfLines={2}>
            {t('stories.like')}
          </Text>
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

      {/* Owner: viewers + likers (bottom sheet) */}
      <Modal
        visible={engagementOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEngagementOpen(false)}
      >
        <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setEngagementOpen(false)}>
          <Pressable
            className="bg-white rounded-t-3xl max-h-[70%]"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <View className="items-center pt-3 pb-2">
              <View className="w-12 h-1 bg-gray-300 rounded-full mb-2" />
              <Text className="text-lg font-semibold text-gray-900">{t('stories.activity')}</Text>
            </View>
            <View className="flex-row border-b border-gray-200 px-2">
              <TouchableOpacity
                className={`flex-1 py-3 items-center border-b-2 ${engagementTab === 'views' ? 'border-[#FF5722]' : 'border-transparent'}`}
                onPress={() => setEngagementTab('views')}
              >
                <Text className={`font-semibold ${engagementTab === 'views' ? 'text-[#FF5722]' : 'text-gray-500'}`}>
                  {t('stories.viewers')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 py-3 items-center border-b-2 ${engagementTab === 'likes' ? 'border-[#FF5722]' : 'border-transparent'}`}
                onPress={() => setEngagementTab('likes')}
              >
                <Text className={`font-semibold ${engagementTab === 'likes' ? 'text-[#FF5722]' : 'text-gray-500'}`}>
                  {t('stories.likesTitle')}
                </Text>
              </TouchableOpacity>
            </View>
            {engagementTab === 'views' ? (
              <FlatList
                data={viewerRows}
                keyExtractor={(item) => item.viewerId}
                renderItem={renderViewerSheetItem}
                ListEmptyComponent={
                  <Text className="text-center text-gray-500 py-8 px-4">{t('stories.noViewersYet')}</Text>
                }
                initialNumToRender={10}
                maxToRenderPerBatch={12}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
              />
            ) : (
              <FlatList
                data={likerRows}
                keyExtractor={(item) => item.userId}
                renderItem={renderLikerSheetItem}
                ListEmptyComponent={
                  <Text className="text-center text-gray-500 py-8 px-4">{t('stories.noLikesYet')}</Text>
                }
                ListFooterComponent={
                  likeState.capped ? (
                    <Text className="text-center text-gray-400 text-xs px-4 pb-4">{t('stories.likesCapHint')}</Text>
                  ) : null
                }
                initialNumToRender={10}
                maxToRenderPerBatch={12}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reply Modal */}
      <Modal
        visible={showReplyModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReplyModal(false)}
      >
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

export default StoryViewer;
