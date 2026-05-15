import Feather from '@expo/vector-icons/Feather';
import clsx from 'clsx';
import type { MutableRefObject } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import Button from '@/components/Button';
import { TAB_HEADER_ICON_SIZE } from '@/lib/ui/tabHeader';
import { useThemeClassName } from '@/lib/themeUtils';

export type ChatsHeaderHandlers = {
  openCamera: () => void;
  openSearch: () => void;
  openNewGroup: () => void;
  markAllRead: () => void | Promise<void>;
  openArchived: () => void;
  openSettings: () => void;
  inviteFriends: () => void;
};

type Props = {
  iconColor: string;
  handlersRef: MutableRefObject<ChatsHeaderHandlers>;
};

const ChatsHeaderActions = memo(function ChatsHeaderActions({ iconColor, handlersRef }: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 56, right: 8 });
  const moreRef = useRef<View>(null);
  const menuBg = useThemeClassName('bg-white', 'bg-gray-900');
  const textColor = useThemeClassName('text-gray-900', 'text-gray-100');
  const dividerClass = useThemeClassName('bg-gray-200', 'bg-gray-700');

  const sz = TAB_HEADER_ICON_SIZE;

  const openMenu = useCallback(() => {
    moreRef.current?.measureInWindow((_x, y, _w, h) => {
      setAnchor({ top: y + h + 6, right: 8 });
      setMenuOpen(true);
    });
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const run = useCallback(
    (fn: keyof ChatsHeaderHandlers) => {
      closeMenu();
      requestAnimationFrame(() => {
        try {
          void handlersRef.current[fn]();
        } catch {
          /* caller handles */
        }
      });
    },
    [closeMenu, handlersRef]
  );

  return (
    <>
      <View className="flex-row items-center gap-4 sm:gap-8">
        <Button variant="plain" onPress={() => handlersRef.current.openCamera()}>
          <Feather name="camera" size={sz} color={iconColor} />
        </Button>
        <Button variant="plain" onPress={() => handlersRef.current.openSearch()}>
          <Feather name="search" size={sz} color={iconColor} />
        </Button>
        <View ref={moreRef} collapsable={false}>
          <Button variant="plain" onPress={openMenu} accessibilityLabel={t('chats.headerMore')}>
            <Feather name="more-vertical" size={sz} color={iconColor} />
          </Button>
        </View>
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeMenu} accessibilityRole="button" />
          <View
            style={[styles.menuWrap, { top: anchor.top, right: anchor.right }]}
            className={clsx('rounded-2xl shadow-xl overflow-hidden min-w-[220px]', menuBg)}
            pointerEvents="box-none"
          >
            <Pressable
              className="flex-row items-center gap-3 py-3.5 px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              onPress={() => run('openNewGroup')}
            >
              <Feather name="users" size={20} color="#FF5722" />
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('chats.menuNewGroup')}</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center gap-3 py-3.5 px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              onPress={() => run('markAllRead')}
            >
              <Feather name="check-circle" size={20} color="#FF5722" />
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('chats.menuMarkAllRead')}</Text>
            </Pressable>
            <View className={clsx('h-px mx-3', dividerClass)} />
            <Pressable
              className="flex-row items-center gap-3 py-3.5 px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              onPress={() => run('openArchived')}
            >
              <Feather name="archive" size={20} color={iconColor} />
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('chats.menuArchived')}</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center gap-3 py-3.5 px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              onPress={() => run('openSettings')}
            >
              <Feather name="settings" size={20} color={iconColor} />
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('chats.menuSettings')}</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center gap-3 py-3.5 px-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              onPress={() => run('inviteFriends')}
            >
              <Feather name="share-2" size={20} color={iconColor} />
              <Text className={clsx('flex-1 text-[15px] font-medium', textColor)}>{t('chats.menuInviteFriends')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  menuWrap: {
    position: 'absolute',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
});

export default ChatsHeaderActions;
