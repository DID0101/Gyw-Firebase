/**
 * Firebase Cloud Functions
 *
 * Deploy: firebase deploy --only functions
 * Requires: Firebase project, firebase-admin credentials
 */

import * as admin from "firebase-admin";
import type {
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";

// Initialize Firebase Admin at module load (required for callables)
if (!admin.apps?.length) {
  admin.initializeApp();
}

let _db: admin.firestore.Firestore | null = null;
function getDb() {
  if (!_db) {
    _db = admin.firestore();
  }
  return _db;
}

// ----- Random (Omegle-style) video chat matchmaking -----

const RANDOM_QUEUE = "randomQueue";
const STALE_QUEUE_SECONDS = 30;

type TryMatchRequest = { queueDocId: string; userId: string };
type TryMatchResponse =
  | { matched: true; callId: string; otherUserId: string }
  | { matched: false };

/** VISIBILITY_PROOF_MODE: No matching. Only fetch & return what Admin SDK sees. For queue visibility proof. v2 */
const VISIBILITY_PROOF_MODE = false;

/** MINIMAL_MATCHING_MODE: All filters disabled. Only self-exclusion. For diagnostic isolation. */
const MINIMAL_MATCHING_MODE = true;

/** Callable: try to match the user with another waiting user in random queue. (v1/1st Gen) */
export const tryRandomMatch = functions
  .region("us-central1")
  .https.onCall(
  async (data: TryMatchRequest, context: functions.https.CallableContext): Promise<TryMatchResponse | { visibleQueueSize: number; visibleDocIds: string[] }> => {
    const serverTimeMs = Date.now();
    const DIAG_TAG = "[tryRandomMatch:diag]";
    const MIN_TAG = "[tryRandomMatch:MINIMAL]";
    const VIS_TAG = "[tryRandomMatch:VISIBILITY_PROOF]";

    functions.logger.info(`${DIAG_TAG} INVOKED`, {
      callerUid: context.auth?.uid ?? null,
      hasAuth: !!context.auth,
      serverTimeMs,
      visibilityProofMode: VISIBILITY_PROOF_MODE,
      minimalMode: MINIMAL_MATCHING_MODE,
    });

    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }
    const uid = context.auth.uid;
    const { queueDocId, userId } = data ?? {};
    if (!queueDocId || !userId || uid !== userId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "queueDocId and userId required; userId must match caller"
      );
    }

    // VISIBILITY PROOF: Fetch entire randomQueue, log everything, return visibility only. No match, no transaction.
    if (VISIBILITY_PROOF_MODE) {
      const snapshot = await getDb().collection(RANDOM_QUEUE).get();
      const totalDocs = snapshot.docs.length;
      const docIds = snapshot.docs.map((d) => d.id);
      const docDataList = snapshot.docs.map((d) => ({
        id: d.id,
        data: d.data(),
      }));

      functions.logger.info(`${VIS_TAG} RESULT`, {
        callerUid: userId,
        totalDocs,
        docIds,
        docDataList,
      });

      return {
        visibleQueueSize: totalDocs,
        visibleDocIds: docIds,
      };
    }

    const queueRef = getDb().collection(RANDOM_QUEUE).doc(queueDocId);
    const myDoc = await queueRef.get();
    if (!myDoc.exists || myDoc.data()?.status !== "waiting") {
      functions.logger.info(`${MIN_TAG} NO_MATCH`, {
        reason: "caller_not_in_queue_or_not_waiting",
        myDocExists: myDoc.exists,
        myStatus: myDoc.data()?.status ?? null,
      });
      return { matched: false };
    }

    const allQueueSnapshot = await getDb().collection(RANDOM_QUEUE).get();
    const waitingDocs = MINIMAL_MATCHING_MODE
      ? allQueueSnapshot.docs.filter((d) => d.data()?.status === "waiting")
      : allQueueSnapshot.docs;

    functions.logger.info(`${MIN_TAG} QUEUE_SIZE`, {
      totalDocs: allQueueSnapshot.docs.length,
      waitingDocs: waitingDocs.length,
      docIds: waitingDocs.map((d) => d.id),
      callerUid: userId,
    });

    let otherDoc: QueryDocumentSnapshot | null = null;
    let otherUserId: string | null = null;
    for (const docSnap of waitingDocs) {
      if (docSnap.id === queueDocId) continue;
      const otherId = docSnap.data()?.userId ?? docSnap.id;
      if (otherId === userId) continue;
      otherDoc = docSnap;
      otherUserId = otherId;
      break;
    }

    if (!otherDoc || !otherUserId) {
      functions.logger.info(`${MIN_TAG} NO_MATCH`, {
        reason: "no_other_candidate",
        queueSize: waitingDocs.length,
      });
      return { matched: false };
    }

    functions.logger.info(`${MIN_TAG} CANDIDATE_SELECTED`, {
      candidateUid: otherUserId,
      queueSize: waitingDocs.length,
    });

    let transactionAttempt = 0;
    let abortReason: string | null = null;

    try {
      const callId = await getDb().runTransaction(async (transaction: Transaction) => {
        transactionAttempt += 1;
        functions.logger.info(`${MIN_TAG} TRANSACTION_ATTEMPT`, {
          attempt: transactionAttempt,
          callerUid: userId,
          otherUid: otherUserId,
        });

        const myQueueDoc = await transaction.get(queueRef);
        const otherQueueDoc = await transaction.get(otherDoc!.ref);

        if (!myQueueDoc.exists || myQueueDoc.data()?.status !== "waiting") {
          abortReason = "my_queue_entry_no_longer_valid";
          throw new Error(abortReason);
        }
        if (!otherQueueDoc.exists || otherQueueDoc.data()?.status !== "waiting") {
          abortReason = "other_queue_entry_no_longer_valid";
          throw new Error(abortReason);
        }

        const callRef = getDb().collection("calls").doc();
        transaction.set(callRef, {
          callerId: userId,
          receiverId: otherUserId,
          type: "video",
          status: "ringing",
          isRandom: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.delete(queueRef);
        transaction.delete(otherDoc!.ref);

        return callRef.id;
      });

      functions.logger.info(`${MIN_TAG} TRANSACTION_COMMITTED`, {
        callId,
        callerUid: userId,
        receiverUid: otherUserId,
        transactionAttempts: transactionAttempt,
      });

      const callDoc = await getDb().collection("calls").doc(callId).get();
      const callerInQueue = await queueRef.get();
      const otherInQueue = await getDb().collection(RANDOM_QUEUE).doc(otherUserId!).get();

      functions.logger.info(`${MIN_TAG} POST_MATCH_VALIDATION`, {
        callDocId: callId,
        callDocExists: callDoc.exists,
        callerRemovedFromQueue: !callerInQueue.exists,
        otherRemovedFromQueue: !otherInQueue.exists,
      });

      return {
        matched: true,
        callId,
        otherUserId,
      };
    } catch (err: unknown) {
      const e = err as Error;
      functions.logger.warn(`${MIN_TAG} TRANSACTION_ABORTED`, {
        abortReason: abortReason ?? e?.message ?? "unknown",
        transactionAttempts: transactionAttempt,
        errorMessage: e?.message,
        callerUid: userId,
        otherUid: otherUserId,
      });
      return { matched: false };
    }
  }
);

/** Callable: Check and record skip action. Returns true if allowed, false if rate limited. */
export const checkSkipRateLimit = functions.https.onCall(
  async (data: { userId: string }, context: functions.https.CallableContext): Promise<{ allowed: boolean }> => {
    if (!context.auth || context.auth.uid !== data.userId) {
      throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
    }

    const userRef = getDb().collection("users").doc(data.userId);
    const userDoc = await userRef.get();
    const skipTimestamps: number[] = userDoc.data()?.skipTimestamps ?? [];

    const now = Date.now();
    const windowStart = now - 60000; // 60 seconds
    const recent = skipTimestamps.filter((t) => t > windowStart);

    if (recent.length >= 10) {
      return { allowed: false };
    }

    // Update skip timestamps
    await userRef.update({
      skipTimestamps: admin.firestore.FieldValue.arrayUnion(now),
    });

    return { allowed: true };
  }
);

/** Auto-ban logic: Check reports and ban users if needed. */
export const checkAndBanFromReports = functions.pubsub
  .schedule("every 1 hours")
  .onRun(async () => {
    const oneDayAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const reportsSnapshot = await getDb()
      .collection("reports")
      .where("createdAt", ">=", oneDayAgo)
      .get();

    const reportedCounts: Record<string, number> = {};
    reportsSnapshot.docs.forEach((reportDoc: QueryDocumentSnapshot) => {
      const reportedUserId = reportDoc.data()?.reportedUserId;
      if (reportedUserId) {
        reportedCounts[reportedUserId] = (reportedCounts[reportedUserId] || 0) + 1;
      }
    });

    const BAN_THRESHOLD = 5; // 5 reports in 24h = ban
    const BAN_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

    const batch = getDb().batch();
    for (const [uid, count] of Object.entries(reportedCounts)) {
      if (count >= BAN_THRESHOLD) {
        const userRef = getDb().collection("users").doc(uid);
        const banUntil = admin.firestore.Timestamp.fromMillis(Date.now() + BAN_DURATION_MS);
        batch.update(userRef, {
          randomChatBannedUntil: banUntil,
        });
        functions.logger.info(`Banned user ${uid} from random chat (${count} reports)`);
      }
    }

    if (Object.keys(reportedCounts).length > 0) {
      await batch.commit();
    }

    return null;
  });

/** DISABLED for minimal matching test. Set CLEANUP_DISABLED = false to restore. */
const CLEANUP_DISABLED = true;

/** Remove stale queue entries (older than STALE_QUEUE_SECONDS or lastSeen > 20s). */
export const cleanupRandomQueue = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    if (CLEANUP_DISABLED) {
      functions.logger.info("[cleanupRandomQueue] DISABLED for minimal test");
      return null;
    }
    const serverTimeMs = Date.now();
    const cutoff = admin.firestore.Timestamp.fromMillis(serverTimeMs - STALE_QUEUE_SECONDS * 1000);
    const lastSeenCutoff = admin.firestore.Timestamp.fromMillis(serverTimeMs - 20000);
    const DIAG_TAG = "[cleanupRandomQueue:diag]";

    const oldSnapshot = await getDb()
      .collection(RANDOM_QUEUE)
      .where("createdAt", "<", cutoff)
      .limit(100)
      .get();

    const staleSnapshot = await getDb()
      .collection(RANDOM_QUEUE)
      .where("lastSeen", "<", lastSeenCutoff)
      .limit(100)
      .get();

    const staleDetails = staleSnapshot.docs.map((d: QueryDocumentSnapshot) => {
      const data = d.data();
      const ls = data.lastSeen as admin.firestore.Timestamp | undefined;
      const lsMs = ls?.toMillis?.() ?? null;
      return {
        docId: d.id,
        userId: data.userId,
        lastSeenMs: lsMs,
        lastSeenAgeMs: lsMs != null ? serverTimeMs - lsMs : null,
      };
    });

    functions.logger.info(`${DIAG_TAG} RUN`, {
      serverTimeMs,
      lastSeenCutoffMs: serverTimeMs - 20000,
      oldCount: oldSnapshot.docs.length,
      staleCount: staleSnapshot.docs.length,
      staleDetails,
    });

    const batch = getDb().batch();
    oldSnapshot.docs.forEach((d: QueryDocumentSnapshot) => batch.delete(d.ref));
    staleSnapshot.docs.forEach((d: QueryDocumentSnapshot) => {
      if (!oldSnapshot.docs.find((od: QueryDocumentSnapshot) => od.id === d.id)) {
        batch.delete(d.ref);
      }
    });

    if (!oldSnapshot.empty || !staleSnapshot.empty) {
      await batch.commit();
      functions.logger.info(
        `Cleaned up random queue: ${oldSnapshot.size} old, ${staleSnapshot.size} stale`
      );
    }
    return null;
  });

// ----- Incoming call FCM notification -----

/** Firestore trigger: when a call is created with status ringing, send FCM to callee. */
export const onCallCreated = functions.firestore
  .document("calls/{callId}")
  .onCreate(async (snap, context) => {
    const callId = context.params.callId;
    const data = snap.data();
    if (data?.status !== "ringing") return;

    const calleeId = data.calleeId ?? data.receiverId;
    const callerId = data.callerId;
    const callType = data.callType ?? data.type ?? "video";
    const chatId = data.chatId ?? "";
    const ringTimeoutSec = data.ringTimeoutSec ?? 45;

    if (!calleeId || !callerId) {
      functions.logger.warn("[onCallCreated] Missing calleeId or callerId", { callId });
      return;
    }

    const calleeDoc = await getDb().collection("users").doc(calleeId).get();
    const fcmToken = calleeDoc.data()?.fcmToken;
    if (!fcmToken || typeof fcmToken !== "string") {
      functions.logger.warn("[onCallCreated] No FCM token for callee", { calleeId, callId });
      return;
    }

    const callerDoc = await getDb().collection("users").doc(callerId).get();
    const callerName =
      (callerDoc.data()?.firstName as string) || "Someone";
    const avatarUrl = (callerDoc.data()?.avatarUrl as string) || "";

    // FCM requires all data values to be strings. Payload structure for killed-state: notification (so system shows when app killed) + data (for app after tap).
    const payload = {
      data: {
        type: "incoming_call",
        call_id: callId,
        caller_id: callerId,
        caller_name: callerName,
        call_type: typeof callType === "string" ? callType : "video",
        chat_id: String(chatId ?? ""),
        ring_timeout_sec: String(ringTimeoutSec),
        avatar_url: avatarUrl,
      },
      notification: {
        title: "Incoming Call",
        body: callerName,
      },
      android: {
        priority: "high" as const,
        notification: {
          channelId: "incoming_calls",
          priority: "max" as const,
          sound: "ringtone",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: { title: "Incoming Call", body: callerName },
            sound: "ringtone.caf",
            "content-available": 1,
            "mutable-content": 1,
          },
        },
        fcm_options: avatarUrl ? { image: avatarUrl } : undefined,
      },
    };

    try {
      await admin.messaging().send({
        token: fcmToken,
        ...payload,
      });
      functions.logger.info("[onCallCreated] FCM sent", {
        callId,
        calleeId,
        hasNotification: true,
        androidChannelId: payload.android.notification.channelId,
        androidPriority: payload.android.priority,
      });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code === "messaging/invalid-registration-token") {
        await getDb().collection("users").doc(calleeId).update({ fcmToken: admin.firestore.FieldValue.delete() });
        functions.logger.warn("[onCallCreated] Removed invalid FCM token for callee", { calleeId });
      }
      functions.logger.error("[onCallCreated] FCM failed", { callId, calleeId, error: String(err) });
    }
  });
