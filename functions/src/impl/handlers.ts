/**
 * Function implementations — loaded only when a trigger runs (not during Firebase CLI discovery).
 */
import { getDb } from "./adminApp";
import * as functions from "firebase-functions/v1";
import {
  FieldValue,
  Timestamp,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";

export async function handleMarkStaleRingingCallsMissed(): Promise<null> {
  const db = getDb();
  const snap = await db.collection("calls").where("status", "==", "ringing").limit(300).get();
  const now = Date.now();
  let updated = 0;
  let batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const created = data.createdAt as Timestamp | undefined;
    if (!created || typeof created.toMillis !== "function") continue;
    const expiresAt = data.expiresAt as Timestamp | undefined;
    const timeoutMs = typeof data.ringTimeoutSecs === "number" ? data.ringTimeoutSecs * 1000 : 30_000;
    const isExpired =
      (expiresAt && typeof expiresAt.toMillis === "function" && now >= expiresAt.toMillis()) ||
      now - created.toMillis() >= timeoutMs;
    if (!isExpired) continue;

    batch.update(doc.ref, {
      status: "missed",
      updatedAt: FieldValue.serverTimestamp(),
      endedAt: FieldValue.serverTimestamp(),
      missedReason: "server_ring_timeout",
      timeoutAt: FieldValue.serverTimestamp(),
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
    functions.logger.info("[markStaleRingingCallsMissed] marked missed", { updated });
  }
  return null;
}

const RANDOM_QUEUE = "randomQueue";
const STALE_QUEUE_SECONDS = 30;

type TryMatchRequest = { queueDocId: string; userId: string };
type TryMatchResponse =
  | { matched: true; callId: string; otherUserId: string }
  | { matched: false };

const VISIBILITY_PROOF_MODE = false;
const MINIMAL_MATCHING_MODE = true;

export async function handleTryRandomMatch(
  data: TryMatchRequest,
  context: functions.https.CallableContext
): Promise<TryMatchResponse | { visibleQueueSize: number; visibleDocIds: string[] }> {
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
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated");
  }
  const uid = context.auth.uid;
  const { queueDocId, userId } = data ?? {};
  if (!queueDocId || !userId || uid !== userId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "queueDocId and userId required; userId must match caller"
    );
  }

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
        createdAt: FieldValue.serverTimestamp(),
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

export async function handleCheckSkipRateLimit(
  data: { userId: string },
  context: functions.https.CallableContext
): Promise<{ allowed: boolean }> {
  if (!context.auth || context.auth.uid !== data.userId) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }

  const userRef = getDb().collection("users").doc(data.userId);
  const userDoc = await userRef.get();
  const skipTimestamps: number[] = userDoc.data()?.skipTimestamps ?? [];

  const now = Date.now();
  const windowStart = now - 60000;
  const recent = skipTimestamps.filter((t) => t > windowStart);

  if (recent.length >= 10) {
    return { allowed: false };
  }

  try {
    await userRef.update({
      skipTimestamps: FieldValue.arrayUnion(now),
    });
  } catch (updateErr) {
    functions.logger.error('[checkSkipRateLimit] Failed to update skip timestamps:', updateErr);
    // Still allow the skip even if the timestamp update fails — do not block the user
  }

  return { allowed: true };
}

export async function handleCheckAndBanFromReports(): Promise<null> {
  const oneDayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
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

  const BAN_THRESHOLD = 5;
  const BAN_DURATION_MS = 24 * 60 * 60 * 1000;

  const batch = getDb().batch();
  for (const [uid, count] of Object.entries(reportedCounts)) {
    if (count >= BAN_THRESHOLD) {
      const userRef = getDb().collection("users").doc(uid);
      const banUntil = Timestamp.fromMillis(Date.now() + BAN_DURATION_MS);
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
}

const CLEANUP_DISABLED = true;

export async function handleCleanupRandomQueue(): Promise<null> {
  if (CLEANUP_DISABLED) {
    functions.logger.info("[cleanupRandomQueue] DISABLED for minimal test");
    return null;
  }
  const serverTimeMs = Date.now();
  const cutoff = Timestamp.fromMillis(serverTimeMs - STALE_QUEUE_SECONDS * 1000);
  const lastSeenCutoff = Timestamp.fromMillis(serverTimeMs - 20000);
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
    const docData = d.data();
    const ls = docData.lastSeen as Timestamp | undefined;
    const lsMs = ls?.toMillis?.() ?? null;
    return {
      docId: d.id,
      userId: docData.userId,
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
}
