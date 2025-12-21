import { Ionicons } from '@expo/vector-icons';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCalls } from '@stream-io/video-react-native-sdk';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { HapticTab } from '@/components/HapticTab';

const TabsLayout = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const calls = useCalls().filter((call) => call.ringing);

  const ringingCall = calls[0];
  const isCallCreatedByMe =
    ringingCall?.state?.custom.triggeredBy === ringingCall?.currentUserId;

  useEffect(() => {
    if (isCallCreatedByMe) return;
    if (ringingCall) {
      router.navigate({
        pathname: `/call/[id]`,
        params: {
          id: ringingCall.id,
        },
      });
    }
  }, [ringingCall, isCallCreatedByMe, router]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: 'black',
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: 'white',
          borderTopColor: 'white',
        },
        headerTransparent: true,
        headerTitleAlign: 'center',
      }}
    >
      <Tabs.Screen
        name="chats"
        options={{
          title: t('chats.title'),
          tabBarIcon: ({ color }) => (
            <Ionicons name="chatbubble-sharp" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: t('calls.title'),
          tabBarIcon: ({ color }) => (
            <FontAwesome name="phone" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stories"
        options={{
          title: t('stories.title'),
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="web-stories" size={28} color={color} />
          ),
        }}
      />
    </Tabs>
  );
};

export default TabsLayout;
