import { getRandomBytesAsync } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, View } from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import TextField from '@/components/TextField';
import UserCheckbox from '@/components/UserCheckbox';
import { useAuth } from '@/contexts/AuthContext';
import { useUsers } from '@/lib/hooks/useUsers';
import { createGroupChat } from '@/lib/services/chatService';
import { User } from '@/lib/types/chat';

const NewGroupScreen = () => {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const { users: allUsers, loading: loadingUsers } = useUsers(query);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  // Filter out current user and filter by search query
  const users = useMemo(() => {
    return allUsers
      .filter(u => u.uid !== currentUser?.uid)
      .filter(u => {
        if (!query.trim()) return true;
        const searchLower = query.toLowerCase();
        return (
          u.username?.toLowerCase().includes(searchLower) ||
          u.firstName?.toLowerCase().includes(searchLower) ||
          u.lastName?.toLowerCase().includes(searchLower) ||
          `${u.firstName} ${u.lastName}`.toLowerCase().includes(searchLower)
        );
      });
  }, [allUsers, currentUser?.uid, query]);

  const leave = () => {
    setCreatingGroup(false);
    setGroupName('');
    setGroupDescription('');
    setQuery('');
    setSelectedUsers([]);
    router.dismissTo('/chats');
  };

  const createNewGroup = async () => {
    if (!groupName.trim()) {
      alert(t('groups.enterGroupName'));
      return;
    }
    if (selectedUsers.length === 0) {
      alert(t('groups.selectAtLeastOne'));
      return;
    }
    if (!currentUser) return;

    setCreatingGroup(true);

    try {
      const chatId = await createGroupChat(currentUser.uid, groupName.trim(), selectedUsers, {
        description: groupDescription.trim() || undefined,
      });

      // Navigate to the new group chat
      router.dismissTo({
        pathname: '/chat/[id]',
        params: { id: chatId },
      });
    } catch (error) {
      console.error('Error creating group:', error);
      alert(t('groups.errorCreating'));
    } finally {
      setCreatingGroup(false);
    }
  };

  const onSelectUser = useCallback((userId: string, value: boolean) => {
    setSelectedUsers((prevSelectedUsers) => {
      if (value) {
        return [...prevSelectedUsers, userId];
      } else {
        return prevSelectedUsers.filter((id) => id !== userId);
      }
    });
  }, []);

  const sortedUsers = useMemo(
    () =>
      users.sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastName}`;
        const nameB = `${b.firstName} ${b.lastName}`;
        return nameA.localeCompare(nameB);
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
        id="groupDescription"
        label={t('groups.groupDescription')}
        placeholder={t('groups.groupDescriptionPlaceholder')}
        value={groupDescription}
        onChangeText={setGroupDescription}
        multiline
      />
      <TextField
        id="users"
        label={t('groups.addMembers')}
        placeholder={t('groups.addMembersPlaceholder')}
        value={query}
        onChangeText={(value) => setQuery(value)}
        autoCapitalize="none"
      />
      {loadingUsers && (
        <View className="flex items-center justify-center py-4">
          <Spinner />
        </View>
      )}
      {!loadingUsers && sortedUsers.length > 0 && (
        <FlatList
          data={sortedUsers}
          keyExtractor={(item) => item.uid}
          className="flex-1 mt-2"
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          removeClippedSubviews={true}
          initialNumToRender={10}
          maxToRenderPerBatch={5}
          windowSize={5}
          renderItem={({ item: user }) => (
            <UserCheckbox
              user={{
                id: user.uid,
                name: `${user.firstName} ${user.lastName}`,
                username: user.username,
                image: user.avatar,
              } as any}
              checked={selectedUsers.includes(user.uid)}
              onValueChange={(value) => onSelectUser(user.uid, value)}
            />
          )}
        />
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
