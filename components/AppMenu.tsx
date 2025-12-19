import { useClerk, useUser } from '@clerk/clerk-expo';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { getError } from '../lib/utils';
import Avatar from './Avatar';
import Button from './Button';
import LanguageSwitcher from './LanguageSwitcher';

const AppMenu = () => {
  const { signOut } = useClerk();
  const router = useRouter();
  const { user } = useUser();
  const { t } = useTranslation();
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const avatarRef = useRef<View>(null);

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
      router.replace('/');
    } catch (err) {
      getError(err);
    }
  };

  return (
    <>
      <Button variant="plain" ref={avatarRef} onPress={toggleMenu}>
        <Avatar
          imageUrl={user?.imageUrl}
          size={28}
          fontSize={12}
          name={user?.fullName!}
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
            className="absolute bg-white rounded-lg shadow-md shadow-gray-100 min-w-[250px]"
          >
            <Button
              variant="plain"
              className="flex-row items-center justify-between py-2 px-3 border-b border-gray-200"
              onPress={goToProfile}
            >
              <Text>{t('profile.title')}</Text>
              <Feather name="user" size={20} color="black" />
            </Button>
            <LanguageSwitcher variant="menu" />
            <Button
              variant="plain"
              className="flex-row items-center justify-between py-2 px-3"
              onPress={handleSignOut}
            >
              <Text className="text-red-600">{t('auth.signOut')}</Text>
              <Feather name="log-out" size={20} color="red" />
            </Button>
          </View>
        </Pressable>
      </Modal>
    </>
  );
};

export default AppMenu;
