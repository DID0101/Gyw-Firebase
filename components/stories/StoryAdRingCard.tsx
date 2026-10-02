import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Text, View } from 'react-native';
import {
  NativeAd,
  NativeAdEventType,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';

import { useTheme } from '@/contexts/ThemeContext';
import { useThemeClassName } from '@/lib/themeUtils';
import { storyAdLog } from '@/lib/stories/storyAdLog';
import {
  STORY_BORDER_WIDTH,
  STORY_RING_OUTER,
  STORY_SIZE,
} from '@/lib/stories/storyRingLayout';

type StoryAdRingCardProps = {
  nativeAd: NativeAd;
  slotIndex: number;
};

const StoryAdRingCard = memo(function StoryAdRingCard({
  nativeAd,
  slotIndex,
}: StoryAdRingCardProps) {
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const textColor = useThemeClassName('text-black', 'text-white');
  const sponsoredBorder = colorScheme === 'dark' ? '#4A90A4' : '#086da0';

  useEffect(() => {
    storyAdLog('STORY_AD_RENDERED', {
      slotIndex,
      responseId: nativeAd.responseId,
    });

    const impressionSub = nativeAd.addAdEventListener(
      NativeAdEventType.IMPRESSION,
      () => {
        storyAdLog('STORY_AD_IMPRESSION', {
          slotIndex,
          responseId: nativeAd.responseId,
        });
      },
    );
    const clickSub = nativeAd.addAdEventListener(NativeAdEventType.CLICKED, () => {
      storyAdLog('STORY_AD_CLICKED', {
        slotIndex,
        responseId: nativeAd.responseId,
      });
    });

    return () => {
      impressionSub.remove();
      clickSub.remove();
    };
  }, [nativeAd, slotIndex]);

  return (
    <View className="items-center mx-2">
      <NativeAdView nativeAd={nativeAd}>
        <View
          style={{
            width: STORY_RING_OUTER,
            height: STORY_RING_OUTER,
            borderRadius: STORY_RING_OUTER / 2,
            position: 'relative',
            padding: STORY_BORDER_WIDTH,
            backgroundColor: '#FFFFFF',
            borderWidth: STORY_BORDER_WIDTH,
            borderColor: sponsoredBorder,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: STORY_SIZE,
              height: STORY_SIZE,
              borderRadius: STORY_SIZE / 2,
              overflow: 'hidden',
              backgroundColor: colorScheme === 'dark' ? '#2F2F2F' : '#E0E0E0',
            }}
          >
            {nativeAd.mediaContent?.hasVideoContent ? (
              <NativeMediaView
                style={{ width: STORY_SIZE, height: STORY_SIZE }}
                resizeMode="cover"
              />
            ) : nativeAd.icon?.url ? (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image
                  source={{ uri: nativeAd.icon.url }}
                  style={{ width: STORY_SIZE, height: STORY_SIZE }}
                  resizeMode="cover"
                />
              </NativeAsset>
            ) : (
              <NativeMediaView
                style={{ width: STORY_SIZE, height: STORY_SIZE }}
                resizeMode="cover"
              />
            )}
          </View>

          {/* Sponsored badge sits on the story ring itself (blends with the feed). */}
          <View
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              backgroundColor: colorScheme === 'dark' ? '#111827' : '#ffffff',
              borderRadius: 999,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderWidth: 1,
              borderColor: sponsoredBorder,
            }}
          >
            <Text
              className={textColor}
              style={{
                fontSize: 9,
                fontWeight: '700',
                color: sponsoredBorder,
                letterSpacing: 0.2,
              }}
              numberOfLines={1}
            >
              {t('stories.sponsored')}
            </Text>
          </View>

          {nativeAd.headline ? (
            <NativeAsset assetType={NativeAssetType.HEADLINE}>
              <Text
                className={textColor}
                numberOfLines={1}
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  opacity: 0,
                }}
              >
                {nativeAd.headline}
              </Text>
            </NativeAsset>
          ) : null}
        </View>
      </NativeAdView>
    </View>
  );
});

export default StoryAdRingCard;
