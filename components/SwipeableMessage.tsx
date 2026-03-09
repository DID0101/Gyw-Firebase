import React, { useRef, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  runOnJS,
  interpolate,
  Extrapolation,
  cancelAnimation
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { ChatMessage } from '@/lib/types/chat';
import { useTheme } from '@/contexts/ThemeContext';
import * as Haptics from 'expo-haptics';

const SWIPE_THRESHOLD = 80;
const ACTIVE_OFFSET_X = -10; // Start recognizing horizontal swipe after 10px
const FAIL_OFFSET_Y = 10; // Cancel if vertical movement exceeds 10px

interface SwipeableMessageProps {
  message: ChatMessage;
  isMyMessage: boolean;
  onSwipeToReply: (message: ChatMessage) => void;
  onLongPress: (message: ChatMessage) => void;
  onReplyPress?: (messageId: string) => void;
  children: React.ReactNode;
}

export const SwipeableMessage: React.FC<SwipeableMessageProps> = memo(({
  message,
  isMyMessage,
  onSwipeToReply,
  onLongPress,
  onReplyPress,
  children,
}) => {
  const translateX = useSharedValue(0);
  const isActive = useSharedValue(false);
  const { isDark } = useTheme();

  const triggerReply = () => {
    onSwipeToReply(message);
  };

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // Pan gesture with proper priority handling
  const panGesture = Gesture.Pan()
    .activeOffsetX(ACTIVE_OFFSET_X) // Only activate after horizontal movement
    .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y]) // Cancel if vertical movement is too much
    .onStart(() => {
      cancelAnimation(translateX);
      isActive.value = true;
    })
    .onUpdate((e) => {
      // Only allow left swipe (negative translationX)
      // Check if horizontal movement is dominant (1.5x threshold)
      const absX = Math.abs(e.translationX);
      const absY = Math.abs(e.translationY);
      
      if (e.translationX < 0 && absX > absY * 1.5) {
        // Horizontal swipe is dominant - allow it
        translateX.value = Math.max(e.translationX, -SWIPE_THRESHOLD);
      } else if (absY > absX) {
        // Vertical movement is dominant - cancel swipe
        translateX.value = withSpring(0, {
          damping: 20,
          stiffness: 300,
        });
        isActive.value = false;
      }
    })
    .onEnd((e) => {
      isActive.value = false;
      
      if (e.translationX < -SWIPE_THRESHOLD / 2 && Math.abs(e.translationX) > Math.abs(e.translationY) * 1.5) {
        // Swipe threshold reached - trigger reply with haptic feedback
        runOnJS(triggerHaptic)();
        translateX.value = withSpring(-SWIPE_THRESHOLD, {
          damping: 15,
          stiffness: 150,
        }, () => {
          translateX.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
          });
        });
        runOnJS(triggerReply)();
      } else {
        // Snap back smoothly (covers both incomplete swipes and cancelled gestures)
        translateX.value = withSpring(0, {
          damping: 20,
          stiffness: 300,
        });
      }
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(400)
    .onStart(() => {
      runOnJS(onLongPress)(message);
    });

  const composedGesture = Gesture.Simultaneous(panGesture, longPressGesture);

  const messageAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  const replyIconAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [1, 0],
      Extrapolation.CLAMP
    );
    const iconTranslateX = interpolate(
      translateX.value,
      [-SWIPE_THRESHOLD, 0],
      [0, SWIPE_THRESHOLD],
      Extrapolation.CLAMP
    );
    return {
      opacity,
      transform: [{ translateX: iconTranslateX }],
    };
  });

  return (
    <GestureDetector gesture={composedGesture}>
      <View style={styles.container}>
        {/* Reply Icon (shown when swiping) */}
        <Animated.View
          style={[
            styles.replyIconContainer,
            replyIconAnimatedStyle,
          ]}
        >
          <Feather name="corner-up-left" size={20} color={isDark ? '#9CA3AF' : '#6B7280'} />
        </Animated.View>

        {/* Message Content */}
        <Animated.View style={[styles.messageContainer, messageAnimatedStyle]}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}, (prevProps, nextProps) => {
  // Return true if props are equal (skip re-render), false if different (re-render)
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.text === nextProps.message.text &&
    prevProps.message.status === nextProps.message.status &&
    JSON.stringify(prevProps.message.reactions) === JSON.stringify(nextProps.message.reactions) &&
    prevProps.isMyMessage === nextProps.isMyMessage
    // Note: children comparison is complex, so we allow re-render if children change
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    width: '100%',
  },
  replyIconContainer: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageContainer: {
    width: '100%',
  },
});

export default SwipeableMessage;
