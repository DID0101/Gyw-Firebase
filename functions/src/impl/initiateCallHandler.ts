/**
 * functions/src/impl/initiateCallHandler.ts
 *
 * initiateCall  — creates a call doc + sends FCM (Android) and VoIP APNs (iOS)
 * endCall       — marks a call ended + sends cancellation pushes
 *
 * Token schema used: userTokens/{uid}  { fcmToken?, voipToken?, platform? }
 * (matches the rest of the project — do NOT change to users/{uid}/tokens)
 *
 * Environment variables (set via Firebase Secret Manager or .env.local):
 *   APNS_KEY_P8   — full text of the .p8 VoIP push key from Apple Developer portal
 *   APNS_KEY_ID   — 10-char key ID
 *   APNS_TEAM_ID  — 10-char team ID
 *   IOS_BUNDLE_ID — e.g. com.gyw1.chat
 *   NODE_ENV      — "production" → prod APNs; anything else → sandbox
 */

import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./adminApp";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface InitiateCallRequest {
  callerId:     string;
  calleeId:     string;
  callType:     "audio" | "video";
  roomId:       string;
  callerName:   string;
  callerAvatar: string;
}

export interface EndCallRequest {
  roomId:   string;
  callerId: string; // used to authorise the request
}

interface InitiateCallResponse {
  success: true;
  roomId:  string;
}

interface UserTokenDoc {
  fcmToken?:  string;
  voipToken?: string;
  platform?:  "android" | "ios" | "web";
}

/** Shape stored in calls/{roomId} */
interface CallDoc {
  callerId:     string;
  calleeId:     string;
  /** Alias for calleeId — kept for backward-compatibility with client code
   *  that reads `receiverId` (call screen, call history, Firestore indexes). */
  receiverId:   string;
  /** Backward-compat alias used by RN call screen. */
  type:         "audio" | "video";
  callType:     "audio" | "video";
  callerName:   string;
  callerAvatar: string;
  status:
    | "ringing"
    | "accepted"
    | "connecting"
    | "active"
    | "ended"
    | "declined"
    | "canceled"
    | "timeout"
    | "missed"
    | "busy";
  answeredAt?: admin.firestore.Timestamp;
  connectingAt?: admin.firestore.Timestamp;
  activeAt?: admin.firestore.Timestamp;
  createdAt:    admin.firestore.FieldValue;
  updatedAt:    admin.firestore.FieldValue;
  /** Logical TTL field — markStaleRingingCallsMissed cleans docs past this time */
  expiresAt:    admin.firestore.Timestamp;
}

/** Internal push payload shared between FCM and APNs paths */
interface PushCallPayload {
  type:         "INCOMING_CALL" | "CALL_CANCELLED";
  callId:       string;          // same as roomId
  callerId:     string;
  callerName:   string;
  callerAvatar: string;
  callType:     "audio" | "video";
}

// ── Retry utility ─────────────────────────────────────────────────────────────

interface RetryOptions {
  maxAttempts?: number; // default 3
  baseDelayMs?: number; // default 300
  /** Return true to stop retrying early (e.g. permanent error) */
  isTerminal?: (err: unknown) => boolean;
}

/**
 * Runs `fn` with exponential back-off (full-jitter strategy).
 * Throws the last error if all attempts are exhausted.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 300, isTerminal } = opts;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isTerminal?.(err)) throw err;
      if (attempt === maxAttempts) break;

      // Full-jitter back-off: random(0, base * 2^(attempt-1))
      const cap   = baseDelayMs * Math.pow(2, attempt - 1);
      const delay = Math.random() * cap;
      functions.logger.warn(`[withRetry] attempt ${attempt} failed, retrying in ${Math.round(delay)}ms`, {
        error: (err as Error)?.message,
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Returns true for permanent FCM/APNs errors that must not be retried. */
function isFcmTerminal(err: unknown): boolean {
  const code = (err as any)?.errorInfo?.code as string | undefined;
  return [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
  ].includes(code ?? "");
}

// ── initiateCall handler ──────────────────────────────────────────────────────

export async function handleInitiateCall(
  data: InitiateCallRequest,
  context: functions.https.CallableContext
): Promise<InitiateCallResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  if (context.auth.uid !== data.callerId) {
    throw new functions.https.HttpsError("permission-denied", "callerId must match authenticated user");
  }

  // ── Validate input ───────────────────────────────────────────────────────
  const { callerId, calleeId, callType, roomId, callerName, callerAvatar } = data ?? {};

  if (!callerId || !calleeId || !roomId) {
    throw new functions.https.HttpsError("invalid-argument", "callerId, calleeId and roomId are required");
  }
  if (callType !== "audio" && callType !== "video") {
    throw new functions.https.HttpsError("invalid-argument", "callType must be 'audio' or 'video'");
  }
  if (callerId === calleeId) {
    throw new functions.https.HttpsError("invalid-argument", "callerId and calleeId must differ");
  }

  const db = getDb();

  // ── Check callee exists ───────────────────────────────────────────────────
  const calleeDoc = await db.collection("users").doc(calleeId).get();
  if (!calleeDoc.exists) {
    throw new functions.https.HttpsError("not-found", `User ${calleeId} not found`);
  }

  // ── Prevent duplicate ringing calls for the same room ────────────────────
  const existingCall = await db.collection("calls").doc(roomId).get();
  if (existingCall.exists && existingCall.data()?.status === "ringing") {
    // Idempotent — caller tapped "call" twice
    return { success: true, roomId };
  }

  // ── Fetch callee tokens ───────────────────────────────────────────────────
  const tokenDoc = await db.collection("userTokens").doc(calleeId).get();
  const { fcmToken, voipToken } = (tokenDoc.data() ?? {}) as UserTokenDoc;

  if (!fcmToken && !voipToken) {
    functions.logger.info("[initiateCall] Callee has no push tokens — call will still be written", {
      calleeId,
      roomId,
    });
  }

  // ── Write calls/{roomId} with 60-second TTL ───────────────────────────────
  const TTL_SECONDS = 30;
  const expiresAt   = admin.firestore.Timestamp.fromMillis(Date.now() + TTL_SECONDS * 1000);

  const callDocData: CallDoc = {
    callerId,
    calleeId,
    receiverId: calleeId,  // alias — client screens read receiverId; new code should use calleeId
    type: callType,
    callType,
    callerName:   callerName   ?? "",
    callerAvatar: callerAvatar ?? "",
    status:       "ringing",
    createdAt:    FieldValue.serverTimestamp(),
    updatedAt:    FieldValue.serverTimestamp(),
    expiresAt,
  };

  await withRetry(() => db.collection("calls").doc(roomId).set(callDocData), {
    maxAttempts: 3,
    baseDelayMs: 200,
  });

  functions.logger.info("[initiateCall] Call doc written", { roomId, callerId, calleeId, callType });

  // ── Push (fire-and-forget — write already committed) ─────────────────────
  const payload: PushCallPayload = {
    type:         "INCOMING_CALL",
    callId:       roomId,
    callerId,
    callerName:   callerName   ?? "",
    callerAvatar: callerAvatar ?? "",
    callType,
  };

  const pushTasks: Promise<void>[] = [];

  if (fcmToken) {
    pushTasks.push(sendAndroidFCM(fcmToken, payload, calleeId));
  }
  if (voipToken) {
    pushTasks.push(sendIosVoIPPush(voipToken, payload, calleeId));
  }

  // allSettled — a push failure must not roll back the call doc
  const results = await Promise.allSettled(pushTasks);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      functions.logger.error(`[initiateCall] push task ${i} rejected`, { reason: r.reason });
    }
  });

  return { success: true, roomId };
}

// ── endCall handler ───────────────────────────────────────────────────────────

export async function handleEndCall(
  data: EndCallRequest,
  context: functions.https.CallableContext
): Promise<{ success: true }> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }

  const { roomId } = data ?? {};
  if (!roomId) {
    throw new functions.https.HttpsError("invalid-argument", "roomId is required");
  }

  const db      = getDb();
  const callRef = db.collection("calls").doc(roomId);
  const callDoc = await callRef.get();

  if (!callDoc.exists) {
    // Already cleaned up — idempotent OK
    return { success: true };
  }

  const callData = callDoc.data()!;

  // Only the caller or callee may end the call
  if (
    context.auth.uid !== callData.callerId &&
    context.auth.uid !== callData.calleeId
  ) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only the caller or callee can end this call"
    );
  }

  // Skip if already terminal — idempotent
  const terminalStatuses = ["ended", "missed", "declined", "canceled", "timeout", "busy"];
  if (terminalStatuses.includes(callData.status)) {
    return { success: true };
  }

  const authUid = context.auth?.uid as string;
  const nextStatus = callData.status === "ringing" ? "canceled" : "ended";

  await withRetry(
    () =>
      callRef.update({
        status:    nextStatus,
        endedAt:   FieldValue.serverTimestamp(),
        endedBy:   authUid,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    { maxAttempts: 3, baseDelayMs: 200 }
  );

  functions.logger.info("[endCall] Call ended", { roomId, status: nextStatus });

  // ── Cancellation push to the OTHER party ─────────────────────────────────
  // Determine who to notify: if the caller is ending, notify the callee and vice-versa.
  const otherUid = authUid === callData.callerId ? callData.calleeId : callData.callerId;

  const tokenDoc = await db.collection("userTokens").doc(otherUid).get();
  const { fcmToken, voipToken } = (tokenDoc.data() ?? {}) as UserTokenDoc;

  const cancelPayload: PushCallPayload = {
    type:         "CALL_CANCELLED",
    callId:       roomId,
    callerId:     callData.callerId,
    callerName:   callData.callerName   ?? "",
    callerAvatar: callData.callerAvatar ?? "",
    callType:     callData.callType     ?? "audio",
  };

  const cancelTasks: Promise<void>[] = [];
  if (fcmToken)  cancelTasks.push(sendAndroidFCM(fcmToken, cancelPayload, otherUid));
  if (voipToken) cancelTasks.push(sendIosVoIPPush(voipToken, cancelPayload, otherUid));

  await Promise.allSettled(cancelTasks);

  return { success: true };
}

// ── transitionCallState handler ───────────────────────────────────────────────

type TransitionTarget =
  | "accepted"
  | "connecting"
  | "active"
  | "declined"
  | "missed"
  | "timeout"
  | "ended"
  | "canceled"
  | "busy";

interface TransitionCallStateRequest {
  roomId: string;
  nextStatus: TransitionTarget;
  duration?: number;
}

export async function handleTransitionCallState(
  data: TransitionCallStateRequest,
  context: functions.https.CallableContext
): Promise<{ success: true; status: string }> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }
  const { roomId, nextStatus, duration } = data ?? {};
  if (!roomId || !nextStatus) {
    throw new functions.https.HttpsError("invalid-argument", "roomId and nextStatus are required");
  }

  const db = getDb();
  const callRef = db.collection("calls").doc(roomId);
  const snap = await callRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError("not-found", "Call not found");
  }
  const callData = snap.data() as CallDoc;
  const uid = context.auth.uid;
  const isCaller = uid === callData.callerId;
  const isCallee = uid === callData.calleeId || uid === callData.receiverId;
  if (!isCaller && !isCallee) {
    throw new functions.https.HttpsError("permission-denied", "Not a participant of this call");
  }

  const normalize = (s: string) => (s === "rejected" ? "declined" : s === "answered" ? "accepted" : s);
  const current = normalize(callData.status);
  const next = normalize(nextStatus);
  const terminal = new Set(["ended", "declined", "missed", "timeout", "busy", "canceled"]);
  if (terminal.has(current)) {
    return { success: true, status: current };
  }

  const allowedByRole: Record<string, Array<TransitionTarget>> = {
    caller: ["ended", "canceled", "busy"],
    callee: ["accepted", "connecting", "active", "declined", "missed", "timeout", "ended"],
  };
  const allowed = new Set(isCaller ? allowedByRole.caller : allowedByRole.callee);
  if (!allowed.has(next as TransitionTarget)) {
    throw new functions.https.HttpsError("permission-denied", `Transition ${current}->${next} not allowed`);
  }

  // Simple state ordering guard to avoid rapid race regressions.
  const order = ["ringing", "accepted", "connecting", "active"];
  if (order.includes(current) && order.includes(next)) {
    if (order.indexOf(next) < order.indexOf(current)) {
      return { success: true, status: current };
    }
  }

  const update: Record<string, unknown> = {
    status: next,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (next === "accepted" && !callData.answeredAt) update.answeredAt = FieldValue.serverTimestamp();
  if (next === "connecting" && !callData.connectingAt) update.connectingAt = FieldValue.serverTimestamp();
  if (next === "active" && !callData.activeAt) update.activeAt = FieldValue.serverTimestamp();
  if (terminal.has(next)) {
    update.endedAt = FieldValue.serverTimestamp();
    update.endedBy = uid;
  }
  if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
    update.duration = Math.floor(duration);
  }

  await callRef.update(update);
  functions.logger.info("[transitionCallState] updated", { roomId, from: current, to: next, by: uid });
  return { success: true, status: next };
}

// ── Android: FCM data-only high-priority ─────────────────────────────────────

async function sendAndroidFCM(
  token:      string,
  p:          PushCallPayload,
  receiverId: string
): Promise<void> {
  const message: admin.messaging.Message = {
    token,
    // No top-level `notification` — keeps this as a data-only message so
    // GywFirebaseMessagingService (or CallFirebaseMessagingService) handles it
    // even when the app is killed, without the OS showing a default banner.
    data: {
      type:         p.type,
      callId:       p.callId,
      callerId:     p.callerId,
      callerName:   p.callerName,
      callerAvatar: p.callerAvatar,
      callType:     p.callType,
    },
    android: {
      priority: "high",
      ttl:      30_000, // 30s — call is irrelevant after that
    },
  };

  await withRetry(
    () => admin.messaging().send(message),
    {
      maxAttempts: 3,
      baseDelayMs: 300,
      isTerminal:  isFcmTerminal,
    }
  )
    .then((messageId) => {
      functions.logger.info("[callPush] Android FCM sent", { messageId, callId: p.callId });
    })
    .catch(async (err: any) => {
      functions.logger.error("[callPush] Android FCM failed (all retries)", {
        error:  err?.message,
        code:   err?.errorInfo?.code,
        callId: p.callId,
      });
      // Stale token — evict so next call doesn't attempt it
      if (isFcmTerminal(err)) {
        await evictToken(receiverId, "fcmToken");
      }
    });
}

// ── iOS: APNs VoIP push via node-apn ─────────────────────────────────────────
//
// Why not admin.messaging().send() with apns headers?
// FCM's HTTP v1 API routes through Firebase → APNs, which works for *alert*
// pushes but cannot send VoIP (pushType: voip) or reach PushKit.  PushKit
// requires hitting APNs directly with the VoIP certificate/key — hence node-apn.

async function sendIosVoIPPush(
  voipToken:  string,
  p:          PushCallPayload,
  receiverId: string
): Promise<void> {
  let apn: any;
  try {
    apn = require("apn");
  } catch {
    functions.logger.warn("[callPush] `apn` module not installed — iOS VoIP push skipped");
    return;
  }

  const keyP8      = process.env.APNS_KEY_P8   ?? "";
  const keyId      = process.env.APNS_KEY_ID    ?? "";
  const teamId     = process.env.APNS_TEAM_ID   ?? "";
  const bundleId   = process.env.IOS_BUNDLE_ID  ?? "com.gyw1.chat";
  const production = process.env.NODE_ENV === "production";

  if (!keyP8 || !keyId || !teamId) {
    functions.logger.warn("[callPush] APNs credentials not set (APNS_KEY_P8 / APNS_KEY_ID / APNS_TEAM_ID)");
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

  // ── Build APNs notification ──────────────────────────────────────────────
  // apns-push-type: voip   → required header for PushKit delivery
  // apns-priority:  10     → immediate delivery (5 = conserve power)
  // apns-topic: <bundle>.voip → MUST be the VoIP subtopic, not the main bundle
  const note            = new apn.Notification();
  note.topic            = `${bundleId}.voip`;
  note.pushType         = "voip";                          // maps to apns-push-type header
  note.priority         = 10;                              // maps to apns-priority header
  note.expiry           = Math.floor(Date.now() / 1000) + 30;
  note.payload          = {
    type:         p.type,
    callId:       p.callId,
    callerId:     p.callerId,
    callerName:   p.callerName,
    callerAvatar: p.callerAvatar,
    callType:     p.callType,
  };

  try {
    const result = await withRetry(
      () => provider.send(note, voipToken) as Promise<{ sent: unknown[]; failed: Array<{ response?: { reason?: string } }> }>,
      {
        maxAttempts: 3,
        baseDelayMs: 300,
        isTerminal: (_err) => false, // provider.send doesn't throw — check result.failed instead
      }
    );

    if (result.failed.length > 0) {
      const reason = result.failed[0]?.response?.reason;
      functions.logger.error("[callPush] APNs VoIP failed", { reason, callId: p.callId });
      if (reason === "BadDeviceToken" || reason === "Unregistered") {
        await evictToken(receiverId, "voipToken");
      }
    } else {
      functions.logger.info("[callPush] APNs VoIP sent", {
        sent:   result.sent.length,
        callId: p.callId,
      });
    }
  } finally {
    // Always shut down to release the underlying TLS connection pool
    provider.shutdown();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Remove a stale push token from Firestore so it is not used for future calls. */
async function evictToken(userId: string, field: "fcmToken" | "voipToken"): Promise<void> {
  try {
    await getDb()
      .collection("userTokens")
      .doc(userId)
      .update({ [field]: FieldValue.delete() });
    functions.logger.info("[callPush] evicted stale token", { userId, field });
  } catch (err) {
    functions.logger.warn("[callPush] evictToken failed (non-fatal)", {
      userId,
      field,
      error: (err as Error)?.message,
    });
  }
}
