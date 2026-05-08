import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Screen from '@/components/Screen';
import UserCard from '@/components/UserCard';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useContactRecommendedUsers } from '@/lib/hooks/useContactRecommendedUsers';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { getOrCreateDirectChat } from '@/lib/services/chatService';
import { searchUsersByUsernameOrPhone } from '@/lib/services/userSearchService';
import type { User } from '@/lib/types/chat';

const DEBOUNCE_MS = 400;

function UserSearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colorScheme } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { callType, media } = useLocalSearchParams<{ callType?: string; media?: string }>();

  const region = useMemo(() => getDeviceRegionCode(), []);
  const {
    permission: recPerm,
    loading: recLoading,
    users: recUsers,
    contactRows: recContactRows,
    phoneLines: recPhoneLines,
  } = useContactRecommendedUsers(user?.uid, user?.phoneNumber ?? undefined);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<User[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: string } | null>(null);

  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  useFocusEffect(
    useCallback(() => {
      const id = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }, [])
  );

  const isSearching = query.trim().length > 0;
  const listData = isSearching ? searchHits : recUsers;

  const barStyle = useMemo(
    () => ({
      backgroundColor: colorScheme === 'dark' ? '#374151' : '#f3f4f6',
    }),
    [colorScheme]
  );
  const inputColor = colorScheme === 'dark' ? '#ffffff' : '#111827';
  const muted = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (media !== 'true') {
      setPendingMedia(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('pendingMedia');
        if (!cancelled && raw) setPendingMedia(JSON.parse(raw));
      } catch {
        if (!cancelled) setPendingMedia(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [media]);

  const runQuery = useCallback(
    async (text: string) => {
      const seq = ++searchSeq.current;
      const trimmed = text.trim();
      if (!trimmed) {
        setSearchHits([]);
        setSearchBusy(false);
        setSearchTouched(false);
        return;
      }
      setSearchBusy(true);
      setSearchTouched(true);
      try {
        const rows = await searchUsersByUsernameOrPhone(trimmed, user?.uid, region);
        if (seq !== searchSeq.current) return;
        const map = new Map<string, User>();
        for (const u of rows) {
          if (u.uid !== user?.uid) map.set(u.uid, u);
        }
        setSearchHits([...map.values()]);
      } catch {
        if (seq === searchSeq.current) setSearchHits([]);
      } finally {
        if (seq === searchSeq.current) setSearchBusy(false);
      }
    },
    [region, user?.uid]
  );

  const onChangeQuery = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setSearchHits([]);
        setSearchBusy(false);
        setSearchTouched(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runQuery(text);
      }, DEBOUNCE_MS);
    },
    [runQuery]
  );

  const goBack = useCallback(() => {
    try {
      router.dismiss();
    } catch {
      if (router.canGoBack()) router.back();
    }
  }, [router]);

  const onSelectUser = useCallback(
    async (userId: string) => {
      if (!user) return;
      try {
        const chatId = await getOrCreateDirectChat(user.uid, userId);

        if (media === 'true' && pendingMedia) {
          try {
            await AsyncStorage.setItem(
              'pendingMediaForChannel',
              JSON.stringify({ channelId: chatId, media: pendingMedia })
            );
            await AsyncStorage.removeItem('pendingMedia');
            router.dismissTo({
              pathname: '/chat/[id]',
              params: { id: chatId, pendingMedia: 'true' },
            });
          } catch {
            router.dismissTo({ pathname: '/chat/[id]', params: { id: chatId } });
          }
          return;
        }

        if (callType === 'audio' || callType === 'video') {
          router.dismissTo({
            pathname: '/call/[id]',
            params: {
              id: chatId,
              updateCall: 'true',
              ...(callType === 'video' ? { video: 'true' } : {}),
            },
          });
          return;
        }

        router.dismissTo({ pathname: '/chat/[id]', params: { id: chatId } });
      } catch (e) {
        if (__DEV__) console.error(e);
      }
    },
    [callType, media, pendingMedia, router, user]
  );

  const renderRow = useCallback(
    ({ item }: { item: User }) => (
      <UserCard
        user={{
          id: item.uid,
          name: `${item.firstName} ${item.lastName}`.trim() || item.username,
          username: item.username,
          image: item.avatar,
        }}
        onPress={() => onSelectUser(item.uid)}
      />
    ),
    [onSelectUser]
  );

  const listHeader = useMemo(() => {
    if (isSearching) return null;

    if (Platform.OS === 'web') {
      return (
        <View className="px-1 py-3">
          <Text className="text-sm text-gray-500 dark:text-gray-400">{t('chats.recommendedUsersWeb')}</Text>
        </View>
      );
    }

    if (recLoading) {
      return (
        <View className="px-1 py-4 items-center">
          <ActivityIndicator size="small" />
        </View>
      );
    }

    if (recPerm === 'denied') {
      return (
        <View className="px-1 py-4 gap-2">
          <Text className="text-sm text-gray-500 dark:text-gray-400 leading-5">{t('chats.contactsNoAccess')}</Text>
          <Pressable onPress={() => Linking.openSettings()} hitSlop={8}>
            <Text className="text-sm text-blue-600 dark:text-blue-400">{t('chats.contactsOpenSettings')}</Text>
          </Pressable>
        </View>
      );
    }

    if (recUsers.length > 0) {
      return (
        <View className="px-1 pt-2 pb-2 gap-1">
          <Text className="text-base font-semibold text-gray-900 dark:text-white">{t('chats.recommendedUsers')}</Text>
          <Text className="text-sm text-gray-600 dark:text-gray-300">{t('chats.recommendedUsersSubtitle')}</Text>
        </View>
      );
    }

    return (
      <View className="px-1 py-4">
        <Text className="text-sm text-gray-500 dark:text-gray-400 leading-5">
          {recContactRows === 0
            ? t('chats.contactsEmpty')
            : recPhoneLines === 0
              ? t('chats.contactsNoPhones')
              : t('chats.recommendedFromContactsEmpty')}
        </Text>
      </View>
    );
  }, [isSearching, recContactRows, recLoading, recPerm, recPhoneLines, recUsers, t]);

  const listEmpty = useMemo(() => {
    if (!isSearching || searchBusy) return null;
    if (!searchTouched || searchHits.length > 0) return null;
    return (
      <Text className="text-center text-gray-500 dark:text-gray-400 px-4 py-6">{t('chats.userSearchNoResults')}</Text>
    );
  }, [isSearching, searchBusy, searchHits.length, searchTouched, t]);

  return (
    <Screen viewClassName="flex-1 bg-white dark:bg-gray-900">
      <View style={{ paddingTop: insets.top }} className="border-b border-gray-200 dark:border-gray-800 px-3 pb-3">
        {media === 'true' && pendingMedia && (
          <View className="items-center py-2 mb-2">
            <Text className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
              {t('chats.selectContactToSend')}
            </Text>
            <View className="w-20 h-20 rounded-lg overflow-hidden">
              {pendingMedia.type === 'video' ? (
                <View className="w-full h-full bg-gray-200 dark:bg-gray-700 items-center justify-center">
                  <Feather name="video" size={28} color="#FF5722" />
                </View>
              ) : (
                <Image source={{ uri: pendingMedia.uri }} className="w-full h-full" resizeMode="cover" />
              )}
            </View>
          </View>
        )}

        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={goBack}
            hitSlop={12}
            className="p-1"
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Feather name="chevron-left" size={28} color={inputColor} />
          </Pressable>
          <View className="flex-1 flex-row items-center rounded-full px-3 py-2" style={barStyle}>
            <Feather name="search" size={20} color={muted} style={{ marginRight: 8 }} />
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={onChangeQuery}
              placeholder={t('chats.userSearchPlaceholder')}
              placeholderTextColor={muted}
              className="flex-1 text-base py-1 text-gray-900 dark:text-white"
              style={{ color: inputColor }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              {...(Platform.OS === 'ios' ? { clearButtonMode: 'while-editing' as const } : {})}
            />
            {searchBusy ? <ActivityIndicator size="small" color={muted} /> : null}
          </View>
        </View>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item) => item.uid}
        renderItem={renderRow}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingBottom: insets.bottom + 16,
          gap: 8,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      />
    </Screen>
  );
}

export default UserSearchScreen;
