import { getRandomBytesAsync } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { UserResponse } from 'stream-chat';
import { useChatContext } from 'stream-chat-expo';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import TextField from '@/components/TextField';
import UserCheckbox from '@/components/UserCheckbox';
import useContacts from '@/hooks/useContacts';

const NewGroupScreen = () => {
  const { client } = useChatContext();
  const router = useRouter();
  const { t } = useTranslation();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const { contacts, loadingContacts, debounceSearch } = useContacts(
    client,
    setUsers
  );

  const resetUsers = () => {
    setUsers(contacts);
  };

  const search = (query: string) => {
    const users = contacts.filter((user) => {
      // @ts-expect-error - name
      const name = user.name || `${user.first_name} ${user.last_name}`;
      return (
        user.username?.toLowerCase().includes(query.toLowerCase()) ||
        name.toLowerCase().includes(query.toLowerCase())
      );
    });
    setUsers(users);
  };

  const handleUserSearch = (text: string) => {
    setQuery(text);
    debounceSearch(text, resetUsers, search);
  };

  const leave = () => {
    setCreatingGroup(false);
    setGroupName('');
    setQuery('');
    setSelectedUsers([]);
    router.dismissTo('/chats');
  };

  const createNewGroup = async () => {
    if (!groupName) {
      alert(t('groups.enterGroupName'));
      return;
    }
    if (selectedUsers.length === 0) {
      alert(t('groups.selectAtLeastOne'));
      return;
    }

    setCreatingGroup(true);

    try {
      const bytes = await getRandomBytesAsync(7);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
      const id = Array.from(bytes)
        .map((b) => alphabet[b % alphabet.length])
        .join('');
      const group = client.channel('messaging', id, {
        members: [...selectedUsers, client.userID!],
        // @ts-expect-error - name
        name: groupName,
      });

      await group.create();
      leave();
    } catch (error) {
      console.error(error);
      alert(t('groups.errorCreating'));
    } finally {
      setCreatingGroup(false);
    }
  };

  const onSelectUser = (userId: string, value: boolean) => {
    setSelectedUsers((prevSelectedUsers) => {
      if (value) {
        return [...prevSelectedUsers, userId];
      } else {
        return prevSelectedUsers.filter((id) => id !== userId);
      }
    });
  };

  const sortedUsers = useMemo(
    () =>
      users.sort((a, b) => {
        const nameA = a.name;
        const nameB = b.name;
        return nameA?.localeCompare(nameB!)!;
      }),
    [users]
  );

  return (
    <Screen viewClassName="flex-1 pt-1 px-2 sm:px-4 gap-4">
      <TextField
        id="groupName"
        label={t('groups.groupName')}
        placeholder={t('groups.groupName')}
        value={groupName}
        onChangeText={(value) => setGroupName(value)}
      />
      <TextField
        id="users"
        label={t('groups.addMembers')}
        placeholder={t('groups.addMembersPlaceholder')}
        value={query}
        onChangeText={(value) => handleUserSearch(value)}
        autoCapitalize="none"
      />
      {loadingContacts && (
        <View className="flex items-center justify-center py-4">
          <Spinner />
        </View>
      )}
      {!loadingContacts && users.length > 0 && (
        <View className="flex flex-col gap-2 mt-2 flex-1">
          {sortedUsers.map((user) => (
            <UserCheckbox
              key={user.id}
              user={user}
              checked={selectedUsers.includes(user.id)}
              onValueChange={(value) => onSelectUser(user.id, value)}
            />
          ))}
        </View>
      )}
      <Button
        className="mt-auto flex-shrink-0"
        onPress={createNewGroup}
        disabled={creatingGroup}
      >
        {!creatingGroup && t('groups.createGroup')}
        {creatingGroup && <ActivityIndicator />}
      </Button>
    </Screen>
  );
};

export default NewGroupScreen;
