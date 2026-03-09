import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { collection, query, where, getDocs } from 'firebase/firestore';

import Screen from '@/components/Screen';
import Spinner from '@/components/Spinner';
import TextField from '@/components/TextField';
import UserCard from '@/components/UserCard';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { getOrCreateDirectChat } from '@/lib/services/chatService';
import { User } from '@/lib/types/chat';

const FindByContactScreen = () => {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  const search = async (searchText: string) => {
    if (!searchText.trim()) {
      setFoundUser(null);
      return;
    }

    try {
      setLoading(true);
      const normalizedQuery = searchText.trim();
      const usersRef = collection(db, 'users');

      // Normalize phone number (remove spaces, dashes, etc.)
      const normalizedPhone = normalizedQuery.replace(/[\s\-\(\)]/g, '');
      // Firestore doesn't support full text search, so we'll fetch and filter
      const q = query(usersRef);
      const snapshot = await getDocs(q);
      const users: User[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        users.push({
          uid: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        } as User);
      });

      // Filter by phone number (exact match only)
      const matchingUser = users.find((u) => {
        if (!u.phoneNumber) return false;
        const normalizedUserPhone = u.phoneNumber.replace(/[\s\-\(\)]/g, '');
        return normalizedUserPhone === normalizedPhone;
      });

      if (matchingUser && matchingUser.uid !== currentUser?.uid) {
        setFoundUser(matchingUser);
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

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (!text.trim()) {
      setFoundUser(null);
      return;
    }
    searchTimeoutRef.current = setTimeout(() => {
      searchTimeoutRef.current = null;
      search(text);
    }, 500);
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
        id="contact"
        placeholder={t('auth.phoneNumber') + ' (e.g., +1234567890)'}
        value={searchQuery}
        onChangeText={handleSearch}
        autoCapitalize="none"
        keyboardType="phone-pad"
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
      {!loading && !foundUser && searchQuery.length > 0 && (
        <View className="flex items-center justify-center py-4">
          <Text className="text-gray-500 dark:text-gray-400">
            {t('find.noUserFound')} {t('find.phoneNumber')}
          </Text>
        </View>
      )}
    </Screen>
  );
};

export default FindByContactScreen;
