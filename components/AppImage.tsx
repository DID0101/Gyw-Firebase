import { Image, ImageProps } from 'expo-image';
import { cssInterop } from 'nativewind';

cssInterop(Image, {
  className: {
    target: 'style',
  },
});

const AppImage = (props: ImageProps) => {
  const uri =
    typeof props.source === 'object' && props.source && 'uri' in props.source
      ? (props.source as { uri?: string }).uri
      : undefined;
  return (
    <Image
      {...props}
      cachePolicy={props.cachePolicy ?? 'memory-disk'}
      priority={props.priority ?? 'normal'}
      recyclingKey={props.recyclingKey ?? uri}
    />
  );
};

export default AppImage;
