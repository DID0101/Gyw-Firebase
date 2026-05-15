import { Ionicons } from '@expo/vector-icons';
import type { ImageProps } from 'expo-image';
import { Text, TextStyle, View } from 'react-native';
import AppImage from './AppImage';

interface AvatarProps {
  name: string;
  imageUrl?: string;
  size?: number;
  fontSize?: TextStyle['fontSize'];
  fontWeight?: TextStyle['fontWeight'];
  placeholderType?: 'text' | 'icon';
  /** List rows: use `low` to prioritize visible chat bubbles over avatars. */
  imagePriority?: ImageProps['priority'];
}

const Avatar = ({
  imageUrl,
  size = 40,
  name,
  fontSize = 20,
  fontWeight = '500',
  placeholderType = 'text',
  imagePriority = 'normal',
}: AvatarProps) => {
  if (imageUrl)
    return (
      <View
        className="relative flex shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
      >
        <AppImage
          source={{ uri: imageUrl }}
          className="w-full h-full"
          alt="name"
          contentFit="cover"
          priority={imagePriority}
        />
      </View>
    );

  return (
    <View
      style={{
        width: size,
        height: size,
        backgroundColor: '#d8e8f0',
      }}
      className="shrink-0 rounded-full aspect-square flex flex-row items-center justify-center overflow-hidden"
    >
      {placeholderType === 'text' && (
        <Text
          style={{
            fontSize,
            fontWeight,
          }}
          className="leading-[2] text-[#086da0] uppercase"
        >
          {name ? name[0] : ''}
        </Text>
      )}
      {placeholderType === 'icon' && (
        <Ionicons name="people-outline" size={fontSize} color="#086da0" />
      )}
    </View>
  );
};

export default Avatar;
