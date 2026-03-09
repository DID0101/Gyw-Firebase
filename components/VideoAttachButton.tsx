import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useChannelContext } from 'stream-chat-expo';

import Button from './Button';
import { useTheme } from '@/contexts/ThemeContext';

const VideoAttachButton = () => {
  const { channel } = useChannelContext();
  const { colorScheme } = useTheme();
  const { t } = useTranslation();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const [loading, setLoading] = useState(false);

  const requestPermissions = async () => {
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (libraryStatus !== 'granted') {
      Alert.alert(
        t('common.permissionRequired'),
        t('common.videoPermissionMessage'),
        [{ text: t('common.ok') }]
      );
      return false;
    }
    return true;
  };

  const selectVideo = async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    setLoading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 1,
        videoMaxDuration: 300, // 5 minutes max
      });

      if (!result.canceled && result.assets[0] && channel) {
        const videoAsset = result.assets[0];
        
        // Create a file object for Stream Chat
        const file = {
          uri: videoAsset.uri,
          name: videoAsset.fileName || `video_${Date.now()}.mp4`,
          type: videoAsset.mimeType || 'video/mp4',
          size: videoAsset.fileSize || 0,
        };

        // Send the video using Stream Chat's file upload
        // Stream Chat handles file upload automatically when you pass the file object
        await channel.sendMessage({
          attachments: [{
            type: 'video',
            file: file,
          }],
        });
      }
    } catch (error) {
      console.error('Error selecting video:', error);
      Alert.alert(t('common.error'), t('common.videoSelectionError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="plain"
      disabled={loading}
      onPress={selectVideo}
      className="p-0.5"
    >
      <Feather name="video" size={24} color={iconColor} />
    </Button>
  );
};

export default VideoAttachButton;

