/**
 * Notifications are intentionally disabled while we rebuild call/message notification UX.
 */

export async function presentMissedCallLocalNotification(params: {
  callId: string;
  callerName: string;
  isVideo: boolean;
}): Promise<void> {
  void params;
  return Promise.resolve();
}
