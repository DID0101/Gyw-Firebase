import clsx from 'clsx';
import { Text, TouchableOpacity } from 'react-native';

import { useThemeClassName } from '@/lib/themeUtils';

interface ButtonProps extends React.ComponentProps<typeof TouchableOpacity> {
  onPress?: () => void;
  children: React.ReactNode;
  className?: string;
  variant?: 'plain' | 'default' | 'text';
}

const Button = ({
  onPress,
  children,
  className,
  variant = 'default',
  ...otherProps
}: ButtonProps) => {
  const textColorClassName = useThemeClassName('text-black', 'text-white');
  const bgClassName = useThemeClassName('bg-[#337E84]', 'bg-[#337E84]');
  
  if (variant === 'plain')
    return (
      <TouchableOpacity
        className={clsx('w-fit h-fit', className)}
        onPress={onPress}
        activeOpacity={0.7}
        {...otherProps}
      >
        {children}
      </TouchableOpacity>
    );

  return (
    <TouchableOpacity
      className={clsx(
        variant === 'default' &&
          clsx('rounded-[13px] justify-center items-center px-4 py-4 w-full', bgClassName),
        variant === 'text' && clsx('bg-transparent justify-center items-center px-3 py-2', className),
        otherProps.disabled && 'opacity-50',
        variant !== 'text' && className
      )}
      onPress={onPress}
      activeOpacity={variant === 'text' ? 0.7 : undefined}
      {...otherProps}
    >
      <Text
        className={clsx(
          variant === 'default' && 'text-[17px] font-medium text-white',
          variant === 'text' && clsx('text-sm', textColorClassName)
        )}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
};

export default Button;
