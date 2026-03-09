import { Feather } from '@expo/vector-icons';
import { Dimensions, Image, Modal, Pressable, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ImageViewerProps {
  visible: boolean;
  imageUri: string;
  onClose: () => void;
}

const ImageViewer = ({ visible, imageUri, onClose }: ImageViewerProps) => {
  const insets = useSafeAreaInsets();

  if (!visible || !imageUri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.95)' }}>
        {/* Header */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            paddingBottom: 16,
            paddingHorizontal: 16,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 40,
                height: 40,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 20,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
              }}
              activeOpacity={0.7}
            >
              <Feather name="x" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Image Container */}
        <Pressable
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onPress={onClose}
        >
          <Image
            source={{ uri: imageUri }}
            style={{
              width: SCREEN_WIDTH,
              height: SCREEN_HEIGHT,
              resizeMode: 'contain',
            }}
          />
        </Pressable>
      </View>
    </Modal>
  );
};

export default ImageViewer;

