import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { collection, query, where, getDocs } from 'firebase/firestore';

import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import TextField from '@/components/TextField';
import UserCard from '@/components/UserCard';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { getOrCreateDirectChat } from '@/lib/services/chatService';
import { User } from '@/lib/types/chat';

const FindByUsernameScreen = () => {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async (query: string) => {
    if (!query.trim()) {
      setFoundUser(null);
      return;
    }

    try {
      setLoading(true);
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', query.trim()));

      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        const user: User = {
          uid: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        } as User;

        if (user.uid !== currentUser?.uid) {
          setFoundUser(user);
        } else {
          setFoundUser(null);
        }
      } else {
        setFoundUser(null);
      }
    } catch (error: any) {
      console.error('Error searching user:', error);
      setFoundUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleUserSearch = async (text: string) => {
    setUsername(text);
    // Debounce search
    const timeoutId = setTimeout(() => {
      search(text);
    }, 500);
    return () => clearTimeout(timeoutId);
  };

  const onSelectUser = async (userId: string) => {
    if (!currentUser) return;
    
    try {
      const chatId = await getOrCreateDirectChat(currentUser.uid, userId);
      router.dismissTo({
        pathname: '/chat/[id]',
        params: { id: chatId },
      });
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  };

  return (
    <Screen viewClassName="flex-1 pt-1 px-2 sm:px-4 gap-4">
      <TextField
        id="username"
        placeholder={t('auth.username')}
        value={username}
        onChangeText={handleUserSearch}
        autoCapitalize="none"
      />
      {loading && (
        <View className="flex items-center justify-center py-4">
          <Spinner />
        </View>
      )}
      {!loading && foundUser && (
        <UserCard 
          user={{
            id: foundUser.uid,
            name: `${foundUser.firstName} ${foundUser.lastName}`,
            username: foundUser.username,
            image: foundUser.avatar,
          }}
          onPress={() => onSelectUser(foundUser.uid)} 
        />
      )}
    </Screen>
  );
};

export default FindByUsernameScreen;
