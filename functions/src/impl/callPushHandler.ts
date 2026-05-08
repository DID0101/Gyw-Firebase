/**
 * functions/src/impl/callPushHandler.ts
 *
 * **Incoming call** wake + UI only — **not** chat messaging. Authoritative call state lives in
 * Firestore `calls/{callId}` (ringing / accepted / …). FCM/APNs here are a **transport** to wake
 * the device and show full-screen / CallKit; WebRTC signaling stays in your signaling layer.
 *
 *   Android → FCM **data-only** (high priority); client native receiver posts full-screen notification
 *   iOS     → APNs **VoIP** push via node-apn (PushKit) — not the same token or path as chat FCM
 *
 * Environment variables (set in Firebase project → Functions → Secrets or .env):
 *   APNS_KEY_P8    — content of the .p8 key file (VoIP push key)
 *   APNS_KEY_ID    — 10-char key ID from Apple Developer portal
 *   APNS_TEAM_ID   — 10-char team ID from Apple Developer portal
 *   IOS_BUNDLE_ID  — e.g. com.tropicolx.signal-clone
 *   NODE_ENV       — "production" for prod APNs gateway; otherwise sandbox
 *
 * Install in functions/:
 *   npm install apn
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { getDb } from "./adminApp";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserTokenDoc {
  fcmToken?:  string;
  voipToken?: string;
  platform?:  "android" | "ios" | "web";
}

interface CallPayload {
  callId:       string;
  callerId:     string;
  callerName:   string;
  callerAvatar: string;
  callType:     string;
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Called from the Firestore onCreate trigger in index.ts.
 * Sends push to all active devices of the receiver.
 */
export async function handleCallCreated(
  callId: string,
  callData: admin.firestore.DocumentData
): Promise<void> {
  const { callerId, receiverId, callType, type, isRandom = false, status } = callData as {
    callerId: string;
    receiverId: string;
    callType?: string;
    type?: string;
    isRandom?: boolean;
    status?: string;
  };
  const normalizedType = callType === "video" || type === "video" ? "video" : "audio";

  // Server-side sanity checks: reject malformed or non-ringing docs to avoid
  // fake/forged call documents from triggering push UI.
  if (!callerId || !receiverId || callerId === receiverId) {
    functions.logger.warn("[callPush] invalid call doc identity", { callId, callerId, receiverId });
    return;
  }
  if (status && status !== "ringing") {
    functions.logger.info("[callPush] skip non-ringing call doc", { callId, status });
    return;
  }

  if (isRandom) {
    // Random calls go through Firestore listeners — no push needed
    return;
  }

  // ── Fetch caller display info ────────────────────────────────────────────
  const callerDoc  = await getDb().collection("users").doc(callerId).get();
  const callerData = callerDoc.data() ?? {};
  const callerName =
    callerData.firstName
      ? `${callerData.firstName} ${callerData.lastName ?? ""}`.trim()
      : "Incoming Call";
  const callerAvatar = callerData.avatar ?? "";

  const payload: CallPayload = {
    callId,
    callerId,
    callerName,
    callerAvatar,
    callType: normalizedType,
  };

  // ── Fetch receiver's push tokens ─────────────────────────────────────────
  const tokenDoc = await getDb().collection("userTokens").doc(receiverId).get();
  if (!tokenDoc.exists) {
    functions.logger.info("[callPush] No tokens for receiver", { receiverId });
    return;
  }

  const { fcmToken, voipToken } = tokenDoc.data() as UserTokenDoc;
  const tasks: Promise<void>[] = [];

  if (fcmToken)  tasks.push(sendAndroidFCM(fcmToken, payload, receiverId));
  if (voipToken) tasks.push(sendIosVoIPPush(voipToken, payload, receiverId));

  await Promise.allSettled(tasks);
}

// ── Android: FCM data-only + high priority ───────────────────────────────────
//
// **Data-only** (no top-level `notification`) so the com.google.android.c2dm.intent.RECEIVE
// broadcast runs when the app is background/killed. The client’s GywFcmCallReceiver then
// posts a local notification with setFullScreenIntent (wake + lock screen) — FCM’s own
// display path cannot set full-screen intents.
//
// Title/body are not sent as a notification payload; the native notifier uses callerName.

async function sendAndroidFCM(
  token: string,
  p: CallPayload,
  receiverId: string
): Promise<void> {
  const message: admin.messaging.Message = {
    token,
    // Data-only (no top-level `notification`) so GywFirebaseMessagingService runs when killed.
    // `type: "incoming_call"` is the canonical contract; native also accepts `call` / `INCOMING_CALL`.
    data: {
      type:         "incoming_call",
      callId:       p.callId,
      callerId:     p.callerId,
      callerName:   p.callerName,
      callerAvatar: p.callerAvatar,
      callType:     p.callType,
    },
    android: {
      priority: "high",
      ttl:      30_000,
    },
  };
  console.log("FCM PAYLOAD:", JSON.stringify(message));

  try {
    const id = await admin.messaging().send(message);
    functions.logger.info("[callPush] Android FCM sent", { messageId: id, callId: p.callId });
  } catch (err: any) {
    functions.logger.error("[callPush] Android FCM error", { error: err?.message, callId: p.callId });

    // Stale token — delete it so we don't retry next call
    if (err?.errorInfo?.code === "messaging/registration-token-not-registered") {
      await getDb()
        .collection("userTokens")
        .doc(receiverId)
        .update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  }
}

// ── iOS: APNs VoIP push (PushKit) ────────────────────────────────────────────

async function sendIosVoIPPush(
  voipToken: string,
  p: CallPayload,
  receiverId: string
): Promise<void> {
  // Lazily load `apn` so non-iOS deployments don't error on missing module
  let apn: any;
  try {
    apn = require("apn");
  } catch {
    functions.logger.warn("[callPush] `apn` module not installed — iOS VoIP push skipped");
    return;
  }

  const keyP8      = process.env.APNS_KEY_P8 ?? "";
  const keyId      = process.env.APNS_KEY_ID ?? "";
  const teamId     = process.env.APNS_TEAM_ID ?? "";
  const bundleId   = process.env.IOS_BUNDLE_ID ?? "com.tropicolx.signal-clone";
  const production = process.env.NODE_ENV === "production";

  if (!keyP8 || !keyId || !teamId) {
    functions.logger.warn("[callPush] APNs credentials not configured — skipping iOS VoIP push");
    return;
  }

  const provider = new apn.Provider({
    token: {
      key:    Buffer.from(keyP8, "utf8"),
      keyId,
      teamId,
    },
    production,
  });

  const note       = new apn.Notification();
  note.topic       = `${bundleId}.voip`;   // VoIP topic = bundleId + ".voip"
  note.pushType    = "voip";
  note.expiry      = Math.floor(Date.now() / 1000) + 30;
  note.payload     = {
    type:         "incoming_call",
    callId:       p.callId,
    callerId:     p.callerId,
    callerName:   p.callerName,
    callerAvatar: p.callerAvatar,
    callType:     p.callType,
  };

  try {
    const result = await provider.send(note, voipToken);
    if (result.failed.length > 0) {
      functions.logger.error("[callPush] APNs VoIP failed", { failed: result.failed, callId: p.callId });
      // Stale VoIP token
      const reason = result.failed[0]?.response?.reason;
      if (reason === "BadDeviceToken" || reason === "Unregistered") {
        await getDb()
          .collection("userTokens")
          .doc(receiverId)
          .update({ voipToken: admin.firestore.FieldValue.delete() });
      }
    } else {
      functions.logger.info("[callPush] APNs VoIP sent", { count: result.sent.length, callId: p.callId });
    }
  } finally {
    provider.shutdown();
  }
}

// ── handleRejectCallAnon ──────────────────────────────────────────────────────

/**
 * Allows the native BroadcastReceiver / CXProviderDelegate to reject a call
 * without an authenticated Firebase token (the user tapped Reject on lock screen).
 *
 * Security: validates that the call is still in "ringing" state before updating.
 * An attacker would need to know a valid callId to abuse this endpoint.
 */
export async function handleRejectCallAnon(
  data: { callId: string },
  _context: functions.https.CallableContext
): Promise<{ ok: boolean }> {
  const { callId } = data ?? {};
  if (!callId || typeof callId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "callId required");
  }

  const callRef = getDb().collection("calls").doc(callId);
  const callDoc = await callRef.get();

  if (!callDoc.exists) {
    functions.logger.warn("[rejectCallAnon] Call not found", { callId });
    return { ok: false };
  }

  const callData = callDoc.data()!;
  if (callData.status !== "ringing") {
    // Already answered, ended, or rejected
    return { ok: false };
  }

  await callRef.update({
    status:    "rejected",
    endedAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info("[rejectCallAnon] Call rejected", { callId });
  return { ok: true };
}
