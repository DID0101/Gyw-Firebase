/**
 * functions/src/impl/callPushHandler.ts
 *
 * Incoming call FCM (Android data-only + high priority) and VoIP (iOS).
 * Authoritative call state remains in Firestore `calls/{callId}`.
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { getDb } from "./adminApp";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserTokenDoc {
  fcmToken?: string;
  voipToken?: string;
  platform?: "android" | "ios" | "web";
}

export interface IncomingCallPushPayload {
  callId: string;
  callType: "audio" | "video";
  callerUid: string;
  callerName: string;
  /** Caller's registered app phone — used for on-device contact matching only. */
  callerPhone?: string;
  callerPhotoURL: string;
  timestamp: number;
}

/** @deprecated Use IncomingCallPushPayload — kept for internal callers */
interface CallPayload {
  callId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string;
  callType: string;
}

const RING_TTL_MS = 30_000;

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleCallCreated(
  callId: string,
  callData: admin.firestore.DocumentData
): Promise<void> {
  const {
    callerId,
    receiverId,
    callType,
    type,
    isRandom = false,
    status,
  } = callData as {
    callerId: string;
    receiverId: string;
    callType?: string;
    type?: string;
    isRandom?: boolean;
    status?: string;
  };
  const normalizedType =
    callType === "video" || type === "video" ? "video" : "audio";

  if (!callerId || !receiverId || callerId === receiverId) {
    functions.logger.warn("[callPush] invalid call doc identity", {
      callId,
      callerId,
      receiverId,
    });
    return;
  }
  if (status && status !== "ringing") {
    functions.logger.info("[callPush] skip non-ringing call doc", { callId, status });
    return;
  }
  if (isRandom) return;

  if (callData.deferIncomingPush === true || callData.incomingPushSent === true) {
    functions.logger.info("[callPush] skip onCreate — deferred to notifyIncomingCall", {
      callId,
    });
    return;
  }

  const callerDoc = await getDb().collection("users").doc(callerId).get();
  const callerData = callerDoc.data() ?? {};
  const callerName =
    callerData.firstName
      ? `${callerData.firstName} ${callerData.lastName ?? ""}`.trim()
      : "Incoming Call";
  const callerPhone =
    typeof callerData.phoneNumber === "string" ? callerData.phoneNumber.trim() : "";
  const callerPhotoURL =
    (callerData.avatar as string) ??
    (callerData.photoURL as string) ??
    "";

  const timestamp = Date.now();

  functions.logger.info("CALLER_META_PAYLOAD", {
    callId,
    callType: normalizedType,
    callerUid: callerId,
    callerName,
    callerPhotoURL: callerPhotoURL ? "[present]" : "",
  });

  const tokenDoc = await getDb().collection("userTokens").doc(receiverId).get();
  if (!tokenDoc.exists) {
    functions.logger.info("[callPush] No tokens for receiver", { receiverId });
    return;
  }

  const { fcmToken, voipToken } = tokenDoc.data() as UserTokenDoc;
  const tasks: Promise<void>[] = [];

  if (fcmToken) {
    tasks.push(
      sendIncomingCallFcm(fcmToken, {
        callId,
        callType: normalizedType,
        callerUid: callerId,
        callerName,
        callerPhone,
        callerPhotoURL,
        timestamp,
      }, receiverId)
    );
  }
  if (voipToken) {
    tasks.push(
      sendIosVoIPPush(
        voipToken,
        {
          callId,
          callerId,
          callerName,
          callerAvatar: callerPhotoURL,
          callType: normalizedType,
        },
        receiverId
      )
    );
  }

  await Promise.allSettled(tasks);
}

// ── Android: data-only + high priority (killed-app wake) ─────────────────────

/**
 * Sends a data-only FCM message — no top-level `notification` key.
 * Required for GywFirebaseMessagingService when the app is killed.
 */
export async function sendIncomingCallFcm(
  token: string,
  payload: IncomingCallPushPayload,
  receiverId: string
): Promise<void> {
  const message: admin.messaging.Message = {
    token,
    data: {
      type: "incoming_call",
      callId: payload.callId,
      callType: payload.callType,
      callerUid: payload.callerUid,
      callerName: payload.callerName,
      callerPhone: payload.callerPhone ?? "",
      callerPhotoURL: payload.callerPhotoURL ?? "",
      timestamp: String(payload.timestamp),
      // Legacy keys — native + JS handlers accept both
      callerId: payload.callerUid,
      callerAvatar: payload.callerPhotoURL ?? "",
    },
    android: {
      priority: "high",
      ttl: RING_TTL_MS,
    },
  };

  functions.logger.info("[callPush] FCM incoming_call payload", {
    callId: payload.callId,
    callType: payload.callType,
    message: JSON.stringify(message),
  });

  try {
    const id = await admin.messaging().send(message);
    const sentAt = Date.now();
    functions.logger.info("[callPush] FCM_SENT", {
      messageId: id,
      callId: payload.callId,
      sentAt,
      latencyFromPayloadMs: sentAt - payload.timestamp,
    });
  } catch (err: unknown) {
    const error = err as { message?: string; errorInfo?: { code?: string } };
    functions.logger.error("[callPush] Android FCM error", {
      error: error?.message,
      callId: payload.callId,
    });
    if (error?.errorInfo?.code === "messaging/registration-token-not-registered") {
      await getDb()
        .collection("userTokens")
        .doc(receiverId)
        .update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  }
}

/**
 * Dismiss incoming-call UI on the callee device (caller cancelled / timeout / etc.).
 */
/**
 * Silent data-only push so both parties dismiss lingering incoming-call UI.
 */
export async function sendCallEndedDismissFcm(
  token: string,
  callId: string,
  userId?: string
): Promise<void> {
  const message: admin.messaging.Message = {
    token,
    data: {
      type: "call_ended",
      callId,
    },
    android: {
      priority: "high",
      ttl: RING_TTL_MS,
    },
  };

  try {
    await admin.messaging().send(message);
    functions.logger.info("[callPush] call_ended dismiss FCM sent", { callId, userId });
  } catch (err: unknown) {
    const error = err as { message?: string; errorInfo?: { code?: string } };
    functions.logger.warn("[callPush] call_ended dismiss FCM error", {
      callId,
      userId,
      error: error?.message,
    });
    if (
      userId &&
      error?.errorInfo?.code === "messaging/registration-token-not-registered"
    ) {
      await getDb()
        .collection("userTokens")
        .doc(userId)
        .update({ fcmToken: admin.firestore.FieldValue.delete() });
    }
  }
}

export async function cancelCallNotification(
  token: string,
  callId: string,
  receiverId?: string
): Promise<void> {
  const message: admin.messaging.Message = {
    token,
    data: {
      type: "call_cancelled",
      callId,
    },
    android: {
      priority: "high",
      ttl: RING_TTL_MS,
    },
  };

  functions.logger.info("[callPush] FCM call_cancelled", {
    callId,
    message: JSON.stringify(message),
  });

  try {
    await admin.messaging().send(message);
    functions.logger.info("[callPush] Android cancel FCM sent", { callId });
  } catch (err: unknown) {
    const error = err as { message?: string; errorInfo?: { code?: string } };
    functions.logger.error("[callPush] Android cancel FCM error", {
      error: error?.message,
      callId,
    });
    if (
      receiverId &&
      error?.errorInfo?.code === "messaging/registration-token-not-registered"
    ) {
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
  let apn: any;
  try {
    apn = require("apn");
  } catch {
    functions.logger.warn("[callPush] `apn` module not installed — iOS VoIP push skipped");
    return;
  }

  const keyP8 = process.env.APNS_KEY_P8 ?? "";
  const keyId = process.env.APNS_KEY_ID ?? "";
  const teamId = process.env.APNS_TEAM_ID ?? "";
  const bundleId = process.env.IOS_BUNDLE_ID ?? "com.tropicolx.signal-clone";
  const production = process.env.NODE_ENV === "production";

  if (!keyP8 || !keyId || !teamId) {
    functions.logger.warn("[callPush] APNs credentials not configured — skipping iOS VoIP push");
    return;
  }

  const provider = new apn.Provider({
    token: {
      key: Buffer.from(keyP8, "utf8"),
      keyId,
      teamId,
    },
    production,
  });

  const note: any = new apn.Notification();
  note.topic = `${bundleId}.voip`;
  note.pushType = "voip";
  note.expiry = Math.floor(Date.now() / 1000) + 30;
  note.payload = {
    type: "incoming_call",
    callId: p.callId,
    callerId: p.callerId,
    callerName: p.callerName,
    callerAvatar: p.callerAvatar,
    callType: p.callType,
  };

  try {
    const result = await provider.send(note, voipToken);
    if (result.failed.length > 0) {
      functions.logger.error("[callPush] APNs VoIP failed", {
        failed: result.failed,
        callId: p.callId,
      });
      const reason = result.failed[0]?.response?.reason;
      if (reason === "BadDeviceToken" || reason === "Unregistered") {
        await getDb()
          .collection("userTokens")
          .doc(receiverId)
          .update({ voipToken: admin.firestore.FieldValue.delete() });
      }
    } else {
      functions.logger.info("[callPush] APNs VoIP sent", {
        count: result.sent.length,
        callId: p.callId,
      });
    }
  } finally {
    provider.shutdown();
  }
}

// ── handleRejectCallAnon ──────────────────────────────────────────────────────

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
    return { ok: false };
  }

  await callRef.update({
    status: "rejected",
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info("[rejectCallAnon] Call rejected", { callId });
  return { ok: true };
}
