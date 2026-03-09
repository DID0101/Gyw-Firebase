import Avatar from './Avatar';

export interface PreviewAvatarProps {
  name: string;
  image?: string;
  size?: number;
  fontSize?: number;
}

const PreviewAvatar = ({
  name,
  image,
  size = 44,
  fontSize = 20,
}: PreviewAvatarProps) => {
  return (
    <Avatar
      size={size}
      name={name}
      fontSize={fontSize}
      imageUrl={image}
      placeholderType="text"
    />
  );
};

export default PreviewAvatar;
