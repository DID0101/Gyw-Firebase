import clsx from 'clsx';
import { useRef, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';

import { useThemeClassName } from '@/lib/themeUtils';

type TouchableOpacityPressEvent = Parameters<NonNullable<React.ComponentProps<typeof TouchableOpacity>['onPress']>>[0];
type TouchableOpacityProps = Omit<React.ComponentProps<typeof TouchableOpacity>, 'onPress'>;

interface ButtonProps extends TouchableOpacityProps {
  onPress?: (event: TouchableOpacityPressEvent) => void | Promise<void>;
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
  const bgClassName = useThemeClassName('bg-[#FF5722]', 'bg-[#FF5722]');
  const [pressPending, setPressPending] = useState(false);
  const pressLockedRef = useRef(false);
  const disabled = !!otherProps.disabled || pressPending;

  const handlePress = async (event: TouchableOpacityPressEvent) => {
    if (!onPress || pressLockedRef.current || otherProps.disabled) {
      if (__DEV__ && pressLockedRef.current) console.log('SAFE_ACTION_BLOCKED', { key: 'button_press' });
      return;
    }
    pressLockedRef.current = true;
    try {
      const result = onPress(event);
      if (result && typeof (result as Promise<void>).then === 'function') {
        setPressPending(true);
        await result;
      }
    } finally {
      setPressPending(false);
      setTimeout(() => {
        pressLockedRef.current = false;
      }, 450);
    }
  };
  
  if (variant === 'plain')
    return (
      <TouchableOpacity
        className={clsx('w-fit h-fit', className)}
        {...otherProps}
        onPress={handlePress}
        activeOpacity={0.7}
        disabled={disabled}
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
        disabled && 'opacity-50',
        variant !== 'text' && className
      )}
      {...otherProps}
      onPress={handlePress}
      activeOpacity={variant === 'text' ? 0.7 : undefined}
      disabled={disabled}
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
