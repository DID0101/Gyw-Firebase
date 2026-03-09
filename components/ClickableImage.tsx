import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { Dimensions, Image, ImageStyle, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ImageViewer from './ImageViewer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_IMAGE_WIDTH = Math.min(SCREEN_WIDTH * 0.8, 320);
const MAX_IMAGE_HEIGHT = 450;

const ClickableImage = (props: any) => {
  const { message } = useMessageContext();
  const insets = useSafeAreaInsets();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showFullScreenVideo, setShowFullScreenVideo] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  
  // Try to get dimensions from message attachment (Stream Chat format)
  const attachment = message?.attachments?.[0];
  const attachmentWidth = attachment?.original_width || attachment?.width || props.width;
  const attachmentHeight = attachment?.original_height || attachment?.height || props.height;

  // Check if this is a video attachment
  const isVideo = attachment?.type === 'video' || attachment?.mime_type?.startsWith('video/');
  
  // Get video URL if it's a video - ensure it's always a string
  const videoUrl = isVideo ? (
    attachment?.asset_url || 
    attachment?.video_url ||
    attachment?.url ||
    props.source?.uri || 
    (typeof props.source === 'string' ? props.source : null) ||
    ''
  ) : '';
  
  // Ensure videoUrl is always a string, never undefined
  const safeVideoUrlString = typeof videoUrl === 'string' ? videoUrl : '';

  // Get video thumbnail
  const videoThumbUrl = isVideo ? (
    attachment?.thumb_url || 
    attachment?.image_url ||
    props.thumb_url ||
    ''
  ) : '';

  // Determine if we have a valid video URL
  const hasValidVideoUrl = isVideo && safeVideoUrlString && safeVideoUrlString.trim() !== '';
  
  // Create video player - hooks must be called unconditionally
  // Always use a valid URL string to avoid "Invalid URL" errors
  const placeholderUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  // Ensure we always have a valid string URL
  const safeVideoUrl = hasValidVideoUrl 
    ? safeVideoUrlString.trim() 
    : placeholderUrl;
  
  // Ensure safeVideoUrl is always a valid non-empty string
  // Double-check to prevent any undefined values - this is critical to prevent "Invalid URL" errors
  const finalVideoUrl = (() => {
    const url = safeVideoUrl;
    if (url && typeof url === 'string' && url.trim() !== '') {
      return url.trim();
    }
    // Always return a valid URL string, never undefined or empty
    return placeholderUrl;
  })();
  
  // Hooks must be called unconditionally, so we always call useVideoPlayer
  // But we ensure it always receives a valid, non-empty string URL
  const videoPlayer = useVideoPlayer(finalVideoUrl, (player) => {
    if (player) {
      player.loop = false;
      player.muted = false;
      // Don't auto-play placeholder
      if (!hasValidVideoUrl) {
        player.pause();
      }
    }
  });

  // Update video player source when we have a valid video URL
  useEffect(() => {
    if (hasValidVideoUrl && safeVideoUrlString && videoPlayer) {
      const urlString = safeVideoUrlString.trim();
      if (urlString && urlString !== finalVideoUrl && urlString !== placeholderUrl && urlString !== '') {
        try {
          // Validate URL format before replacing
          if (urlString.startsWith('http://') || urlString.startsWith('https://') || urlString.startsWith('file://')) {
            videoPlayer.replace(urlString);
          }
        } catch (error) {
          console.warn('Error setting video URL:', error);
        }
      }
    }
  }, [hasValidVideoUrl, safeVideoUrlString, videoPlayer, finalVideoUrl, placeholderUrl]);

  // Extract image URL from various possible sources, prioritizing full resolution
  // Stream Chat attachments have: image_url (full), thumb_url (thumbnail), asset_url
  const fullImageUrl = attachment?.image_url || 
                       attachment?.asset_url ||
                       props.image_url || 
                       props.source?.uri || 
                       (typeof props.source === 'string' ? props.source : null) ||
                       '';
  
  const thumbImageUrl = attachment?.thumb_url || 
                       props.thumb_url || 
                       fullImageUrl;

  // If no image URL, render default
  if (!fullImageUrl && !thumbImageUrl) {
    return <Image {...props} />;
  }

  const handlePress = () => {
    if (hasValidVideoUrl && videoPlayer && safeVideoUrlString) {
      // Handle video press - open full screen video player
      // Ensure we're using the correct video URL
      const urlToUse = safeVideoUrlString.trim();
      if (urlToUse && urlToUse !== '' && urlToUse !== placeholderUrl) {
        // Validate URL format
        if (urlToUse.startsWith('http://') || urlToUse.startsWith('https://') || urlToUse.startsWith('file://')) {
          try {
            if (videoPlayer.source?.uri !== urlToUse) {
              videoPlayer.replace(urlToUse);
            }
          } catch (error) {
            console.warn('Error replacing video URL:', error);
          }
        }
      }
      setShowFullScreenVideo(true);
      if (videoPlayer) {
        videoPlayer.play();
      }
    } else {
      // Handle image press - open image viewer
      const imageToShow = fullImageUrl || thumbImageUrl;
      if (imageToShow) {
        setSelectedImage(imageToShow);
      }
    }
  };

  const handleCloseVideo = () => {
    setShowFullScreenVideo(false);
    if (videoPlayer) {
      videoPlayer.pause();
      videoPlayer.currentTime = 0;
    }
  };

  // Calculate image dimensions maintaining aspect ratio
  const getImageStyle = (): ImageStyle => {
    const baseStyle = props.style || {};
    
    // Priority 1: Use attachment dimensions from Stream Chat
    if (attachmentWidth && attachmentHeight) {
      const aspectRatio = attachmentWidth / attachmentHeight;
      let width = attachmentWidth;
      let height = attachmentHeight;
      
      // Scale down if too large
      if (width > MAX_IMAGE_WIDTH) {
        width = MAX_IMAGE_WIDTH;
        height = width / aspectRatio;
      }
      if (height > MAX_IMAGE_HEIGHT) {
        height = MAX_IMAGE_HEIGHT;
        width = height * aspectRatio;
      }
      
      return {
        ...baseStyle,
        width,
        height,
        borderRadius: 12,
      };
    }
    
    // Priority 2: Use explicit dimensions from props
    if (props.width && props.height) {
      const aspectRatio = props.width / props.height;
      let width = props.width;
      let height = props.height;
      
      // Scale down if too large
      if (width > MAX_IMAGE_WIDTH) {
        width = MAX_IMAGE_WIDTH;
        height = width / aspectRatio;
      }
      if (height > MAX_IMAGE_HEIGHT) {
        height = MAX_IMAGE_HEIGHT;
        width = height * aspectRatio;
      }
      
      return {
        ...baseStyle,
        width,
        height,
        borderRadius: 12,
      };
    }
    
    // Priority 3: Use calculated dimensions from image load
    if (imageDimensions) {
      const { width: imgWidth, height: imgHeight } = imageDimensions;
      const aspectRatio = imgWidth / imgHeight;
      let width = imgWidth;
      let height = imgHeight;
      
      // Scale down if too large
      if (width > MAX_IMAGE_WIDTH) {
        width = MAX_IMAGE_WIDTH;
        height = width / aspectRatio;
      }
      if (height > MAX_IMAGE_HEIGHT) {
        height = MAX_IMAGE_HEIGHT;
        width = height * aspectRatio;
      }
      
      return {
        ...baseStyle,
        width,
        height,
        borderRadius: 12,
      };
    }
    
    // Default fallback - use max width and maintain aspect ratio
    return {
      ...baseStyle,
      maxWidth: MAX_IMAGE_WIDTH,
      maxHeight: MAX_IMAGE_HEIGHT,
      width: MAX_IMAGE_WIDTH,
      aspectRatio: 1,
      borderRadius: 12,
    };
  };

  const handleImageLoad = (event: any) => {
    const { width, height } = event.nativeEvent.source;
    if (width && height && !imageDimensions) {
      setImageDimensions({ width, height });
    }
  };

  const imageStyle = getImageStyle();

  // Use thumbnail for display, full image for viewer
  const displayImageUrl = isVideo ? videoThumbUrl : (thumbImageUrl || fullImageUrl);

  // Make wrapper match image dimensions for proper click area
  const wrapperStyle = {
    ...styles.imageWrapper,
    width: imageStyle.width || 'auto',
    height: imageStyle.height || 'auto',
    minWidth: imageStyle.width || 100,
    minHeight: imageStyle.height || 100,
    alignSelf: 'center',
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        onPress={handlePress} 
        activeOpacity={0.8}
        style={wrapperStyle}
      >
        {isVideo ? (
          <>
            {videoThumbUrl ? (
              <Image 
                source={{ uri: videoThumbUrl }}
                style={imageStyle}
                resizeMode="cover"
              />
            ) : (
              <View style={[imageStyle, { backgroundColor: '#1a1a1a' }]} />
            )}
            <View style={styles.playButtonOverlay}>
              <View style={styles.playButton}>
                <Feather name="play" size={32} color="white" />
              </View>
            </View>
          </>
        ) : (
          <Image 
            {...props}
            source={displayImageUrl ? { uri: displayImageUrl } : props.source}
            style={imageStyle}
            onLoad={handleImageLoad}
            resizeMode="contain"
          />
        )}
      </TouchableOpacity>
      
      {/* Image Viewer Modal */}
      {selectedImage && !isVideo && (
        <ImageViewer
          visible={!!selectedImage}
          imageUri={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {/* Video Player Modal */}
      {hasValidVideoUrl && videoPlayer && (
        <Modal
          visible={showFullScreenVideo}
          transparent
          animationType="fade"
          onRequestClose={handleCloseVideo}
          statusBarTranslucent
        >
          <View style={styles.fullScreenContainer}>
            {/* Header */}
            <View
              style={[
                styles.videoHeader,
                { paddingTop: insets.top + 16, paddingBottom: 16 }
              ]}
            >
              <TouchableOpacity
                onPress={handleCloseVideo}
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
                if (videoPlayer?.playing) {
                  videoPlayer.pause();
                } else {
                  videoPlayer?.play();
                }
              }}
            >
              <VideoView
                player={videoPlayer}
                style={styles.videoPlayer}
                contentFit="contain"
                nativeControls
                allowsFullscreen
              />
            </Pressable>
          </View>
        </Modal>
      )}
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
  imageWrapper: {
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    alignSelf: 'center',
    position: 'relative',
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
  videoHeader: {
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

export default ClickableImage;

