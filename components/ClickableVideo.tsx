import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useState } from 'react';
import { Dimensions, Image, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_VIDEO_WIDTH = Math.min(SCREEN_WIDTH * 0.8, 320);
const MAX_VIDEO_HEIGHT = 450;

const ClickableVideo = (props: any) => {
  const { message } = useMessageContext();
  const insets = useSafeAreaInsets();
  const [showFullScreen, setShowFullScreen] = useState(false);
  
  // Get video attachment from message
  const attachment = message?.attachments?.[0];
  const isVideo = attachment?.type === 'video' || attachment?.mime_type?.startsWith('video/');
  
  // Get video URL
  const videoUrl = attachment?.asset_url || 
                   attachment?.video_url ||
                   attachment?.url ||
                   props.source?.uri || 
                   (typeof props.source === 'string' ? props.source : null) ||
                   '';
  
  // Get thumbnail for preview
  const thumbUrl = attachment?.thumb_url || 
                   attachment?.image_url ||
                   props.thumb_url ||
                   '';

  // Get dimensions
  const videoWidth = attachment?.original_width || attachment?.width || MAX_VIDEO_WIDTH;
  const videoHeight = attachment?.original_height || attachment?.height || MAX_VIDEO_HEIGHT;

  // Calculate display dimensions
  const aspectRatio = videoWidth && videoHeight ? videoWidth / videoHeight : 16 / 9;
  let displayWidth = videoWidth || MAX_VIDEO_WIDTH;
  let displayHeight = videoHeight || MAX_VIDEO_HEIGHT;
  
  if (displayWidth > MAX_VIDEO_WIDTH) {
    displayWidth = MAX_VIDEO_WIDTH;
    displayHeight = displayWidth / aspectRatio;
  }
  if (displayHeight > MAX_VIDEO_HEIGHT) {
    displayHeight = MAX_VIDEO_HEIGHT;
    displayWidth = displayHeight * aspectRatio;
  }

  // Create video player - always use a valid URL string
  // Use placeholder if no valid video URL to prevent "Invalid URL" errors
  const placeholderUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  const safeVideoUrl = (isVideo && videoUrl && typeof videoUrl === 'string' && videoUrl.trim() !== '') 
    ? videoUrl.trim() 
    : placeholderUrl;
  
  const player = useVideoPlayer(safeVideoUrl, (player) => {
    if (isVideo && videoUrl && typeof videoUrl === 'string' && videoUrl.trim() !== '') {
      player.loop = false;
      player.muted = false;
    } else {
      player.pause();
    }
  });

  if (!isVideo || !videoUrl) {
    // If not a video, render as image (fallback)
    return <Image {...props} />;
  }

  const handlePress = () => {
    setShowFullScreen(true);
    if (player) {
      player.play();
    }
  };

  const handleClose = () => {
    setShowFullScreen(false);
    if (player) {
      player.pause();
      player.currentTime = 0;
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        onPress={handlePress} 
        activeOpacity={0.8}
        style={[styles.videoWrapper, { width: displayWidth, height: displayHeight }]}
      >
        {thumbUrl ? (
          <Image 
            source={{ uri: thumbUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.placeholder]} />
        )}
        <View style={styles.playButtonOverlay}>
          <View style={styles.playButton}>
            <Feather name="play" size={32} color="white" />
          </View>
        </View>
      </TouchableOpacity>

      {/* Full Screen Video Modal */}
      <Modal
        visible={showFullScreen}
        transparent
        animationType="fade"
        onRequestClose={handleClose}
        statusBarTranslucent
      >
        <View style={styles.fullScreenContainer}>
          {/* Header */}
          <View
            style={[
              styles.header,
              { paddingTop: insets.top + 16, paddingBottom: 16 }
            ]}
          >
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              activeOpacity={0.7}
            >
              <Feather name="x" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Video Player */}
          <Pressable
            style={styles.videoContainer}
            onPress={() => {
              if (player?.playing) {
                player.pause();
              } else {
                player?.play();
              }
            }}
          >
            <VideoView
              player={player}
              style={styles.videoPlayer}
              contentFit="contain"
              nativeControls
              allowsFullscreen
            />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 4,
    marginVertical: 2,
  },
  videoWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignSelf: 'center',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: '#1a1a1a',
  },
  playButtonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  videoContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
});

export default ClickableVideo;

