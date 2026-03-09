import clsx from 'clsx';
import { memo } from 'react';
import { Text, View } from 'react-native';

import { useThemeClassName } from '@/lib/themeUtils';
import Avatar from './Avatar';
import Button from './Button';

interface User {
  id: string;
  name?: string;
  username?: string;
  image?: string;
  firstName?: string;
  lastName?: string;
}

interface UserCardProps {
  onPress?: () => void;
  user: User;
  children?: React.ReactNode;
}

const UserCard = memo(({ children, onPress, user }: UserCardProps) => {
  const name = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown';
  const textColor = useThemeClassName('text-black', 'text-white');
  const bgColor = useThemeClassName('bg-white', 'bg-gray-800');

  return (
    <Button
      variant="plain"
      onPress={onPress}
      className={clsx('flex-row items-center gap-2 py-3 px-4 rounded-xl', bgColor)}
    >
      <View className="h-10 w-10">
        <Avatar name={name} imageUrl={user?.image} size={40} />
      </View>
      <View>
        <Text className={clsx('text-base leading-5', textColor)}>{name}</Text>
        {user.username && (
          <Text className={clsx('text-sm text-gray-500 dark:text-gray-400')}>@{user.username}</Text>
        )}
      </View>
      {children}
    </Button>
  );
});

UserCard.displayName = 'UserCard';

export default UserCard;
