import { Feather } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { useTheme } from '@/contexts/ThemeContext';

const ModalLayout = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  
  const handleProfileBack = useCallback(() => {
    router.dismiss();
  }, [router]);
  
  const handleNewMessageCancel = useCallback(() => {
    try {
      router.dismissTo('/chats');
    } catch {
      try {
        router.dismiss();
      } catch {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/chats');
        }
      }
    }
  }, [router]);
  
  const headerTintColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  
  return (
    <Stack
      screenOptions={{
        headerBackground: () => (
          <View 
            style={{ 
              flex: 1, 
              backgroundColor: colorScheme === 'dark' ? '#111827' : '#ffffff',
              paddingTop: insets.top,
            }} 
          />
        ),
        headerTintColor,
        headerBackButtonDisplayMode: 'minimal',
        headerTitleAlign: 'center',
        headerTitleStyle: {
          color: headerTintColor,
        },
      }}
    >
      <Stack.Screen
        name="profile"
        options={{
          title: t('profile.title'),
          headerLeft: () => {
            return (
              <Pressable
                onPress={handleProfileBack}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                })}
              >
                <Feather name="chevron-left" size={32} color={iconColor} />
              </Pressable>
            );
          },
        }}
      />
      <Stack.Screen
        name="new-message"
        options={({ navigation }) => ({
          title: t('chats.newMessage'),
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                console.log('Cancel button onPress triggered');
                handleNewMessageCancel();
              }}
              hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
              activeOpacity={0.6}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                minWidth: 60,
              }}
            >
              <Text style={{ color: headerTintColor, fontSize: 16, fontWeight: '500' }}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="new-group"
        options={{
          title: t('groups.selectMembers'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="px-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="chevron-left" size={32} color={iconColor} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="find-by-username"
        options={{
          title: t('chats.findByUsername'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="px-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="chevron-left" size={32} color={iconColor} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="find-by-contact"
        options={{
          title: t('chats.findByContactTitle'),
          headerLeft: () => (
            <Button
              variant="plain"
              onPress={() => router.dismiss()}
              className="px-2"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Feather name="chevron-left" size={32} color={iconColor} />
            </Button>
          ),
        }}
      />
      <Stack.Screen
        name="story-viewer"
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
        }}
      />
    </Stack>
  );
};

export default ModalLayout;
