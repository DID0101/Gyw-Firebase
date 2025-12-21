import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { UserResponse } from 'stream-chat';
import { useChatContext } from 'stream-chat-expo';

import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import TextField from '@/components/TextField';
import UserCard from '@/components/UserCard';
import useContacts from '@/hooks/useContacts';

const FindByUsernameScreen = () => {
  const { client } = useChatContext();
  const router = useRouter();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [user, setUser] = useState<UserResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const { debounceSearch } = useContacts(client, undefined, false);

  const resetUser = () => {
    setUser(null);
  };

  const search = async (query: string) => {
    try {
      setLoading(true);
      const { users } = await client.queryUsers({
        username: { $eq: query },
      });

      if (users.length > 0) {
        setUser(users[0]);
      }
    } catch (error: any) {
      console.error('Error fetching user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUserSearch = async (text: string) => {
    setUsername(text);
    debounceSearch(text, resetUser, search);
  };

  const onSelectUser = async (userId: string) => {
    const channel = client.getChannelByMembers('messaging', {
      members: [client.userID!, userId],
    });

    if (channel.id) {
      router.dismissTo({
        pathname: '/chat/[id]',
        params: { id: channel.id },
      });
    } else {
      await channel.create();
      router.dismissTo({
        pathname: '/chat/[id]',
        params: { id: channel.data?.id! },
      });
    }
  };

  return (
    <Screen viewClassName="flex-1 pt-1 px-2 sm:px-4 gap-4">
      <TextField
        id="username"
        placeholder={t('auth.username')}
        value={username}
        onChangeText={(value) => handleUserSearch(value)}
        autoCapitalize="none"
      />
      {loading && (
        <View className="flex items-center justify-center py-4">
          <Spinner />
        </View>
      )}
      {!loading && user && (
        <UserCard user={user} onPress={() => onSelectUser(user.id)} />
      )}
    </Screen>
  );
};

export default FindByUsernameScreen;
