/**
 * Firebase Analytics — product events for auth, chats, messages, calls, profiles.
 */
import { Platform } from 'react-native';

import { hasRnFirebase } from '@/lib/rnFirebase';
import { markAppStart, markAppStartFail } from '@/lib/debug/appStartupMarkers';

type AnalyticsModule = {
  getAnalytics: () => unknown;
  logEvent: (analytics: unknown, name: string, params?: Record<string, string | number | boolean>) => Promise<void>;
  logAppOpen: (analytics: unknown) => Promise<void>;
  setUserId: (analytics: unknown, id: string | null) => Promise<void>;
  setAnalyticsCollectionEnabled: (analytics: unknown, enabled: boolean) => Promise<void>;
};

let analyticsMod: AnalyticsModule | null = null;
let analyticsInstance: unknown = null;
let initialized = false;

function getAnalyticsInstance(): unknown | null {
  if (Platform.OS === 'web' || !hasRnFirebase) return null;
  if (!analyticsMod) {
    try {
      analyticsMod = require('@react-native-firebase/analytics') as AnalyticsModule;
      analyticsInstance = analyticsMod.getAnalytics();
    } catch {
      analyticsMod = null;
      analyticsInstance = null;
    }
  }
  return analyticsInstance;
}

async function logEvent(name: string, params?: Record<string, string | number | boolean>): Promise<void> {
  const instance = getAnalyticsInstance();
  if (!instance || !analyticsMod) return;
  try {
    await analyticsMod.logEvent(instance, name, params);
  } catch {
    /* non-fatal */
  }
}

/** Enable collection. Safe to call at startup. */
export async function initAnalytics(): Promise<void> {
  if (initialized || Platform.OS === 'web' || !hasRnFirebase) return;
  initialized = true;
  try {
    markAppStart(3);
  } catch (e) {
    markAppStartFail(3, e);
  }
  const instance = getAnalyticsInstance();
  if (!instance || !analyticsMod) return;
  try {
    await analyticsMod.setAnalyticsCollectionEnabled(instance, true);
    await logEvent('app_opened');
  } catch (e) {
    markAppStartFail(3, e, { phase: 'analytics_enable' });
  }
}

export async function setAnalyticsUserId(userId: string | null | undefined): Promise<void> {
  const instance = getAnalyticsInstance();
  if (!instance || !analyticsMod) return;
  try {
    await analyticsMod.setUserId(instance, userId ?? null);
  } catch {
    /* non-fatal */
  }
}

// ── Authentication ───────────────────────────────────────────────────────────

export async function trackSignUp(method: string = 'phone'): Promise<void> {
  await logEvent('sign_up', { method });
}

export async function trackLogin(method: string = 'phone'): Promise<void> {
  await logEvent('login', { method });
}

export async function trackLogout(): Promise<void> {
  await logEvent('logout');
}

// ── Chats ────────────────────────────────────────────────────────────────────

export async function trackChatOpened(chatId: string, type: 'private' | 'group'): Promise<void> {
  await logEvent('chat_opened', {
    chat_id: chatId.slice(0, 36),
    type,
  });
}

export async function trackChatCreated(chatId: string, type: 'private' | 'group'): Promise<void> {
  await logEvent('chat_created', {
    chat_id: chatId.slice(0, 36),
    type,
  });
}

export async function trackGroupCreated(chatId: string, memberCount?: number): Promise<void> {
  await logEvent('group_created', {
    chat_id: chatId.slice(0, 36),
    member_count: memberCount ?? 0,
  });
}

// ── Messages ─────────────────────────────────────────────────────────────────

export type MessageAnalyticsType = 'text' | 'image' | 'voice' | 'video' | 'document' | 'audio';

export async function trackMessageSent(type: MessageAnalyticsType): Promise<void> {
  await logEvent('message_sent', { type });
}

export async function trackImageSent(): Promise<void> {
  await trackMessageSent('image');
}

export async function trackVoiceMessageSent(): Promise<void> {
  await logEvent('voice_message_sent');
}

// ── Calls ────────────────────────────────────────────────────────────────────

export async function trackVoiceCallStarted(): Promise<void> {
  await logEvent('voice_call_started');
}

export async function trackVideoCallStarted(): Promise<void> {
  await logEvent('video_call_started');
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export async function trackProfileViewed(userId?: string): Promise<void> {
  await logEvent('profile_viewed', userId ? { profile_user_id: userId.slice(0, 36) } : undefined);
}
