import type { ImageProps } from 'expo-image';
import { memo } from 'react';
import Avatar from './Avatar';

export interface PreviewAvatarProps {
  name: string;
  image?: string;
  size?: number;
  fontSize?: number;
  imagePriority?: ImageProps['priority'];
}

const PreviewAvatar = memo(function PreviewAvatar({
  name,
  image,
  size = 44,
  fontSize = 20,
  imagePriority = 'normal',
}: PreviewAvatarProps) {
  return (
    <Avatar
      size={size}
      name={name}
      fontSize={fontSize}
      imageUrl={image}
      placeholderType="text"
      imagePriority={imagePriority}
    />
  );
});

export default PreviewAvatar;
