import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, AppStateStatus } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';

import Button from '@/components/Button';
import Screen from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import {
  joinQueue,
  leaveQueue,
  listenForRandomSession,
  startQueueHeartbeat,
  tryMatch,
} from '@/lib/services/randomMatchService';

type DiscoverState = 'idle' | 'searching' | 'disconnected';

const DiscoverScreen = () => {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme, isDark } = useTheme();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-600', 'text-gray-400');
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';

  const [state, setState] = useState<DiscoverState>('idle');
  const [error, setError] = useState<string | null>(null);
  const queueDocIdRef = useRef<string | null>(null);
  const unsubIncomingRef = useRef<(() => void) | null>(null);
  const heartbeatCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  const cancelSearch = useCallback(async () => {
    const qid = queueDocIdRef.current;
    if (qid) {
      try {
        await leaveQueue(qid);
      } catch (_) {}
      queueDocIdRef.current = null;
    }
    if (heartbeatCleanupRef.current) {
      heartbeatCleanupRef.current();
      heartbeatCleanupRef.current = null;
    }
    if (unsubIncomingRef.current) {
      unsubIncomingRef.current();
      unsubIncomingRef.current = null;
    }
    if (isMountedRef.current) {
      setState('idle');
      setError(null);
    }
  }, []);

  const startSearch = useCallback(async () => {
    if (authLoading) {
      setError(t('common.loading'));
      return;
    }
    if (!user?.uid) {
      setError(t('discover.pleaseSignIn'));
      return;
    }
    if (__DEV__) {
      console.log('[DiscoverAudit] startSearch', { userUid: user.uid, authLoading });
    }
    setError(null);
    setState('searching');

    try {
      const qid = await joinQueue(user.uid, { video: true });
      queueDocIdRef.current = qid;

      // Start heartbeat
      heartbeatCleanupRef.current = startQueueHeartbeat(qid);

      const navigateToCall = (callId: string) => {
        if (heartbeatCleanupRef.current) {
          heartbeatCleanupRef.current();
          heartbeatCleanupRef.current = null;
        }
        if (unsubIncomingRef.current) {
          unsubIncomingRef.current();
          unsubIncomingRef.current = null;
        }
        queueDocIdRef.current = null;
        if (isMountedRef.current) {
          setState('idle');
          router.replace(`/(home)/call/${callId}`);
        }
      };

      unsubIncomingRef.current = listenForRandomSession(
        user.uid,
        navigateToCall,
        (err) => {
          if (isMountedRef.current) {
            setError(err?.message || t('discover.permissionError'));
            setState('idle');
            queueDocIdRef.current = null;
            if (heartbeatCleanupRef.current) {
              heartbeatCleanupRef.current();
              heartbeatCleanupRef.current = null;
            }
            if (unsubIncomingRef.current) {
              unsubIncomingRef.current();
              unsubIncomingRef.current = null;
            }
          }
        }
      );

      // Retry tryMatch every 2s for up to 45 seconds (helps 2 phones find each other)
      const SEARCH_DURATION_MS = 45000;
      const RETRY_INTERVAL_MS = 2000;
      const INITIAL_DELAY_MS = 1500; // Let both docs be indexed before first try
      const startTime = Date.now();
      let matched = false;

      await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));
      if (!isMountedRef.current || !queueDocIdRef.current) return;

      while (!matched && Date.now() - startTime < SEARCH_DURATION_MS && isMountedRef.current && queueDocIdRef.current) {
        const result = await tryMatch(user.uid, qid);
        if (!isMountedRef.current) return;
        if (result.matched) {
          matched = true;
          // Session listener will navigate both users; do not navigate here
          break;
        }
        if (Date.now() - startTime < SEARCH_DURATION_MS && queueDocIdRef.current) {
          await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS));
        }
      }

      if (!matched && isMountedRef.current) {
        await cancelSearch();
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err?.message || t('discover.somethingWentWrong'));
        setState('idle');
        queueDocIdRef.current = null;
        if (heartbeatCleanupRef.current) {
          heartbeatCleanupRef.current();
          heartbeatCleanupRef.current = null;
        }
        if (unsubIncomingRef.current) {
          unsubIncomingRef.current();
          unsubIncomingRef.current = null;
        }
      }
    }
  }, [user?.uid, authLoading, router, t]);

  useEffect(() => {
    isMountedRef.current = true;
    
    // Leave queue only when app goes to background (not inactive - that can fire briefly and cancel too soon)
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background') {
        cancelSearch();
      }
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      isMountedRef.current = false;
      subscription.remove();
      cancelSearch();
    };
  }, [cancelSearch]);

  const params = useLocalSearchParams<{ disconnected?: string }>();
  const didDisconnectedRef = useRef(false);
  useEffect(() => {
    if (params.disconnected !== '1' || didDisconnectedRef.current) return;
    didDisconnectedRef.current = true;
    setState('disconnected');
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setState('searching');
        startSearch();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [params.disconnected, startSearch]);

  return (
    <Screen viewClassName="flex-1">
      <View className="flex-1 items-center justify-center px-8">
        {state === 'idle' && (
          <>
            <View
              className="mb-8 h-24 w-24 items-center justify-center rounded-full"
              style={{ backgroundColor: isDark ? '#374151' : '#e5e7eb' }}
            >
              <MaterialIcons name="videocam" size={48} color={iconColor} />
            </View>
            <Text className={`text-center text-xl font-semibold ${textColor}`}>
              {t('discover.title')}
            </Text>
            <Text className={`mt-2 text-center ${textSecondaryColor}`}>
              {t('discover.videoChatDescription')}
            </Text>
            {error && (
              <Text className="mt-4 text-center text-red-500">{error}</Text>
            )}
            <Button
              onPress={startSearch}
              disabled={authLoading}
              className="mt-8 min-w-[200]"
            >
              {t('discover.startRandomChat')}
            </Button>
          </>
        )}

        {state === 'searching' && (
          <>
            <ActivityIndicator size="large" color={iconColor} />
            <Text className={`mt-6 text-center text-lg ${textColor}`}>
              {t('discover.searching')}
            </Text>
            <Pressable
              onPress={cancelSearch}
              className="mt-8 rounded-full border border-gray-400 px-6 py-3"
            >
              <Text className={textColor}>{t('discover.cancel')}</Text>
            </Pressable>
          </>
        )}

        {state === 'disconnected' && (
          <>
            <Ionicons name="person-remove-outline" size={64} color={iconColor} />
            <Text className={`mt-6 text-center text-lg ${textColor}`}>
              {t('discover.strangerLeft')}
            </Text>
            <Text className={`mt-2 text-center ${textSecondaryColor}`}>
              {t('discover.searching')}
            </Text>
            <View className="mt-6">
              <ActivityIndicator size="small" color={iconColor} />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
};

export default DiscoverScreen;
