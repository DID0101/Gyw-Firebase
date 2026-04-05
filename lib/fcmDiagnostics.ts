/**
 * FCM payload + device diagnostics (Android). Use console.error for release logcat.
 */
import { Platform } from 'react-native';

/** Best-effort JSON of RemoteMessage for adb; avoids assuming full type definitions. */
export function serializeFcmRemoteMessage(remoteMessage: Record<string, unknown> | null | undefined): string {
  if (!remoteMessage) return 'null';
  try {
    const n = remoteMessage.notification as Record<string, unknown> | null | undefined;
    const notificationSummary = n
      ? {
          title: n.title,
          body: n.body,
          android: n.android ?? null,
          ios: n.apple ?? n.ios ?? null,
        }
      : null;

    return JSON.stringify({
      messageId: remoteMessage.messageId,
      from: remoteMessage.from,
      to: remoteMessage.to,
      collapseKey: remoteMessage.collapseKey,
      ttl: remoteMessage.ttl,
      sentTime: remoteMessage.sentTime,
      data: remoteMessage.data ?? null,
      notification: notificationSummary,
      hasData: remoteMessage.data != null && Object.keys((remoteMessage.data as object) || {}).length > 0,
      hasNotification: notificationSummary != null,
    });
  } catch (e) {
    return `serializeFcmRemoteMessage_error:${String(e)}`;
  }
}

/** If true, OEM may defer/kill background FCM unless app is battery-unrestricted. */
export function isRestrictedAndroidManufacturer(): boolean {
  if (Platform.OS !== 'android') return false;
  const c = Platform.constants as Record<string, string | undefined>;
  const mfg = `${c.Manufacturer ?? ''} ${c.Brand ?? ''}`.toLowerCase();
  return /xiaomi|redmi|poco|oppo|realme|vivo|huawei|honor|iqoo|tecno|infinix|itel|meizu|blackshark/.test(mfg);
}

export function logFcmAndroidDeviceContext(): void {
  if (Platform.OS !== 'android') return;
  const c = Platform.constants as Record<string, string | number | undefined>;
  const restricted = isRestrictedAndroidManufacturer();
  console.error(
    '[FCM] DEVICE',
    JSON.stringify({
      Manufacturer: c.Manufacturer,
      Brand: c.Brand,
      Model: c.Model,
      Release: c.Release,
      ApiLevel: c.Version,
      restrictedOemHint: restricted,
    })
  );
  if (restricted) {
    console.error(
      '[FCM] OEM hint: disable battery restrictions / allow autostart for reliable data-only FCM when app is killed.'
    );
  }
}

export function classifyFcmDelivery(remoteMessage: Record<string, unknown> | null | undefined): string {
  if (!remoteMessage) return 'empty';
  const hasData = remoteMessageDataKeys(remoteMessage) > 0;
  const hasNotification = remoteMessage.notification != null;
  if (hasNotification && hasData) return 'notification+data (background handler often NOT called on Android when tray notif is shown)';
  if (hasNotification && !hasData) return 'notification-only (background JS handler typically skipped; system displays)';
  if (!hasNotification && hasData) return 'data-only (expect setBackgroundMessageHandler when app background/killed)';
  return 'empty-payload';
}

function remoteMessageDataKeys(remoteMessage: Record<string, unknown>): number {
  const d = remoteMessage.data;
  if (!d || typeof d !== 'object') return 0;
  return Object.keys(d as object).length;
}
