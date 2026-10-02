import { Image, ImageProps } from 'expo-image';
import { memo } from 'react';
import { Platform } from 'react-native';
import { cssInterop } from 'nativewind';
import { isLowTierAndroid } from '@/lib/perf/deviceProfile';

cssInterop(Image, {
  className: {
    target: 'style',
  },
});

const AppImage = memo(function AppImage(props: ImageProps) {
  const uri =
    typeof props.source === 'object' && props.source && 'uri' in props.source
      ? (props.source as { uri?: string }).uri
      : undefined;
  const lowTierAndroid = Platform.OS === 'android' && isLowTierAndroid();
  const defaultPriority = lowTierAndroid ? 'low' : 'normal';
  const defaultCachePolicy = lowTierAndroid ? 'disk' : 'memory-disk';

  if (__DEV__ && uri) {
    try {
      const { recordImageRender } = require('@/lib/debug/networkAudit/ImageCacheProfiler') as typeof import('@/lib/debug/networkAudit/ImageCacheProfiler');
      recordImageRender(uri, props.priority ?? defaultPriority);
    } catch {
      /* audit optional */
    }
  }

  return (
    <Image
      {...props}
      cachePolicy={props.cachePolicy ?? defaultCachePolicy}
      priority={props.priority ?? defaultPriority}
      recyclingKey={props.recyclingKey ?? uri}
    />
  );
});

export default AppImage;
