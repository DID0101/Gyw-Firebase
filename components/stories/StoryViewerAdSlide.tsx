import { Feather } from '@expo/vector-icons';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import {
  NativeAd,
  NativeAdEventType,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';

import { useTheme } from '@/contexts/ThemeContext';
import { storyAdLog } from '@/lib/stories/storyAdLog';

type StoryViewerAdSlideProps = {
  nativeAd: NativeAd;
  slotIndex: number;
  width: number;
  height: number;
  onSkip: () => void;
  topInset: number;
};

const StoryViewerAdSlide = memo(function StoryViewerAdSlide({
  nativeAd,
  slotIndex,
  width,
  height,
  onSkip,
  topInset,
}: StoryViewerAdSlideProps) {
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const accent = colorScheme === 'dark' ? '#4A90A4' : '#086da0';
  const cardBg = colorScheme === 'dark' ? '#111827' : '#FFFFFF';
  const textPrimary = colorScheme === 'dark' ? '#F9FAFB' : '#111827';
  const textSecondary = colorScheme === 'dark' ? '#D1D5DB' : '#4B5563';

  useEffect(() => {
    storyAdLog('STORY_AD_RENDERED', {
      slotIndex,
      responseId: nativeAd.responseId,
      surface: 'viewer',
    });

    const impressionSub = nativeAd.addAdEventListener(
      NativeAdEventType.IMPRESSION,
      () => {
        storyAdLog('STORY_AD_IMPRESSION', {
          slotIndex,
          responseId: nativeAd.responseId,
          surface: 'viewer',
        });
      },
    );
    const clickSub = nativeAd.addAdEventListener(NativeAdEventType.CLICKED, () => {
      storyAdLog('STORY_AD_CLICKED', {
        slotIndex,
        responseId: nativeAd.responseId,
        surface: 'viewer',
      });
    });

    return () => {
      impressionSub.remove();
      clickSub.remove();
    };
  }, [nativeAd, slotIndex]);

  const mediaStyle: ViewStyle = {
    width: width * 0.88,
    height: height * 0.42,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colorScheme === 'dark' ? '#1F2937' : '#F3F4F6',
  };

  return (
    <View
      style={{ width, height }}
      className="items-center justify-center"
    >
      <NativeAdView nativeAd={nativeAd} style={{ width, height }}>
        <View
          style={{
            width,
            height,
            paddingTop: topInset + 56,
            paddingBottom: 120,
            paddingHorizontal: 20,
            borderWidth: 1,
            borderColor: `${accent}55`,
            backgroundColor: colorScheme === 'dark' ? '#000000' : '#0B0B0B',
          }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <View
              style={{
                backgroundColor: cardBg,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: accent,
              }}
            >
              <Text style={{ color: accent, fontSize: 12, fontWeight: '700' }}>
                {t('stories.sponsored')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={onSkip}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(0,0,0,0.45)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="x" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View className="flex-1 items-center justify-center">
            {nativeAd.mediaContent?.hasVideoContent ? (
              <NativeMediaView style={mediaStyle} resizeMode="contain" />
            ) : nativeAd.icon?.url ? (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image
                  source={{ uri: nativeAd.icon.url }}
                  style={mediaStyle}
                  resizeMode="contain"
                />
              </NativeAsset>
            ) : (
              <NativeMediaView style={mediaStyle} resizeMode="contain" />
            )}

            {nativeAd.headline ? (
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text
                  style={{
                    color: textPrimary,
                    fontSize: 20,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginTop: 20,
                  }}
                  numberOfLines={2}
                >
                  {nativeAd.headline}
                </Text>
              </NativeAsset>
            ) : null}

            {nativeAd.body ? (
              <NativeAsset assetType={NativeAssetType.BODY}>
                <Text
                  style={{
                    color: textSecondary,
                    fontSize: 14,
                    textAlign: 'center',
                    marginTop: 8,
                    lineHeight: 20,
                  }}
                  numberOfLines={3}
                >
                  {nativeAd.body}
                </Text>
              </NativeAsset>
            ) : null}
          </View>

          {nativeAd.callToAction ? (
            <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
              <View
                style={{
                  marginTop: 20,
                  backgroundColor: accent,
                  borderRadius: 24,
                  paddingVertical: 14,
                  paddingHorizontal: 24,
                  alignSelf: 'center',
                  minWidth: width * 0.55,
                }}
              >
                <Text
                  style={{
                    color: '#FFFFFF',
                    fontSize: 16,
                    fontWeight: '700',
                    textAlign: 'center',
                  }}
                  numberOfLines={1}
                >
                  {nativeAd.callToAction}
                </Text>
              </View>
            </NativeAsset>
          ) : null}
        </View>
      </NativeAdView>
    </View>
  );
});

export default StoryViewerAdSlide;
