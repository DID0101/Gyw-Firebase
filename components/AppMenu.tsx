import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { getError } from '../lib/utils';
import Avatar from './Avatar';
import Button from './Button';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';

const AppMenu = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const avatarRef = useRef<View>(null);

  const menuBg = useThemeClassName('bg-white', 'bg-gray-900');
  const textColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const iconBg = useThemeClassName('bg-gray-100', 'bg-gray-800');

  const toggleMenu = () => {
    if (menuVisible) {
      setMenuVisible(false);
      return;
    }
    if (avatarRef.current) {
      avatarRef.current.measure((_x, _y, _width, height, pageX, pageY) => {
        setMenuPosition({ top: pageY + height + 8, left: pageX - 8 });
        setMenuVisible(true);
      });
    }
  };

  const goToProfile = () => {
    setMenuVisible(false);
    router.push('/profile');
  };

  const handleSignOut = async () => {
    setMenuVisible(false);
    try {
      await signOut();
      router.replace('/sign-in');
    } catch (err) {
      getError(err);
    }
  };

  return (
    <>
      <Button variant="plain" ref={avatarRef} onPress={toggleMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Avatar
          imageUrl={user?.photoURL || undefined}
          size={28}
          fontSize={12}
          name={user?.displayName || user?.phoneNumber || 'User'}
        />
      </Button>
      <Modal
        transparent
        visible={menuVisible}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={{ top: menuPosition.top, left: menuPosition.left }}
            className={clsx('absolute rounded-2xl shadow-2xl min-w-[200px] overflow-hidden py-2', menuBg)}
          >
            <Pressable
              className="flex-row items-center gap-4 py-3.5 px-5"
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
              })}
              onPress={goToProfile}
            >
              <View className={clsx('w-9 h-9 rounded-full items-center justify-center', iconBg)}>
                <Feather name="user" size={18} color="#FF5722" />
              </View>
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('profile.title')}</Text>
            </Pressable>

            <LanguageSwitcher variant="menu" />

            <ThemeToggle variant="menu" />

            <View className={clsx('h-[1px] mx-3 my-1', colorScheme === 'dark' ? 'bg-gray-700' : 'bg-gray-200')} />

            <Pressable
              className="flex-row items-center gap-4 py-3.5 px-5"
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
              })}
              onPress={handleSignOut}
            >
              <View className={clsx('w-9 h-9 rounded-full items-center justify-center', colorScheme === 'dark' ? 'bg-red-900/30' : 'bg-red-50')}>
                <Feather name="log-out" size={18} color="#ef4444" />
              </View>
              <Text className={clsx('flex-1 text-red-600 dark:text-red-400 text-[15px] font-medium')}>{t('auth.signOut')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

export default AppMenu;
