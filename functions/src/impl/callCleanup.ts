/**
 * functions/src/impl/callCleanup.ts
 *
 * Two responsibilities:
 *
 * 1. onCallTerminal  (Firestore onUpdate trigger)
 *    Fires when a call document transitions to a terminal status.
 *    Writes a callHistory entry for both the caller and callee.
 *    Schedules deletion of the callSignaling subcollection.
 *
 * 2. deleteStaleCallDocs  (scheduled — daily)
 *    Hard-deletes call documents whose `deleteAfter` timestamp has passed
 *    and purges their callSignaling subcollection.
 *
 * Design notes
 * ────────────
 *  • callHistory is written atomically inside a batch with `set(..., {merge:false})`
 *    so a partial batch never leaves one party with history and the other without.
 *    If the batch fails, the Cloud Function retries (Firestore trigger guarantees
 *    at-least-once delivery); set(merge:false) is idempotent for the same callId.
 *
 *  • Signaling sub-collection deletion uses a recursive-delete helper to avoid
 *    unbounded document reads.  If the signaling collection was already empty
 *    (ICE never started) the delete is a no-op.
 *
 *  • All Timestamps written to callHistory use FieldValue.serverTimestamp() for
 *    fields that don't exist yet and copy the Timestamp from the call doc for
 *    fields that do (to maintain audit-trail fidelity).
 */

import * as admin from "firebase-admin";
import { cancelCallNotification, sendCallEndedDismissFcm } from "./callPushHandler";
import * as functions from "firebase-functions/v1";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDb } from "./adminApp";

// ── Types ─────────────────────────────────────────────────────────────────────

type CallStatus =
  | "ringing" | "answered" | "connecting" | "active"
  | "ended"   | "missed"   | "declined"   | "busy"
  | "canceled" | "timeout" | "rejected" | "accepted";

const TERMINAL_STATUSES = new Set<CallStatus>([
  "ended", "missed", "declined", "busy", "canceled", "timeout", "rejected",
]);

interface CallDocData {
  callId:          string;
  callerId:        string;
  calleeId:        string;
  callType:        "audio" | "video";
  callerName:      string;
  calleeName:      string;
  callerAvatar:    string;
  calleeAvatar:    string;
  chatId:          string | null;
  isRandom:        boolean;
  status:          CallStatus;
  createdAt:       Timestamp;
  answeredAt?:     Timestamp;
  activeAt?:       Timestamp;
  endedAt?:        Timestamp;
  endedBy?:        string;
  duration?:       number | null;
  missedReason?:   string;
  deleteAfter:     Timestamp;
}

interface CallHistoryEntry {
  callId:     string;
  direction:  "incoming" | "outgoing";
  callType:   "audio" | "video";
  status:     "ended" | "missed" | "declined" | "busy" | "canceled" | "timeout";
  peerId:     string;
  peerName:   string;
  peerAvatar: string;
  startedAt:  Timestamp;
  answeredAt: Timestamp | null;
  endedAt:    Timestamp | admin.firestore.FieldValue;
  duration:   number | null;
  chatId:     string | null;
  isRandom:   boolean;
}

// ── 1. onCallTerminal ─────────────────────────────────────────────────────────

/**
 * Triggered whenever calls/{callId} is updated.
 * Skips silently if the new status is not terminal or was already terminal before.
 */
export async function handleOnCallTerminal(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext
): Promise<void> {
  const before = change.before.data() as CallDocData | undefined;
  const after  = change.after.data()  as CallDocData | undefined;

  if (!before || !after) return;

  const newStatus = after.status as CallStatus;
  const oldStatus = before.status as CallStatus;

  // Only act on the first transition into a terminal state.
  if (!TERMINAL_STATUSES.has(newStatus) || TERMINAL_STATUSES.has(oldStatus)) {
    return;
  }

  const db      = getDb();
  const callId  = context.params.callId as string;
  const tag     = `[onCallTerminal/${callId}]`;

  functions.logger.info(`${tag} status=${oldStatus}→${newStatus}`, {
    callerId: after.callerId,
    calleeId: after.calleeId,
  });

  // ── Build the endedAt timestamp ─────────────────────────────────────────

  // Prefer the timestamp already on the document; fall back to server time.
  const endedAt: Timestamp | admin.firestore.FieldValue =
    after.endedAt ?? FieldValue.serverTimestamp();

  // ── Compute duration ────────────────────────────────────────────────────

  let duration: number | null = null;
  if (after.activeAt && after.endedAt) {
    duration = Math.round(
      (after.endedAt.toMillis() - after.activeAt.toMillis()) / 1000
    );
    if (duration < 0) duration = 0;
  }

  const terminalStatus =
    (newStatus === "rejected" ? "declined" : newStatus) as
      "ended" | "missed" | "declined" | "busy" | "canceled" | "timeout";

  // ── Build history entries ────────────────────────────────────────────────

  const callerEntry: CallHistoryEntry = {
    callId,
    direction:  "outgoing",
    callType:   after.callType,
    status:     terminalStatus,
    peerId:     after.calleeId,
    peerName:   after.calleeName   ?? "",
    peerAvatar: after.calleeAvatar ?? "",
    startedAt:  after.createdAt,
    answeredAt: after.answeredAt ?? null,
    endedAt,
    duration,
    chatId:     after.chatId   ?? null,
    isRandom:   after.isRandom ?? false,
  };

  const calleeEntry: CallHistoryEntry = {
    callId,
    direction:  "incoming",
    callType:   after.callType,
    status:     terminalStatus,
    peerId:     after.callerId,
    peerName:   after.callerName   ?? "",
    peerAvatar: after.callerAvatar ?? "",
    startedAt:  after.createdAt,
    answeredAt: after.answeredAt ?? null,
    endedAt,
    duration,
    chatId:     after.chatId   ?? null,
    isRandom:   after.isRandom ?? false,
  };

  // ── Atomic batch write ───────────────────────────────────────────────────

  const callerHistoryRef = db
    .collection("users").doc(after.callerId)
    .collection("callHistory").doc(callId);

  const calleeHistoryRef = db
    .collection("users").doc(after.calleeId)
    .collection("callHistory").doc(callId);

  const batch = db.batch();
  // set(merge:false) — idempotent: retry won't double-write
  batch.set(callerHistoryRef, callerEntry);
  batch.set(calleeHistoryRef, calleeEntry);
  await batch.commit();

  functions.logger.info(`${tag} callHistory written for both parties`);

  // ── Notify the other party immediately (caller must stop ringing on decline/cancel) ──
  await sendTerminalCancelPush(after, newStatus, tag).catch((err) => {
    functions.logger.warn(`${tag} terminal cancel push failed (non-fatal)`, { err });
  });

  // ── Schedule signaling subcollection deletion (fire-and-forget) ──────────
  // Run async so a signaling-delete failure doesn't fail the trigger and
  // doesn't re-trigger the callHistory write on retry.
  _deleteSignalingSubcollection(db, callId).catch((err) => {
    functions.logger.warn(`${tag} signaling delete failed (non-fatal)`, { err });
  });
}

// ── 2. cleanupStaleCalls — ringing docs older than 45s → missed ───────────────

const STALE_RING_MS = 45_000;

/**
 * Marks calls stuck in `ringing` for more than 45 seconds as `missed`.
 * Schedule: every 1 minute (registered as `cleanupStaleCalls` in index.ts).
 */
export async function handleCleanupStaleCalls(): Promise<null> {
  const db = getDb();
  const cutoffMs = Date.now() - STALE_RING_MS;
  const tag = "[cleanupStaleCalls]";

  const snap = await db
    .collection("calls")
    .where("status", "==", "ringing")
    .limit(400)
    .get();

  let batch = db.batch();
  let ops = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    const created = doc.data().createdAt as Timestamp | undefined;
    if (!created || typeof created.toMillis !== "function") continue;
    if (created.toMillis() >= cutoffMs) continue;
    batch.update(doc.ref, {
      status: "missed",
      endedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      missedReason: "server_stale_ring_45s",
    });
    ops++;
    updated++;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  if (updated > 0) {
    functions.logger.info(`${tag} marked missed`, { updated });
  } else {
    functions.logger.debug(`${tag} no stale ringing calls`);
  }
  return null;
}

// ── 3. onCallEnded — dismiss FCM to caller + callee on terminal status ────────

const DISMISS_STATUSES = new Set([
  "ended",
  "cancelled",
  "canceled",
  "missed",
  "declined",
  "rejected",
]);

/**
 * When call status transitions to a terminal dismiss state, send silent
 * `call_ended` FCM to both parties (clears native incoming UI).
 */
export async function handleOnCallEndedDismiss(
  change: functions.Change<functions.firestore.DocumentSnapshot>,
  context: functions.EventContext
): Promise<void> {
  const before = change.before.data() as CallDocData | undefined;
  const after = change.after.data() as CallDocData | undefined;

  if (!before || !after) return;
  if (before.status === after.status) return;

  const newStatus = after.status as CallStatus;
  if (!DISMISS_STATUSES.has(newStatus)) return;

  const callId = context.params.callId as string;
  const tag = `[onCallEnded/${callId}]`;

  functions.logger.info(`${tag} status ${before.status}→${newStatus} — dismiss FCM`);

  const db = getDb();
  const uids = [after.callerId, after.calleeId].filter(Boolean);
  const tokenFetches = uids.map((uid) => db.collection("userTokens").doc(uid).get());
  const tokenDocs = await Promise.all(tokenFetches);

  const tasks: Promise<void>[] = [];
  tokenDocs.forEach((doc, i) => {
    if (!doc.exists) return;
    const uid = uids[i];
    const { fcmToken } = (doc.data() ?? {}) as UserTokenDoc;
    if (fcmToken) {
      tasks.push(sendCallEndedDismissFcm(fcmToken, callId, uid));
    }
  });

  await Promise.all(tasks);
}

// ── 4. deleteStaleCallDocs ────────────────────────────────────────────────────

/**
 * Hard-deletes call documents whose `deleteAfter` field is in the past.
 * Runs daily; processes up to 400 docs per invocation (batched).
 *
 * Schedule: every 24 hours  (registered in index.ts)
 */
export async function handleDeleteStaleCallDocs(): Promise<null> {
  const db  = getDb();
  const now = Timestamp.now();
  const tag = "[deleteStaleCallDocs]";

  const snap = await db
    .collection("calls")
    .where("deleteAfter", "<=", now)
    .limit(400)
    .get();

  if (snap.empty) {
    functions.logger.info(`${tag} no stale docs`);
    return null;
  }

  let deleted = 0;
  let batch   = db.batch();
  let ops     = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    ops++;
    deleted++;

    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops   = 0;
    }

    // Delete the signaling subcollection asynchronously (non-blocking).
    _deleteSignalingSubcollection(db, doc.id).catch((err) => {
      functions.logger.warn(`${tag} signaling delete failed for ${doc.id}`, { err });
    });
  }

  if (ops > 0) await batch.commit();

  functions.logger.info(`${tag} deleted ${deleted} stale call doc(s)`);
  return null;
}

// ── 5. deleteStaleDeviceTokens ────────────────────────────────────────────────

/**
 * Removes device token records that haven't been active in 30 days.
 * Prevents the `initiateCall` CF from sending pushes to abandoned/uninstalled devices.
 *
 * Schedule: every 24 hours  (registered in index.ts)
 */
export async function handleDeleteStaleDeviceTokens(): Promise<null> {
  const db           = getDb();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff       = Timestamp.fromMillis(Date.now() - thirtyDaysMs);
  const tag          = "[deleteStaleDeviceTokens]";

  // Collection-group query across all users' /devices subcollections.
  const snap = await db
    .collectionGroup("devices")
    .where("lastActiveAt", "<=", cutoff)
    .limit(500)
    .get();

  if (snap.empty) {
    functions.logger.info(`${tag} no stale device tokens`);
    return null;
  }

  let deleted = 0;
  let batch   = db.batch();
  let ops     = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    ops++;
    deleted++;

    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops   = 0;
    }
  }

  if (ops > 0) await batch.commit();

  functions.logger.info(`${tag} deleted ${deleted} stale device token(s)`);
  return null;
}

// ── Private helpers ───────────────────────────────────────────────────────────

interface UserTokenDoc {
  fcmToken?: string;
  voipToken?: string;
}

/**
 * When a call becomes terminal (declined, canceled, etc.), push the other party so
 * their device stops ringing even if Firestore listeners are slow or disconnected.
 */
async function sendTerminalCancelPush(
  after: CallDocData,
  newStatus: CallStatus,
  tag: string
): Promise<void> {
  const callId = after.callId;
  const endedBy = after.endedBy;
  let otherUid: string | undefined;
  if (endedBy === after.callerId) {
    otherUid = after.calleeId;
  } else if (endedBy === after.calleeId) {
    otherUid = after.callerId;
  } else if (newStatus === "declined" || newStatus === "rejected" || newStatus === "missed") {
    otherUid = after.callerId;
  } else {
    otherUid = after.calleeId;
  }

  if (!otherUid) {
    functions.logger.warn(`${tag} terminal cancel push skipped — no otherUid`);
    return;
  }

  const tokenDoc = await getDb().collection("userTokens").doc(otherUid).get();
  if (!tokenDoc.exists) return;

  const { fcmToken, voipToken } = (tokenDoc.data() ?? {}) as UserTokenDoc;

  functions.logger.info(`${tag} CALL_DB_TERMINAL_PUSH to=${otherUid} status=${newStatus}`);

  if (fcmToken) {
    await cancelCallNotification(fcmToken, callId, otherUid);
    functions.logger.info(`${tag} CALLER_TERMINAL_FCM_SENT callId=${callId}`);
  }
  if (voipToken) {
    functions.logger.info(`${tag} terminal VoIP cancel skipped in callCleanup callId=${callId}`);
  }
}

/**
 * Recursively deletes all messages inside callSignaling/{callId}/messages.
 * Uses batched deletes of 300 at a time to stay within Firestore limits.
 */
async function _deleteSignalingSubcollection(
  db: admin.firestore.Firestore,
  callId: string
): Promise<void> {
  const colRef = db
    .collection("callSignaling")
    .doc(callId)
    .collection("messages");

  let deleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await colRef.limit(300).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }

  // Delete the parent signaling doc itself if it exists
  await db.collection("callSignaling").doc(callId).delete();

  if (deleted > 0) {
    functions.logger.debug(`[deleteSignaling/${callId}] deleted ${deleted} message(s)`);
  }
}
