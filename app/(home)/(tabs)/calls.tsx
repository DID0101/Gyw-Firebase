import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useChatContext } from 'stream-chat-expo';

import AppMenu from '@/components/AppMenu';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import Screen from '@/components/Screen';

interface CallRecord {
  id: string;
  channelId: string;
  type: 'audio' | 'video';
  duration: number;
  timestamp: string;
  participants: Array<{ id: string; name?: string }>;
}

const CallsScreen = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { client } = useChatContext();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const enhancingRef = useRef(false);
  const enhancedCallIds = useRef<Set<string>>(new Set());

  const loadCallHistory = async () => {
    try {
      const storedCalls = await AsyncStorage.getItem('callHistory');
      console.log('Loading call history from AsyncStorage:', storedCalls ? 'found' : 'not found');
      if (storedCalls) {
        const parsedCalls = JSON.parse(storedCalls);
        console.log('Loaded calls:', parsedCalls.length);
        setCalls(parsedCalls);
      } else {
        setCalls([]);
      }
    } catch (error) {
      console.error('Error loading call history:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCallHistory();
    // Refresh call history every 2 seconds
    const interval = setInterval(loadCallHistory, 2000);
    return () => clearInterval(interval);
  }, []);

  // Refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadCallHistory();
    }, [])
  );

  // Enhance call records with channel names
  useEffect(() => {
    const enhanceCalls = async () => {
      if (!client || calls.length === 0 || enhancingRef.current) return;
      
      // Filter calls that need enhancement
      const callsToEnhance = calls.filter(call => {
        const hasName = call.participants.some(p => p.name && p.name !== 'Unknown' && p.name !== '');
        const alreadyEnhanced = enhancedCallIds.current.has(call.id);
        return !hasName && !alreadyEnhanced;
      });
      
      if (callsToEnhance.length === 0) {
        return;
      }
      
      enhancingRef.current = true;
      console.log('Enhancing', callsToEnhance.length, 'calls with channel names...');

      const enhancedCalls = await Promise.all(
        calls.map(async (call) => {
          // Skip if already enhanced or has names
          if (enhancedCallIds.current.has(call.id) || 
              call.participants.some(p => p.name && p.name !== 'Unknown' && p.name !== '')) {
            return call;
          }

          try {
            const channel = client.channel('messaging', call.channelId);
            if (!channel.initialized) {
              await channel.watch();
            }
            
            // Get other participant name from channel
            const otherMember = Object.values(channel.state.members || {}).find(
              (m: any) => m.user?.id !== client.userID
            );
            
            if (otherMember?.user) {
              enhancedCallIds.current.add(call.id);
              return {
                ...call,
                participants: call.participants.map((p) => {
                  if (p.id === otherMember.user.id) {
                    return {
                      ...p,
                      name: otherMember.user.name || p.name,
                    };
                  }
                  return p;
                }),
              };
            }
          } catch (error) {
            console.error('Error enhancing call:', error);
          }
          return call;
        })
      );

      setCalls(enhancedCalls);
      enhancingRef.current = false;
      console.log('Calls enhanced');
    };

    if (client && calls.length > 0 && !loading) {
      enhanceCalls();
    }
  }, [client, loading]);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t('calls.justNow');
    if (diffMins < 60) return `${diffMins}${t('calls.minutesAgo')}`;
    if (diffHours < 24) return `${diffHours}${t('calls.hoursAgo')}`;
    if (diffDays < 7) return `${diffDays}${t('calls.daysAgo')}`;
    return date.toLocaleDateString();
  };

  const handleCallPress = async (call: CallRecord) => {
    router.navigate({
      pathname: '/chat/[id]',
      params: { id: call.channelId },
    });
  };

  return (
    <Screen className="bg-white" viewClassName="flex-1 px-2 sm:px-4 items-start">
      <View className="flex flex-row items-center justify-between w-full min-h-[40px] flex-shrink-0">
        <AppMenu />
        <View className="flex flex-row items-center gap-4 sm:gap-8">
          <Button variant="plain">
            <Feather name="phone" size={20} color="black" />
          </Button>
        </View>
      </View>
      <Button
        variant="plain"
        className="flex flex-row items-center justify-center gap-2 sm:gap-4 mt-4 w-full"
      >
        <Feather name="link" size={20} color="black" />
        <Text className="font-semibold text-sm sm:text-base">{t('calls.createCallLink')}</Text>
      </Button>
      {loading ? (
        <View className="flex-1 w-full flex-col items-center justify-center mt-8 px-4">
          <Text className="text-sm text-gray-600">{t('common.loading')}</Text>
        </View>
      ) : calls.length === 0 ? (
        <View className="flex-1 w-full flex-col items-center justify-center mt-8 px-4">
          <Text className="font-semibold text-base sm:text-lg">{t('calls.noRecentCalls')}</Text>
          <Text className="text-xs sm:text-sm text-gray-600 text-center mt-2">
            {t('calls.getStartedCalling')}
          </Text>
        </View>
      ) : (
        <ScrollView className="flex-1 w-full mt-4" showsVerticalScrollIndicator={false}>
          {calls.map((call, index) => {
            const otherParticipant = call.participants.find((p) => p.id !== client?.userID);
            const participantName = otherParticipant?.name || t('calls.unknown');
            
            return (
              <TouchableOpacity
                key={`${call.id}-${call.timestamp}-${index}`}
                onPress={() => handleCallPress(call)}
                className="flex flex-row items-center gap-3 p-3 border-b border-gray-100"
              >
                <Avatar
                  name={participantName}
                  size={48}
                  fontSize={20}
                />
                <View className="flex-1 min-w-0">
                  <View className="flex flex-row items-center gap-2">
                    <Text className="font-semibold text-base flex-1 truncate">
                      {participantName}
                    </Text>
                    <Feather
                      name={call.type === 'video' ? 'video' : 'phone'}
                      size={16}
                      color="#6B7280"
                    />
                  </View>
                  <View className="flex flex-row items-center gap-2 mt-1">
                    <Text className="text-sm text-gray-600">
                      {call.type === 'video' ? t('calls.videoCall') : t('calls.audioCall')}
                    </Text>
                    {call.duration > 0 && (
                      <>
                        <Text className="text-gray-400">•</Text>
                        <Text className="text-sm text-gray-600">
                          {formatDuration(call.duration)}
                        </Text>
                      </>
                    )}
                    <Text className="text-gray-400">•</Text>
                    <Text className="text-sm text-gray-600">
                      {formatDate(call.timestamp)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
};

export default CallsScreen;
