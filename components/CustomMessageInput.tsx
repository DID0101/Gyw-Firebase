import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TextComposerState } from 'stream-chat';
import {
  MessageInput,
  useAttachmentManagerState,
  useChannelContext,
  useMessageComposer,
  useMessageInputContext,
  useStateStore,
} from 'stream-chat-expo';

import Button from './Button';
import { useTheme } from '@/contexts/ThemeContext';

const textComposerStateSelector = (state: TextComposerState) => ({
  text: state.text,
});

const VideoAttachButton = () => {
  const { channel } = useChannelContext();
  const { colorScheme } = useTheme();
  const iconColor = colorScheme === 'dark' ? '#ffffff' : '#000000';
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const requestPermissions = async () => {
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (libraryStatus !== 'granted') {
      Alert.alert(
        t('common.permissionRequired') || 'Permission Required',
        t('common.videoPermissionMessage') || 'We need access to your photo library to select videos.',
        [{ text: t('common.ok') || 'OK' }]
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
      Alert.alert(
        t('common.error') || 'Error',
        t('common.videoSelectionError') || 'Failed to select video. Please try again.'
      );
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

const CustomMessageInput = () => {
  const { t } = useTranslation();
  const { textComposer } = useMessageComposer();
  const { text } = useStateStore(textComposer.state, textComposerStateSelector);
  const { attachments } = useAttachmentManagerState();

  const audioRecordingEnabled = !text && attachments.length === 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <VideoAttachButton />
      <View style={{ flex: 1 }}>
        <MessageInput
          audioRecordingEnabled={audioRecordingEnabled}
        />
      </View>
    </View>
  );
};

export default CustomMessageInput;
