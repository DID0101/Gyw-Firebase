import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';

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
          className="w-full bg-white rounded-t-3xl p-6 pb-safe"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="items-center mb-6">
            <View className="w-12 h-1 bg-gray-300 rounded-full mb-4" />
            <Text className="text-xl font-semibold">{t('stories.addStory')}</Text>
            <Text className="text-sm text-gray-500 mt-1">{t('stories.chooseSource')}</Text>
          </View>

          <View className="gap-3">
            <TouchableOpacity
              onPress={handleCamera}
              className="flex-row items-center gap-4 p-4 bg-gray-50 rounded-2xl active:bg-gray-100"
            >
              <View className="w-12 h-12 bg-blue-100 rounded-full items-center justify-center">
                <Feather name="camera" size={24} color="#2563eb" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold">{t('stories.camera')}</Text>
                <Text className="text-sm text-gray-500">{t('stories.takePhotoVideo')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleGallery}
              className="flex-row items-center gap-4 p-4 bg-gray-50 rounded-2xl active:bg-gray-100"
            >
              <View className="w-12 h-12 bg-purple-100 rounded-full items-center justify-center">
                <Feather name="image" size={24} color="#9333ea" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold">{t('stories.gallery')}</Text>
                <Text className="text-sm text-gray-500">{t('stories.selectFromGallery')}</Text>
              </View>
              <Feather name="chevron-right" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onClose}
            className="mt-4 p-4 items-center"
          >
            <Text className="text-base font-semibold text-gray-600">{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default StoryPickerModal;


