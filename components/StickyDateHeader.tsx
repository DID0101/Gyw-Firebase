import { memo } from 'react';
import { Text, View } from 'react-native';
import clsx from 'clsx';

interface StickyDateHeaderProps {
  label: string;
  isDark: boolean;
  onPress?: () => void;
}

const StickyDateHeader = memo<StickyDateHeaderProps>(({ label, isDark, onPress }) => {
  return (
    <View
      className="items-center py-2"
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`Date: ${label}`}
    >
      <View
        className={clsx(
          'px-3 py-1.5 rounded-full',
          isDark ? 'bg-gray-800/95' : 'bg-gray-100/95'
        )}
      >
        <Text
          className={clsx(
            'text-xs font-medium',
            isDark ? 'text-gray-300' : 'text-gray-600'
          )}
        >
          {label}
        </Text>
      </View>
    </View>
  );
});

StickyDateHeader.displayName = 'StickyDateHeader';
export default StickyDateHeader;
