import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { useTheme } from '@/contexts/ThemeContext';

type StoryViewerAdSkeletonProps = {
  width: number;
  height: number;
};

export default function StoryViewerAdSkeleton({
  width,
  height,
}: StoryViewerAdSkeletonProps) {
  const { colorScheme } = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.75,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const base = colorScheme === 'dark' ? '#2A2A2A' : '#E8E8E8';
  const highlight = colorScheme === 'dark' ? '#3A3A3A' : '#F4F4F4';

  return (
    <View style={{ width, height }} className="items-center justify-center px-6">
      <Animated.View
        style={{
          opacity: pulse,
          width: width * 0.88,
          height: height * 0.45,
          borderRadius: 16,
          backgroundColor: highlight,
          marginBottom: 24,
        }}
      />
      <Animated.View
        style={{
          opacity: pulse,
          width: width * 0.6,
          height: 18,
          borderRadius: 8,
          backgroundColor: base,
          marginBottom: 12,
        }}
      />
      <Animated.View
        style={{
          opacity: pulse,
          width: width * 0.75,
          height: 14,
          borderRadius: 8,
          backgroundColor: base,
          marginBottom: 28,
        }}
      />
      <Animated.View
        style={{
          opacity: pulse,
          width: width * 0.5,
          height: 44,
          borderRadius: 22,
          backgroundColor: highlight,
        }}
      />
    </View>
  );
}
