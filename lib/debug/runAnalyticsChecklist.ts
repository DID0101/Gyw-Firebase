/**
 * Dev-only helper — fires every Analytics event for DebugView / logcat verification.
 * Trigger: adb shell am start -a android.intent.action.VIEW -d "gyw://analytics-checklist" -n com.gyw1.chat/.MainActivity
 */
import {
  trackChatCreated,
  trackChatOpened,
  trackGroupCreated,
  trackImageSent,
  trackLogin,
  trackLogout,
  trackMessageSent,
  trackProfileViewed,
  trackSignUp,
  trackVideoCallStarted,
  trackVoiceCallStarted,
  trackVoiceMessageSent,
} from '@/lib/services/analyticsService';

export async function runAnalyticsChecklist(): Promise<void> {
  if (!__DEV__) return;

  await trackLogin('phone');
  await trackSignUp('phone');
  await trackChatOpened('checklist_chat_private', 'private');
  await trackChatOpened('checklist_chat_group', 'group');
  await trackChatCreated('checklist_chat_new', 'private');
  await trackGroupCreated('checklist_group', 3);
  await trackMessageSent('text');
  await trackImageSent();
  await trackVoiceMessageSent();
  await trackVoiceCallStarted();
  await trackVideoCallStarted();
  await trackProfileViewed('checklist_user');
  await trackLogout();

  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[AnalyticsChecklist] all events fired');
  }
}
