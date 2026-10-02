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
import {
  prefetchRecommendedUsers,
  useContactRecommendedUsers,
} from '@/lib/hooks/useContactRecommendedUsers';
import { searchLoadLog, searchLogDeviceContext } from '@/lib/debug/searchLoadingTrace';
import {
  endHangWatch,
  logScreenLifecycle,
  startHangWatch,
  updateHangWatch,
} from '@/lib/debug/runtimeDiagnostics';
import { useContactsStore } from '@/store/contactsStore';
import { getDeviceRegionCode } from '@/lib/phoneNormalize';
import { getOrCreateDirectChat } from '@/lib/services/chatService';
import { searchUsersByUsernameOrPhone } from '@/lib/services/userSearchService';
import { getCachedSearch, setCachedSearch } from '@/lib/services/searchCache';
import type { User } from '@/lib/types/chat';
import { buildDisplayName } from '@/lib/unicodeText';

const DEBOUNCE_MS = 300;
const SEARCH_BUSY_TIMEOUT_MS = 10_000;

function UserSearchScreen() {
  const mountedAtRef = useRef(Date.now());
  const firstRenderLoggedRef = useRef(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colorScheme } = useTheme();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { callType, media, initialQuery } = useLocalSearchParams<{
    callType?: string;
    media?: string;
    initialQuery?: string;
  }>();

  const region = useMemo(() => getDeviceRegionCode(), []);
  const {
    permission: recPerm,
    loading: recLoading,
    users: recUsers,
    contactRows: recContactRows,
    phoneLines: recPhoneLines,
  } = useContactRecommendedUsers(user?.uid, user?.phoneNumber ?? undefined);

  const [query, setQuery] = useState(typeof initialQuery === 'string' ? initialQuery : '');
  const [searchHits, setSearchHits] = useState<User[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{ uri: string; type: string } | null>(null);

  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchBusyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    logScreenLifecycle('Search', 'MOUNT', {
      mountTimeMs: mountedAtRef.current,
      authUid: user?.uid ?? null,
      region,
    });
    searchLoadLog('SEARCH_SCREEN_MOUNT');
    searchLoadLog('SEARCH_INITIALIZATION_START', { hasUid: !!user?.uid });
    searchLogDeviceContext();
    prefetchRecommendedUsers(user?.uid, user?.phoneNumber ?? undefined);
    void useContactsStore.getState().hydrateFromStorage().then(() => {
      searchLoadLog('SEARCH_INITIALIZATION_SUCCESS', { phase: 'contacts_hydrate' });
    }).catch((e) => {
      searchLoadLog('SEARCH_INITIALIZATION_FAILED', {
        phase: 'contacts_hydrate',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }, [user?.phoneNumber, user?.uid]);

  useEffect(() => {
    if (firstRenderLoggedRef.current) return;
    firstRenderLoggedRef.current = true;
    logScreenLifecycle('Search', 'FIRST_RENDER', {
      elapsedSinceMountMs: Date.now() - mountedAtRef.current,
      authUid: user?.uid ?? null,
      region,
    });
  }, [region, user?.uid]);

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
      if (searchBusyTimeoutRef.current) clearTimeout(searchBusyTimeoutRef.current);
    };
  }, []);

  const clearSearchBusy = useCallback((reason: string) => {
    if (searchBusyTimeoutRef.current) {
      clearTimeout(searchBusyTimeoutRef.current);
      searchBusyTimeoutRef.current = null;
    }
    setSearchBusy((prev) => {
      if (!prev) return prev;
      searchLoadLog('LOADING_END', { source: 'query', reason });
      return false;
    });
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
      const prevSeq = searchSeq.current;
      const seq = ++searchSeq.current;
      if (prevSeq > 0) {
        searchLoadLog('SEARCH_CANCEL_PREVIOUS', { cancelledSeq: prevSeq, nextSeq: seq });
      }
      const trimmed = text.trim();
      if (!trimmed) {
        setSearchHits([]);
        clearSearchBusy('empty_query');
        setSearchTouched(false);
        return;
      }
      if (!user?.uid) {
        searchLoadLog('SEARCH_QUERY_ERROR', { reason: 'auth_not_ready', q: trimmed.slice(0, 32) });
        logScreenLifecycle('Search', 'QUERY_BLOCKED', {
          reason: 'auth_not_ready',
          q: trimmed.slice(0, 32),
        });
        setSearchHits([]);
        clearSearchBusy('auth_not_ready');
        setSearchTouched(true);
        return;
      }
      const queryStartedAt = Date.now();
      setSearchBusy(true);
      startHangWatch('search.query', 'Search', {
        lastSuccessfulEvent: 'query_started',
        timeoutMs: 8_000,
      });
      logScreenLifecycle('Search', 'QUERY_START', {
        seq,
        q: trimmed.slice(0, 32),
        authUid: user.uid,
        region,
      });
      searchLoadLog('LOADING_START', { source: 'query' });
      searchLoadLog('SEARCH_START', { q: trimmed.slice(0, 32) });
      searchLoadLog('SEARCH_QUERY', { q: trimmed.slice(0, 32) });
      setSearchTouched(true);
      if (searchBusyTimeoutRef.current) clearTimeout(searchBusyTimeoutRef.current);
      searchBusyTimeoutRef.current = setTimeout(() => {
        if (seq === searchSeq.current) {
          searchLoadLog('SEARCH_TIMEOUT_10S', { ms: SEARCH_BUSY_TIMEOUT_MS });
          updateHangWatch('search.query', { lastFailedEvent: 'search_timeout_10s' });
          clearSearchBusy('timeout_10s');
        }
      }, SEARCH_BUSY_TIMEOUT_MS);

      const cached = await getCachedSearch(trimmed, region);
      if (cached && seq === searchSeq.current) {
        setSearchHits(cached.filter((u) => u.uid !== user?.uid));
        searchLoadLog('SEARCH_CACHE_SWR', { count: cached.length });
      }

      let resultCount = cached?.length ?? 0;
      try {
        const rows = await searchUsersByUsernameOrPhone(trimmed, user?.uid, region);
        if (seq !== searchSeq.current) return;
        const map = new Map<string, User>();
        for (const u of rows) {
          if (u.uid !== user?.uid) map.set(u.uid, u);
        }
        const hits = [...map.values()];
        resultCount = hits.length;
        setSearchHits(hits);
        void setCachedSearch(trimmed, region, hits);
        updateHangWatch('search.query', {
          lastSuccessfulEvent: `query_result:${resultCount}`,
        });
        logScreenLifecycle('Search', 'QUERY_RESULT', {
          seq,
          count: resultCount,
          elapsedMs: Date.now() - queryStartedAt,
        });
        searchLoadLog('SEARCH_RESULT_COUNT', { count: resultCount });
      } catch (e) {
        if (seq === searchSeq.current) {
          setSearchHits([]);
          updateHangWatch('search.query', {
            lastFailedEvent: e instanceof Error ? e.message : String(e),
          });
          logScreenLifecycle('Search', 'QUERY_ERROR', {
            seq,
            elapsedMs: Date.now() - queryStartedAt,
            message: e instanceof Error ? e.message : String(e),
          });
          searchLoadLog('SEARCH_ERROR', {
            message: e instanceof Error ? e.message : String(e),
          });
        }
      } finally {
        if (seq === searchSeq.current) {
          searchLoadLog('SEARCH_COMPLETE', { hits: resultCount });
          clearSearchBusy('query_done');
          endHangWatch('search.query', 'query_done');
        }
      }
    },
    [clearSearchBusy, region, user?.uid]
  );

  useEffect(() => {
    const seed = typeof initialQuery === 'string' ? initialQuery.trim() : '';
    if (!seed) return;
    void runQuery(seed);
  }, [initialQuery, runQuery]);

  const onChangeQuery = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!text.trim()) {
        setSearchHits([]);
        clearSearchBusy('cleared');
        setSearchTouched(false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runQuery(text);
      }, DEBOUNCE_MS);
    },
    [clearSearchBusy, runQuery]
  );

  const goBack = useCallback(() => {
    try {
      router.dismiss();
    } catch {
      if (router.canGoBack()) router.back();
    }
  }, [router]);

  // Fire-and-forget: tap returns immediately so Pressable / transition feels instant.
  const onSelectUser = useCallback(
    (userId: string) => {
      if (!user) return;
      void (async () => {
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
      })();
    },
    [callType, media, pendingMedia, router, user]
  );

  const renderRow = useCallback(
    ({ item }: { item: User }) => (
      <UserCard
        user={{
          id: item.uid,
          name: buildDisplayName(item.firstName, item.lastName, item.username),
          username: item.username,
          image: item.avatar,
          phoneNumber: item.phoneNumber,
          firstName: item.firstName,
          lastName: item.lastName,
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
