import { Ionicons } from '@expo/vector-icons';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { HapticTab } from '@/components/HapticTab';
import { useTheme } from '@/contexts/ThemeContext';

const TabsLayout = () => {
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  
  const tabBarActiveTintColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const tabBarInactiveTintColor = colorScheme === 'dark' ? '#9ca3af' : '#6b7280';
  const tabBarBackgroundColor = colorScheme === 'dark' ? '#111827' : '#ffffff';
  const tabBarBorderColor = colorScheme === 'dark' ? '#374151' : '#e5e7eb';
  const headerTintColor = colorScheme === 'dark' ? '#ffffff' : '#000000';


  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor,
        tabBarInactiveTintColor,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: tabBarBackgroundColor,
          borderTopColor: tabBarBorderColor,
        },
        headerTransparent: true,
        headerTitleAlign: 'center',
        headerTintColor,
        headerTitleStyle: {
          color: headerTintColor,
        },
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
        name="discover"
        options={{
          title: t('discover.title'),
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="videocam" size={26} color={color} />
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
