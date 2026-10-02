import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable } from 'react-native';

import { Feather } from '@expo/vector-icons';
import Avatar from './Avatar';

interface ImageInputProps {
  name?: string;
  imageUri: string | null;
  onChangeImage: (file: ImagePicker.ImagePickerAsset | null) => void;
}

function ImageInput({ name, imageUri, onChangeImage }: ImageInputProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    requestPermission();
  }, []);

  const requestPermission = async () => {
    try {
      const { granted } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!granted)
        alert(t('common.enablePermission'));
    } catch (error) {
      console.error('Error requesting media library permissions:', error);
    }
  };

  const handlePress = () => {
    if (pickerOpen) {
      if (__DEV__) console.log('SAFE_ACTION_BLOCKED', { key: 'image_picker' });
      return;
    }
    if (!imageUri) selectImage();
    else
      Alert.alert(t('common.delete'), t('common.confirmDeleteImage'), [
        {
          text: t('common.yes'),
          onPress: () => onChangeImage(null),
        },
        { text: t('common.no') },
      ]);
    return;
  };

  const selectImage = async () => {
    setPickerOpen(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (!result.canceled) {
        onChangeImage(result.assets[0]);
        return;
      }
    } catch (error) {
      console.error('Error selecting image:', error);
    } finally {
      setPickerOpen(false);
    }
  };

  return (
    <Pressable disabled={pickerOpen} onPress={handlePress} className="items-center justify-center">
      <Avatar
        imageUrl={imageUri!}
        size={100}
        fontSize={40}
        name={name || 'User'}
        placeholderType={name ? 'text' : 'icon'}
      />
      {imageUri && (
        <Feather
          color="#ffffff78"
          name="edit-2"
          size={40}
          className="absolute"
        />
      )}
    </Pressable>
  );
}

export default ImageInput;
