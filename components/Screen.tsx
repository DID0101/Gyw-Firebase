import clsx from 'clsx';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemeClassName } from '@/lib/themeUtils';

interface ScreenProps {
  children: React.ReactNode;
  className?: string;
  viewClassName?: string;
  loadingOverlay?: boolean;
}

const Screen = ({
  children,
  className,
  viewClassName,
  loadingOverlay = false,
}: ScreenProps) => {
  const bgClassName = useThemeClassName('bg-white', 'bg-gray-900');
  const overlayClassName = useThemeClassName('bg-black/40', 'bg-black/60');
  
  return (
    <>
      <SafeAreaView className={clsx('flex-1 android:pt-3', bgClassName, className)}>
        <View className={clsx('flex-1', viewClassName)}>{children}</View>
      </SafeAreaView>
      {loadingOverlay && (
        <View className={clsx('absolute inset-0 items-center justify-center z-50', overlayClassName)}>
          <ActivityIndicator color="white" />
        </View>
      )}
    </>
  );
};

export default Screen;
