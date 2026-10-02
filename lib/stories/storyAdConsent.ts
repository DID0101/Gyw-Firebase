import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';

import { isStoryAdsSupported } from '@/lib/stories/storyAdConfig';

let consentResolved = false;
let canRequestAds = true;

export async function ensureStoryAdConsent(): Promise<boolean> {
  if (!isStoryAdsSupported()) return false;
  if (consentResolved) return canRequestAds;

  try {
    const info = await AdsConsent.requestInfoUpdate();
    if (
      info.isConsentFormAvailable &&
      info.status === AdsConsentStatus.REQUIRED
    ) {
      await AdsConsent.showForm();
    }
    const status = await AdsConsent.getConsentStatus();
    canRequestAds =
      status === AdsConsentStatus.OBTAINED ||
      status === AdsConsentStatus.NOT_REQUIRED;
  } catch {
    canRequestAds = true;
  }

  consentResolved = true;
  return canRequestAds;
}

export function resetStoryAdConsentCache(): void {
  consentResolved = false;
  canRequestAds = true;
}
