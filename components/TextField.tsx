import clsx from 'clsx';
import { DimensionValue, Text, TextInput, View } from 'react-native';

interface TextFieldProps extends React.ComponentProps<typeof TextInput> {
  width?: DimensionValue;
  label?: string;
}

const TextField = ({
  label,
  width = '100%',
  className,
  ...otherProps
}: TextFieldProps) => {
  return (
    <View
      style={{ width }}
      className="relative px-4 flex-row bg-white dark:bg-gray-800 items-center justify-between rounded-xl py-3 android:py-0 border border-white dark:border-gray-700"
    >
      {label && (
        <View>
          <Text className="w-[108px] font-medium text-black dark:text-white">{label}</Text>
        </View>
      )}
      <TextInput
        className={clsx(
          'flex-1 placeholder:text-gray-400 dark:placeholder:text-gray-500 text-black dark:text-white',
          className
        )}
        placeholderTextColor={className?.includes('dark:') ? '#9CA3AF' : '#9CA3AF'}
        {...otherProps}
      />
    </View>
  );
};

export default TextField;
