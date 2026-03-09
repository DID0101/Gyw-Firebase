import Checkbox from 'expo-checkbox';
import { memo } from 'react';
import { View } from 'react-native';

import UserCard from './UserCard';

interface User {
  id: string;
  name?: string;
  username?: string;
  image?: string;
}

interface UserCheckboxProps {
  user: User;
  checked: boolean;
  onValueChange: (value: boolean) => void;
}

const UserCheckbox = memo(({ user, checked, onValueChange }: UserCheckboxProps) => {
  return (
    <UserCard onPress={() => onValueChange(!checked)} user={user}>
      <View className="flex items-center ml-auto">
        <Checkbox
          id={user.id}
          value={checked}
          onValueChange={onValueChange}
          className="size-4 rounded border-2 border-color-borders-input"
        />
      </View>
    </UserCard>
  );
});

UserCheckbox.displayName = 'UserCheckbox';

export default UserCheckbox;
