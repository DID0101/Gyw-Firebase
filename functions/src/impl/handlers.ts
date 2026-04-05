/**
 * Function implementations — loaded only when a trigger runs (not during Firebase CLI discovery).
 */
import { getAdminApp, getDb } from "./adminApp";
import * as functions from "firebase-functions/v1";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import * as cp from "../callPush";
import type * as functionsV1 from "firebase-functions/v1";

export async function handleOnCallCreated(
  snap: functionsV1.firestore.DocumentSnapshot,
  context: functionsV1.EventContext
): Promise<null> {
  const callId = context.params.callId as string;

  try {
    const data = snap.data();
    const receiverRaw = data?.receiverId;
    const callerRaw = data?.callerId;
    const receiverId = typeof receiverRaw === "string" ? receiverRaw.trim() : undefined;
    const callerId = typeof callerRaw === "string" ? callerRaw.trim() : undefined;
    const status = data?.status as string | undefined;
    const rawType = data?.type as string | undefined;

    functions.logger.info("[onCallCreated] handler entry", {
      callId,
      receiverId,
      callerId,
      status,
      rawType,
      firebaseAdminApps: getAdminApp().apps.length,
      receiverIdSourceType: receiverRaw === undefined || receiverRaw === null ? "missing" : typeof receiverRaw,
      callerIdSourceType: callerRaw === undefined || callerRaw === null ? "missing" : typeof callerRaw,
      receiverIdLen: receiverId?.length ?? 0,
      callerIdLen: callerId?.length ?? 0,
    });

    if (!receiverId || !callerId) {
      functions.logger.warn("[onCallCreated] missing callerId or receiverId after parse", {
        callId,
        hasReceiverId: !!receiverId,
        hasCallerId: !!callerId,
      });
      return null;
    }

    if (receiverId.length < 20 || callerId.length < 20) {
      functions.logger.warn(
        "[onCallCreated] participant id shorter than typical Firebase UID — confirm calls/{callId} fields",
        { callId, receiverIdLen: receiverId.length, callerIdLen: callerId.length }
      );
    }

    if (receiverId === callerId) {
      functions.logger.warn("[onCallCreated] caller equals receiver, skip", { callId });
      return null;
    }

    if (status && status !== "ringing") {
      functions.logger.info("[onCallCreated] skip non-ringing create", { callId, status });
      return null;
    }

    const isVideo = rawType !== "audio";
    const callType = isVideo ? "video" : "audio";

    let callerName = "";
    try {
      const userDoc = await getDb().collection("users").doc(callerId).get();
      const u = userDoc.data();
      if (u) {
        const fn = (u.firstName as string) || "";
        const ln = (u.lastName as string) || "";
        callerName = `${fn} ${ln}`.trim() || (u.username as string) || "";
      }
    } catch (e) {
      functions.logger.warn("[onCallCreated] caller profile read failed", { callerId, error: String(e) });
    }

    const db = getDb();
    const collectOutcome: cp.CollectFcmTokensOutcome = { code: "tokens_ready" };
    const tokens = await cp.collectFcmTokensForUser(db, receiverId, { callId, collectOutcome });

    if (tokens.length === 0) {
      functions.logger.warn("[onCallCreated] no FCM tokens for receiver", {
        callId,
        receiverId,
        note: "Client must re-register FCM token on next app open",
      });
      return null;
    }

    const displayName = callerName || callerId;
    const title = isVideo ? "Incoming video call" : "Incoming audio call";
    const dataPayload = cp.stringifyCallData({
      type: "incoming_call",
      callId,
      callerId,
      callerName: displayName,
      hasVideo: isVideo ? "true" : "false",
      callType,
      title,
      body: displayName,
    });

    functions.logger.debug("[onCallCreated] About to send FCM", {
      callId,
      receiverId,
      tokensCount: tokens.length,
      dataPayloadKeys: Object.keys(dataPayload),
      dataPayloadSample: JSON.stringify(dataPayload).slice(0, 300),
    });

    const { successCount, failureCount, invalidTokens } = await cp.sendCallDataMulticast(
      tokens,
      dataPayload,
      {
        collapseKey: `incoming_call_${callId}`,
        logLabel: "onCallCreated",
        preSendDryRunMaxTokens: 32,
      }
    );

    functions.logger.info("[onCallCreated] FCM send result", {
      callId,
      successCount,
      failureCount,
      invalidTokenCount: invalidTokens.length,
    });

    let cleanupBatchRemoved = 0;
    let cleanupPerTokenRemoved = 0;
    let cleanupErrors = 0;

    if (failureCount > 0 || invalidTokens.length > 0) {
      functions.logger.info("[onCallCreated] FCM token cleanup starting", {
        callId,
        receiverId,
        failureCount,
        invalidTokenCount: invalidTokens.length,
      });

      try {
        cleanupBatchRemoved = await cp.removeUnusableFcmTokenDocsForUser(
          db,
          receiverId,
          invalidTokens
        );
        functions.logger.info("[onCallCreated] batch removeUnusableFcmTokenDocsForUser finished", {
          callId,
          receiverId,
          removedCount: cleanupBatchRemoved,
        });
      } catch (cleanupErr) {
        cleanupErrors++;
        functions.logger.error("[onCallCreated] batch token cleanup failed", {
          callId,
          receiverId,
          error: String(cleanupErr),
        });
      }

      for (let i = 0; i < invalidTokens.length; i++) {
        const token = invalidTokens[i];
        try {
          const n = await cp.removeFcmTokenFromDatabase(db, receiverId, token);
          cleanupPerTokenRemoved += n;
          if (n > 0) {
            functions.logger.info("[onCallCreated] removeFcmTokenFromDatabase removed rows", {
              callId,
              receiverId,
              tokenIndex: i,
              removedDocs: n,
              tokenLength: token.length,
              tokenSuffix: token.slice(-12),
            });
          } else {
            functions.logger.info("[onCallCreated] removeFcmTokenFromDatabase no rows (already pruned)", {
              callId,
              receiverId,
              tokenIndex: i,
              tokenLength: token.length,
              tokenSuffix: token.slice(-12),
            });
          }
        } catch (e) {
          cleanupErrors++;
          functions.logger.error("[onCallCreated] removeFcmTokenFromDatabase failed", {
            callId,
            receiverId,
            tokenIndex: i,
            error: String(e),
            tokenLength: token.length,
            tokenSuffix: token.slice(-12),
          });
        }
      }

      if (failureCount > 0 && invalidTokens.length === 0) {
        try {
          const n = await cp.removeUnusableFcmTokenDocsForUser(db, receiverId, []);
          cleanupBatchRemoved += n;
          functions.logger.info("[onCallCreated] post-failure shape prune (no invalid token strings)", {
            callId,
            receiverId,
            removedCount: n,
          });
        } catch (e) {
          cleanupErrors++;
          functions.logger.error("[onCallCreated] shape prune after send failure failed", {
            callId,
            receiverId,
            error: String(e),
          });
        }
      }

      functions.logger.info("[onCallCreated] FCM token cleanup summary", {
        callId,
        receiverId,
        batchRemoved: cleanupBatchRemoved,
        perTokenRemoved: cleanupPerTokenRemoved,
        anyRowsRemoved: cleanupBatchRemoved > 0 || cleanupPerTokenRemoved > 0,
        invalidTokenCount: invalidTokens.length,
        cleanupErrors,
      });

      if (cleanupErrors > 0) {
        functions.logger.error("[onCallCreated] completed with token cleanup error(s)", {
          callId,
          receiverId,
          cleanupErrors,
        });
      }

      if (
        invalidTokens.length > 0 &&
        cleanupBatchRemoved === 0 &&
        cleanupPerTokenRemoved === 0 &&
        cleanupErrors === 0
      ) {
        functions.logger.warn("[onCallCreated] FCM rejected token(s) but no DB rows removed", {
          callId,
          receiverId,
          invalidTokenSuffixes: invalidTokens.map((t) => t.slice(-14)),
        });
      }
    }

    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    functions.logger.error("[onCallCreated] fatal", { callId, message, stack });
    throw err;
  }
}

/** Callable: send a known-good data-only call invite to one device token (for debugging client FCM). */
export async function handleTestFcmSend(
  data: { token?: string; callId?: string },
  context: functions.https.CallableContext
): Promise<{ success: boolean; result: { successCount: number; failureCount: number } }> {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in");
  }

  const token = typeof data?.token === "string" ? data.token.trim() : "";
  const callId = typeof data?.callId === "string" ? data.callId.trim() : "";
  if (!token || token.length < 20) {
    throw new functions.https.HttpsError("invalid-argument", "token required (FCM registration token)");
  }
  if (!callId) {
    throw new functions.https.HttpsError("invalid-argument", "callId required");
  }

  const testData = cp.stringifyCallData({
    type: "incoming_call",
    callId,
    callerId: "test",
    callerName: "Test User",
    hasVideo: "true",
    callType: "video",
    title: "Incoming video call",
    body: "Test User",
  });

  functions.logger.info("🔍 DEBUG testFcmSend: about to multicast", {
    uid: context.auth.uid,
    callId,
    tokenLen: token.length,
    dataKeys: Object.keys(testData),
  });

  const result = await cp.sendCallDataMulticast([token], testData, {
    collapseKey: `test_${callId}`,
    logLabel: "testFcmSend",
  });

  functions.logger.info("testFcmSend done", {
    uid: context.auth.uid,
    callId,
    successCount: result.successCount,
    failureCount: result.failureCount,
  });

  return { success: result.successCount > 0, result };
}

export async function handleOnCallUpdated(
  change: functionsV1.Change<functionsV1.firestore.DocumentSnapshot>,
  context: functionsV1.EventContext
): Promise<null> {
  const callId = context.params.callId as string;
  const before = change.before.data();
  const after = change.after.data();
  const prevStatus = before?.status as string | undefined;
  const nextStatus = after?.status as string | undefined;

  if (prevStatus === nextStatus) {
    return null;
  }

  const callerId = after?.callerId as string | undefined;
  const receiverId = after?.receiverId as string | undefined;
  if (!callerId || !receiverId || callerId === receiverId) {
    return null;
  }

  const db = getDb();
  const baseFields = {
    callId,
    callerId,
    receiverId,
  };

  functions.logger.info("[onCallUpdated] status change", {
    callId,
    prevStatus,
    nextStatus,
  });

  if (prevStatus === "ringing" && nextStatus === "active") {
    await cp.sendCallPushToUser(
      db,
      callerId,
      {
        type: "call_accepted",
        ...baseFields,
      },
      { collapseKey: `call_accepted_${callId}`, logLabel: "onCallUpdated:accepted" }
    );
    return null;
  }

  if (prevStatus === "ringing" && nextStatus === "rejected") {
    await cp.sendCallPushToUser(
      db,
      callerId,
      {
        type: "call_rejected",
        ...baseFields,
      },
      { collapseKey: `call_rejected_${callId}`, logLabel: "onCallUpdated:rejected" }
    );
    await cp.sendCallPushToUser(
      db,
      receiverId,
      {
        type: "call_rejected",
        ...baseFields,
      },
      { collapseKey: `call_rejected_${callId}_rx`, logLabel: "onCallUpdated:rejected:rx" }
    );
    return null;
  }

  if (prevStatus === "ringing" && nextStatus === "missed") {
    await cp.sendCallPushToUsers(
      db,
      [callerId, receiverId],
      {
        type: "call_timeout",
        ...baseFields,
      },
      { collapseKey: `call_timeout_${callId}`, logLabel: "onCallUpdated:missed" }
    );
    return null;
  }

  if (prevStatus === "ringing" && nextStatus === "ended") {
    await cp.sendCallPushToUser(
      db,
      receiverId,
      {
        type: "call_ended",
        reason: "caller_cancelled",
        ...baseFields,
      },
      { collapseKey: `call_ended_${callId}_ring`, logLabel: "onCallUpdated:ringing_end" }
    );
    return null;
  }

  if (prevStatus === "ringing" && nextStatus === "busy") {
    await cp.sendCallPushToUser(
      db,
      callerId,
      {
        type: "call_rejected",
        reason: "busy",
        ...baseFields,
      },
      { collapseKey: `call_busy_${callId}`, logLabel: "onCallUpdated:busy" }
    );
    return null;
  }

  if (prevStatus === "active" && nextStatus === "ended") {
    await cp.sendCallPushToUsers(
      db,
      [callerId, receiverId],
      {
        type: "call_ended",
        ...baseFields,
      },
      { collapseKey: `call_ended_${callId}`, logLabel: "onCallUpdated:active_end" }
    );
    return null;
  }

  return null;
}

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
    if (now - created.toMillis() < 60_000) continue;

    batch.update(doc.ref, {
      status: "missed",
      updatedAt: FieldValue.serverTimestamp(),
      endedAt: FieldValue.serverTimestamp(),
      missedReason: "server_ring_timeout",
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

  await userRef.update({
    skipTimestamps: FieldValue.arrayUnion(now),
  });

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

export async function handleFcmTokenMaintenanceScheduled(): Promise<null> {
  const { runFcmTokenMaintenanceSweep } = require("../fcmTokenMaintenance") as typeof import("../fcmTokenMaintenance");
  await runFcmTokenMaintenanceSweep();
  return null;
}

const STALE_TOKEN_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const STALE_TOKEN_CLEANUP_USERS_PAGE = 200;
const STALE_TOKEN_CURSOR_DOC = "maintenance/cleanupStaleTokensCursor";
const STALE_TOKEN_BATCH = 450;

function fcmSubdocActivityMs(doc: QueryDocumentSnapshot): number | null {
  for (const field of ["updatedAt", "lastActiveAt"] as const) {
    const v = doc.get(field);
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
    if (v != null && typeof (v as { toMillis?: () => number }).toMillis === "function") {
      return (v as { toMillis: () => number }).toMillis();
    }
  }
  return null;
}

/** Daily: delete `fcmTokens` subdocs older than 60d (by updatedAt/lastActiveAt) or shorter than min registration length. */
export async function handleCleanupStaleTokens(): Promise<null> {
  const db = getDb();
  const cutoffMs = Date.now() - STALE_TOKEN_MAX_AGE_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  functions.logger.info("[cleanupStaleTokens] starting", { cutoff: cutoffIso, cutoffMs });

  const cursorRef = db.doc(STALE_TOKEN_CURSOR_DOC);
  const cursorSnap = await cursorRef.get();
  const lastUserId =
    cursorSnap.exists && typeof cursorSnap.get("lastUserId") === "string"
      ? (cursorSnap.get("lastUserId") as string)
      : null;

  let q = db.collection("users").orderBy(FieldPath.documentId()).limit(STALE_TOKEN_CLEANUP_USERS_PAGE);
  if (lastUserId) {
    q = q.startAfter(lastUserId);
  }
  const usersSnap = await q.get();
  if (usersSnap.empty) {
    await cursorRef.set({ lastUserId: null, completedCycleAt: FieldValue.serverTimestamp() }, { merge: true });
    functions.logger.info("[cleanupStaleTokens] cursor reset (no users in page)");
    return null;
  }

  let totalRemoved = 0;
  const minLen = cp.FCM_MIN_STORED_TOKEN_LEN;

  for (const userDoc of usersSnap.docs) {
    try {
      const tokensSnap = await userDoc.ref.collection("fcmTokens").get();
      let batch = db.batch();
      let batchCount = 0;

      const commitIfNeeded = async (force: boolean) => {
        if (batchCount >= STALE_TOKEN_BATCH || (force && batchCount > 0)) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      };

      for (const tokenDoc of tokensSnap.docs) {
        const rawTok = tokenDoc.get("token");
        const tokenStr = typeof rawTok === "string" ? rawTok.trim() : "";
        const tokenLen = tokenStr.length > 0 ? tokenStr.length : tokenDoc.id.length;
        const activityMs = fcmSubdocActivityMs(tokenDoc);
        const isStale = activityMs !== null && activityMs < cutoffMs;
        const isInvalidLength = tokenLen < minLen;

        if (isStale || isInvalidLength) {
          batch.delete(tokenDoc.ref);
          batchCount++;
          totalRemoved++;
          if (batchCount >= STALE_TOKEN_BATCH) {
            await commitIfNeeded(true);
          }
        }
      }
      await commitIfNeeded(true);
    } catch (e) {
      functions.logger.warn("[cleanupStaleTokens] user sweep failed", {
        userId: userDoc.id,
        error: String(e),
      });
    }
  }

  const last = usersSnap.docs[usersSnap.docs.length - 1].id;
  const wrapped = usersSnap.size < STALE_TOKEN_CLEANUP_USERS_PAGE;
  await cursorRef.set(
    {
      lastUserId: wrapped ? null : last,
      lastRunAt: FieldValue.serverTimestamp(),
      lastRunRemovedApprox: totalRemoved,
    },
    { merge: true }
  );

  functions.logger.info("[cleanupStaleTokens] done", {
    totalRemoved,
    usersProcessed: usersSnap.size,
    cursorNext: wrapped ? "(reset)" : last,
  });
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
