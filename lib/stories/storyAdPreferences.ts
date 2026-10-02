import AsyncStorage from '@react-native-async-storage/async-storage';

const REDUCED_ADS_KEY = 'gyw_story_ads_reduced_v1';

export async function getStoryAdsReduced(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REDUCED_ADS_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setStoryAdsReduced(reduced: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(REDUCED_ADS_KEY, reduced ? '1' : '0');
  } catch {
    // ignore persistence errors
  }
}
