import { Feather } from '@expo/vector-icons';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';

import { useThemeClassName } from '@/lib/themeUtils';

interface StoryPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onCameraPress: () => void;
  onGalleryPress: () => void;
}

const StoryPickerModal = ({
  visible,
  onClose,
  onCameraPress,
  onGalleryPress,
}: StoryPickerModalProps) => {
  const { t } = useTranslation();
  const textColor = useThemeClassName('text-black', 'text-white');
  const textSecondaryColor = useThemeClassName('text-gray-500', 'text-gray-400');
  const bgColor = useThemeClassName('bg-white', 'bg-gray-900');
  const itemBgColor = useThemeClassName('bg-gray-50', 'bg-gray-800');

  const handleCamera = () => {
    onCameraPress();
    onClose();
  };

  const handleGallery = () => {
    onGalleryPress();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 bg-black/50 items-center justify-end"
        onPress={onClose}
      >
        <Pressable
          className={clsx('w-full rounded-t-3xl p-6 pb-safe', bgColor)}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="items-center mb-6">
            <View className={clsx('w-12 h-1 rounded-full mb-4', useThemeClassName('bg-gray-300', 'bg-gray-600'))} />
            <Text className={clsx('text-xl font-semibold', textColor)}>{t('stories.addStory')}</Text>
            <Text className={clsx('text-sm mt-1', textSecondaryColor)}>{t('stories.chooseSource')}</Text>
          </View>

          <View className="gap-3">
            <TouchableOpacity
              onPress={handleCamera}
              className={clsx('flex-row items-center gap-4 p-4 rounded-2xl', itemBgColor)}
              activeOpacity={0.7}
            >
              <View className={clsx('w-12 h-12 rounded-full items-center justify-center', useThemeClassName('bg-blue-100', 'bg-blue-900/30'))}>
                <Feather name="camera" size={24} color="#2563eb" />
              </View>
              <View className="flex-1">
                <Text className={clsx('text-base font-semibold', textColor)}>{t('stories.camera')}</Text>
                <Text className={clsx('text-sm', textSecondaryColor)}>{t('stories.takePhotoVideo')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleGallery}
              className={clsx('flex-row items-center gap-4 p-4 rounded-2xl', itemBgColor)}
              activeOpacity={0.7}
            >
              <View className={clsx('w-12 h-12 rounded-full items-center justify-center', useThemeClassName('bg-purple-100', 'bg-purple-900/30'))}>
                <Feather name="image" size={24} color="#9333ea" />
              </View>
              <View className="flex-1">
                <Text className={clsx('text-base font-semibold', textColor)}>{t('stories.gallery')}</Text>
                <Text className={clsx('text-sm', textSecondaryColor)}>{t('stories.selectFromGallery')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="mt-4 p-4 items-center"
            activeOpacity={0.7}
          >
            <Text className={clsx('text-base font-semibold', textSecondaryColor)}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default StoryPickerModal;


