/**
 * FCM helpers for VoIP-style calls: high priority, all string values in `data`.
 * Incoming invites must be **data-only** on Android — any top-level `notification` or
 * `android.notification` causes the system to display a tray notification and **skips**
 * `FirebaseMessagingService.onMessageReceived` while backgrounded/killed (TECNO/HiOS, etc.).
 * Custom ring UI and `GywFcmService` rely on data-only delivery + `android.priority: high`.
 *
 * Lifecycle pushes (ended/rejected/…) are also data-only.
 */
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase-admin/firestore";
import * as functions from "firebase-functions/v1";
import { messagingInstance } from "./impl/adminApp";

function firestoreErrFields(e: unknown): { errorMessage: string; stack: string } {
  const err = e as Error;
  return {
    errorMessage: err?.message ?? String(e),
    stack: typeof err?.stack === "string" ? err.stack : "(no stack)",
  };
}

/** Only these FCM error codes mean the registration token is permanently bad — safe to delete from DB. */
const invalidFcmTokenCodes = [
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
] as const;

export function isFcmTokenDefinitelyInvalidCode(code: string | undefined): boolean {
  return !!code && invalidFcmTokenCodes.includes(code as (typeof invalidFcmTokenCodes)[number]);
}

export const FCM_CALL_CHUNK = 500;

/** Stored / sent registration tokens shorter than this are treated as unusable (truncated or corrupt). */
export const FCM_MIN_STORED_TOKEN_LEN = 140;

/** `fcmTokens` docs with no fresher than this (see {@link getFcmTokenDocLastActivityMs}) are not sent and pruned. */
export const FCM_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Optional stricter purge in scheduled {@link maintenancePruneFcmTokensForUser} only (default = same as
 * {@link FCM_TOKEN_MAX_AGE_MS}). Set to 75–90 days if you want idle docs removed only after longer quiet periods.
 */
export const FCM_MAINTENANCE_PURGE_MAX_AGE_MS = FCM_TOKEN_MAX_AGE_MS;

/**
 * Scheduled maintenance: FCM `send(..., dryRun: true)` probe for subdocs at least this old (and younger than
 * {@link FCM_TOKEN_MAX_AGE_MS}) to drop invalid tokens before the next real send.
 */
export const FCM_MAINTENANCE_DRY_RUN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Heuristic: reject obvious garbage before calling FCM (saves quota and noisy logs).
 * Android tokens are usually `segment:APA91b…` (contains `:`). Long opaque strings may be valid on some platforms.
 */
export function isPlausibleFcmRegistrationToken(t: string): boolean {
  const s = t.trim();
  if (s.length < FCM_MIN_STORED_TOKEN_LEN) return false;
  if (/\s/.test(s)) return false;
  if (s.includes(":")) return true;
  return s.length >= 152;
}

/** Normalize for reliable string compares (legacy field vs multicast token). */
export function normFcmToken(s: string): string {
  return s.trim().normalize("NFC");
}

/** Matches client `token.slice(-25).replace(...)` (see `lib/fcmTokenService.ts`). */
function fcmTokenFirestoreDocIdRawTrim(token: string): string {
  return token.trim().slice(-25).replace(/[^a-zA-Z0-9]/g, "_");
}

/** Doc id variants: raw (client parity) + NFC-normalized suffix (Unicode edge cases). */
function expandRejectedFirestoreDocIds(rejectedList: string[]): Set<string> {
  const ids = new Set<string>();
  for (const t of rejectedList) {
    const trimmed = t.trim();
    ids.add(fcmTokenFirestoreDocIdRawTrim(trimmed));
    ids.add(fcmTokenFirestoreDocIdRawTrim(normFcmToken(trimmed)));
  }
  return ids;
}

/** Client-parity doc id (`lib/fcmTokenService`); use {@link expandRejectedFirestoreDocIds} for cleanup matching. */
export function fcmTokenFirestoreDocId(token: string): string {
  return fcmTokenFirestoreDocIdRawTrim(token);
}

/** FCM `data` map must be string → string only. */
export function stringifyCallData(
  fields: Record<string, string | number | boolean | undefined | null>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : String(v);
  }
  return out;
}

function parseFirestoreTimeValueMs(v: unknown): number | null {
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (v != null && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/**
 * Latest of `updatedAt` and `lastActiveAt` (ISO or Timestamp) — client should set both on save / foreground.
 */
export function getFcmTokenDocLastActivityMs(doc: QueryDocumentSnapshot): number | null {
  const u = parseFirestoreTimeValueMs(doc.get("updatedAt"));
  const a = parseFirestoreTimeValueMs(doc.get("lastActiveAt"));
  if (u == null && a == null) return null;
  if (u == null) return a;
  if (a == null) return u;
  return Math.max(u, a);
}

/**
 * When `fcmTokens` query returns 0 docs, log whether the parent doc looks like the client wrote token metadata
 * without creating subcollection rows (common mismatch).
 */
function summarizeUserDocForEmptyFcmTokensDiag(
  data: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!data) return { hasUserData: false };
  const keys = Object.keys(data);
  const fcmRelated = keys.filter((k) => /fcm|token|push|notif|messaging/i.test(k));
  const summary: Record<string, unknown> = {
    hasUserData: true,
    userDocTopLevelFieldCount: keys.length,
    fcmRelatedFieldNames: fcmRelated,
  };
  for (const k of fcmRelated) {
    const v = data[k];
    if (k === "fcmToken" && typeof v === "string") {
      summary.fcmTokenLegacyFieldChars = v.length;
      continue;
    }
    const ms = parseFirestoreTimeValueMs(v);
    if (ms != null) {
      summary[`${k}_ageDays`] = Math.round((Date.now() - ms) / 86400000);
    } else if (typeof v === "string") {
      summary[`${k}_stringLen`] = v.length;
    } else if (v != null) {
      summary[`${k}_type`] = typeof v;
    }
  }
  return summary;
}

/** One registration token per `fcmTokens` subdocument (`token` field); not an array on the user doc. */
function fcmSubdocMatchesAnyRejectedToken(
  docSnap: QueryDocumentSnapshot,
  rejectedList: string[]
): boolean {
  if (rejectedList.length === 0) return false;
  const rejectedNorm = new Set(rejectedList.map((t) => normFcmToken(t)));
  const rejectedDocIds = expandRejectedFirestoreDocIds(rejectedList);
  const rawTok = docSnap.get("token");
  const fromField =
    rawTok === undefined || rawTok === null ? undefined : String(rawTok).trim();
  const stored = (fromField ?? docSnap.id).trim();
  if (rejectedDocIds.has(docSnap.id)) return true;
  if (fromField) {
    if (rejectedNorm.has(normFcmToken(fromField))) return true;
    if (
      docSnap.id === fcmTokenFirestoreDocIdRawTrim(fromField) ||
      docSnap.id === fcmTokenFirestoreDocIdRawTrim(normFcmToken(fromField))
    ) {
      return true;
    }
  }
  return rejectedNorm.has(normFcmToken(stored));
}

async function commitBatchDeletes(db: Firestore, refs: DocumentReference[]): Promise<void> {
  const BATCH = 450;
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = db.batch();
    refs.slice(i, i + BATCH).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

export type FcmTokenMaintenanceResult = {
  userId: string;
  deletedShapeOrStale: number;
  dryRunChecked: number;
  dryRunInvalidDeleted: number;
};

/**
 * Proactive prune for one user: drop bad-shape / stale subdocs (same rules as collect), then optionally
 * validate older registrations with FCM `send` dry-run (no message delivered; invalid tokens error).
 */
export async function maintenancePruneFcmTokensForUser(
  db: Firestore,
  userId: string,
  options?: { maxDryRunValidations?: number }
): Promise<FcmTokenMaintenanceResult> {
  const uid = typeof userId === "string" ? userId.trim() : "";
  const maxDry = Math.max(0, options?.maxDryRunValidations ?? 2);
  const out: FcmTokenMaintenanceResult = {
    userId: uid,
    deletedShapeOrStale: 0,
    dryRunChecked: 0,
    dryRunInvalidDeleted: 0,
  };
  if (!uid) return out;

  const tokensCol = db.collection("users").doc(uid).collection("fcmTokens");
  const snap = await tokensCol.get();
  const toDelete: DocumentReference[] = [];
  const dryRunCandidates: { ref: DocumentReference; token: string; docId: string }[] = [];
  const now = Date.now();

  for (const doc of snap.docs) {
    if (doc.get("disabled") === true) {
      continue;
    }
    const fromField = (doc.get("token") as string | undefined)?.trim();
    const idPart = doc.id?.trim();
    let candidate: string | null = null;
    if (fromField && fromField.length > 20) {
      candidate = fromField;
    } else if (idPart && idPart.length > 20 && !idPart.includes("/")) {
      candidate = idPart;
    } else {
      toDelete.push(doc.ref);
      continue;
    }
    if (candidate.length < FCM_MIN_STORED_TOKEN_LEN || !isPlausibleFcmRegistrationToken(candidate)) {
      toDelete.push(doc.ref);
      continue;
    }
    const activityMs = getFcmTokenDocLastActivityMs(doc);
    if (activityMs !== null && now - activityMs > FCM_MAINTENANCE_PURGE_MAX_AGE_MS) {
      toDelete.push(doc.ref);
      continue;
    }
    if (
      maxDry > 0 &&
      activityMs !== null &&
      now - activityMs >= FCM_MAINTENANCE_DRY_RUN_MIN_AGE_MS &&
      now - activityMs < FCM_TOKEN_MAX_AGE_MS
    ) {
      dryRunCandidates.push({ ref: doc.ref, token: candidate, docId: doc.id });
    }
  }

  if (toDelete.length > 0) {
    try {
      await commitBatchDeletes(db, toDelete);
      out.deletedShapeOrStale = toDelete.length;
    } catch (e) {
      functions.logger.warn("[FCM] maintenance batch delete failed", { userId: uid, error: String(e) });
    }
  }

  const messaging = messagingInstance();
  const limit = Math.min(dryRunCandidates.length, maxDry);
  for (let i = 0; i < limit; i++) {
    const c = dryRunCandidates[i];
    out.dryRunChecked++;
    try {
      await messaging.send({ token: c.token, data: { _maint: "1" } }, true);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err.code;
      if (isFcmTokenDefinitelyInvalidCode(code)) {
        try {
          await c.ref.delete();
          out.dryRunInvalidDeleted++;
          functions.logger.info("[FCM] maintenance dry-run rejected token; deleted subdoc", {
            userId: uid,
            docId: c.docId,
            code,
          });
        } catch (delE) {
          functions.logger.warn("[FCM] maintenance dry-run delete failed", {
            userId: uid,
            error: String(delE),
          });
        }
      } else {
        functions.logger.debug("[FCM] maintenance dry-run error (not pruned)", {
          userId: uid,
          docId: c.docId,
          code,
          error: err.message ?? String(e),
        });
      }
    }
  }

  return out;
}

/** Populated when `collectOutcome` is passed into {@link collectFcmTokensForUser}. */
export type CollectFcmTokensOutcome = {
  code:
    | "invalid_receiver_id"
    | "missing_parent_user"
    | "empty_fcm_tokens_subcollection"
    | "no_sendable_after_filter"
    | "tokens_ready";
  subdocCount?: number;
  skippedNoCandidateSubdocs?: number;
  prunedShort?: number;
  prunedMalformed?: number;
  prunedStale?: number;
  skippedDisabledSubdocs?: number;
};

/** Optional correlation for Logs Explorer (e.g. pass `{ callId }` from `onCallCreated`). */
export type CollectFcmTokensDiag = {
  callId?: string;
  /** If provided, filled before return (for `handleOnCallCreated` summaries). */
  collectOutcome?: CollectFcmTokensOutcome;
};

export async function collectFcmTokensForUser(
  db: Firestore,
  userId: string,
  diag?: CollectFcmTokensDiag
): Promise<string[]> {
  const callId = diag?.callId;
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid) {
    if (diag?.collectOutcome) {
      diag.collectOutcome.code = "invalid_receiver_id";
    }
    functions.logger.warn("[FCM] collectFcmTokensForUser: empty userId", {
      callId,
      userIdType: typeof userId,
    });
    return [];
  }

  const userRef = db.collection("users").doc(uid);
  const tokensCol = userRef.collection("fcmTokens");
  const tokensPath = tokensCol.path;

  functions.logger.info("[FCM] collectFcmTokensForUser: starting", {
    userId: uid,
    callId: callId ?? null,
    userDocumentPath: userRef.path,
    fcmTokensSubcollectionPath: tokensPath,
  });

  if (callId) {
    functions.logger.info("[FCM] Attempting to collect FCM tokens for receiverId", {
      receiverId: uid,
      callId,
    });
    functions.logger.info("[FCM] Firestore query path for tokens", {
      receiverId: uid,
      fcmTokensSubcollectionPath: tokensPath,
      userDocumentPath: userRef.path,
    });
  }

  let parentUserSnap: DocumentSnapshot;
  try {
    parentUserSnap = await userRef.get();
  } catch (e) {
    functions.logger.error("[FCM] collectFcmTokensForUser: userRef.get() failed", {
      callId,
      receiverId: uid,
      userDocumentPath: userRef.path,
      ...firestoreErrFields(e),
    });
    throw e;
  }

  if (!parentUserSnap.exists) {
    if (diag?.collectOutcome) {
      diag.collectOutcome.code = "missing_parent_user";
    }
    functions.logger.warn(
      "[FCM] collectFcmTokensForUser: Parent user document does NOT exist for receiverId — cannot load FCM tokens; skipping fcmTokens query",
      {
        receiverId: uid,
        callId,
        userDocumentPath: userRef.path,
        dataIntegrity:
          "calls/{callId}.receiverId must match a document ID under users/. Investigate call creation and user onboarding.",
      }
    );
    return [];
  }

  if (callId) {
    functions.logger.info("[FCM] Parent users document snapshot (before fcmTokens query)", {
      receiverId: uid,
      callId,
      userDocumentPath: userRef.path,
      userDocExists: true,
    });
  }

  let tokensSnap: QuerySnapshot;
  try {
    tokensSnap = await tokensCol.get();
  } catch (e) {
    functions.logger.error("[FCM] collectFcmTokensForUser: fcmTokens.get() failed", {
      callId,
      receiverId: uid,
      queryPath: tokensPath,
      ...firestoreErrFields(e),
    });
    throw e;
  }

  functions.logger.info("[FCM] collectFcmTokensForUser", {
    userId: uid,
    callId: callId ?? null,
    subcollectionDocCount: tokensSnap.docs.length,
    docIds: tokensSnap.docs.map((d) => d.id),
    tokenFieldPresent: tokensSnap.docs.map((d) => {
      const t = d.get("token");
      return typeof t === "string" ? t.length : "MISSING";
    }),
  });

  if (tokensSnap.docs.length === 0 && parentUserSnap.exists) {
    const legacy = parentUserSnap.get("fcmToken");
    const legacyLog =
      legacy === undefined || legacy === null
        ? "NOT_FOUND"
        : typeof legacy === "string"
          ? `PRESENT(len=${legacy.length})`
          : `PRESENT(type=${typeof legacy})`;
    functions.logger.warn("[FCM] empty fcmTokens subcollection", {
      userId: uid,
      callId: callId ?? null,
      userDocExists: parentUserSnap.exists,
      userDocFields: parentUserSnap.exists ? Object.keys(parentUserSnap.data() ?? {}) : [],
      legacyFcmTokenField: legacyLog,
    });
  }

  if (callId) {
    functions.logger.info("[FCM] Found documents in fcmTokens subcollection for receiverId", {
      receiverId: uid,
      callId,
      subcollectionPath: tokensPath,
      documentCount: tokensSnap.size,
      docIds: tokensSnap.docs.map((d) => d.id),
      firebaseConsolePath: `Firestore → users → ${uid} → subcollection fcmTokens`,
    });
  }

  if (callId && tokensSnap.size === 0) {
    try {
      const userData = parentUserSnap.data() as Record<string, unknown> | undefined;
      functions.logger.info("[FCM] collectFcmTokensForUser: empty fcmTokens subcollection snapshot", {
        callId,
        receiverId: uid,
        userPath: userRef.path,
        parentUserDocumentExists: true,
        userDocExists: true,
        fcmTokensPath: tokensPath,
        fcmTokensQueryPath: tokensPath,
        listOperation: "users/{receiverId}/fcmTokens → CollectionReference.get() (Admin SDK listing)",
        subcollectionDocumentCount: 0,
        listQueryReturnedDocCount: 0,
        hasFcmTokenSubdocuments: false,
        firestoreSemantics:
          "Firestore has no persisted 'empty subcollection' node. listQueryReturnedDocCount===0 means there are zero documents under this path (cannot query existence separately from listing).",
        parentUserDocFcmHints: summarizeUserDocForEmptyFcmTokensDiag(userData),
        likelyCauseIfParentShowsFcmMetadataButZeroDocs:
          "Client (or another process) may update users.{uid} fields like fcmTokenUpdatedAt without writing users/{uid}/fcmTokens/* — Calls use only the subcollection. Align client to always write both (see fcmTokenService.writeToken).",
        note: "Parent user exists but no fcmTokens docs: client never saved tokens, rules blocked subcollection, or docs were pruned.",
        clientServerTokenLengthHint:
          "Client fcmTokenService must persist at the same minimum as FCM_MIN_STORED_TOKEN_LEN (140). If callee logs show getToken length 140–149 but 'writeToken skipped' / INVALID, upgrade app — otherwise subcollection stays empty while parent user exists.",
        manualVerificationSteps: [
          `Firestore Console → users → ${uid} → subcollection fcmTokens (expect ≥1 doc with field "token")`,
          `Verify calls/{callId} receiverId equals this uid and matches callee Auth uid`,
          "Callees must open native app once so fcmTokenService writes subdocs; check rules allow users/{uid}/fcmTokens/*",
        ],
      });
    } catch (e) {
      functions.logger.error("[FCM] collectFcmTokensForUser: empty subcollection diagnostic failed", {
        callId,
        receiverId: uid,
        userPath: userRef.path,
        ...firestoreErrFields(e),
      });
    }
  }

  const tokens: string[] = [];
  const toPrune: DocumentReference[] = [];
  let prunedShort = 0;
  let prunedMalformed = 0;
  let prunedStale = 0;
  let skippedNoCandidate = 0;
  let skippedDisabled = 0;

  for (const doc of tokensSnap.docs) {
    if (doc.get("disabled") === true) {
      skippedDisabled++;
      if (callId) {
        functions.logger.debug("[FCM] collectFcmTokensForUser: subdoc skipped (disabled)", {
          callId,
          userId: uid,
          docId: doc.id,
        });
      }
      continue;
    }
    const fromField = (doc.get("token") as string | undefined)?.trim();
    const idPart = doc.id?.trim();
    let candidate: string | null = null;
    if (fromField && fromField.length > 20) {
      candidate = fromField;
    } else if (idPart && idPart.length > 20 && !idPart.includes("/")) {
      candidate = idPart;
    } else {
      skippedNoCandidate++;
      if (callId) {
        functions.logger.debug("[FCM] collectFcmTokensForUser: subdoc skipped (no candidate)", {
          callId,
          userId: uid,
          docId: doc.id,
          tokenFieldLen: fromField?.length ?? 0,
          idPartLen: idPart?.length ?? 0,
        });
      }
      continue;
    }

    if (candidate.length < FCM_MIN_STORED_TOKEN_LEN) {
      toPrune.push(doc.ref);
      prunedShort++;
      if (callId) {
        functions.logger.debug("[FCM] collectFcmTokensForUser: subdoc marked prune (short)", {
          callId,
          docId: doc.id,
          candidateLen: candidate.length,
        });
      }
      continue;
    }
    if (!isPlausibleFcmRegistrationToken(candidate)) {
      toPrune.push(doc.ref);
      prunedMalformed++;
      if (callId) {
        functions.logger.debug("[FCM] collectFcmTokensForUser: subdoc marked prune (shape)", {
          callId,
          docId: doc.id,
          candidateLen: candidate.length,
          hasColon: candidate.includes(":"),
        });
      }
      continue;
    }

    const activityMs = getFcmTokenDocLastActivityMs(doc);
    if (activityMs !== null && Date.now() - activityMs > FCM_TOKEN_MAX_AGE_MS) {
      toPrune.push(doc.ref);
      prunedStale++;
      functions.logger.info("[FCM] pruning stale fcmTokens subdoc (last activity > max age)", {
        userId: uid,
        callId,
        docId: doc.id,
        ageDays: Math.round((Date.now() - activityMs) / 86400000),
      });
      continue;
    }

    if (callId) {
      functions.logger.debug("[FCM] collectFcmTokensForUser: subdoc accepted", {
        callId,
        docId: doc.id,
        candidateSuffix: candidate.slice(-8),
        candidateLen: candidate.length,
      });
    }
    tokens.push(candidate);
  }

  if (toPrune.length > 0) {
    try {
      await commitBatchDeletes(db, toPrune);
      functions.logger.info("[FCM] pruned unusable fcmTokens subdocs at collection time", {
        userId: uid,
        callId,
        removedCount: toPrune.length,
        shortTokenDocs: prunedShort,
        malformedShapeDocs: prunedMalformed,
        staleByUpdatedAt: prunedStale,
      });
    } catch (e) {
      functions.logger.warn("[FCM] failed to prune bad fcmTokens subdocs", {
        userId: uid,
        callId,
        ...firestoreErrFields(e),
      });
    }
  }

  if (tokens.length === 0) {
    const userSnap = parentUserSnap;

    const legacyRaw = userSnap.get("fcmToken");
    const legacy =
      legacyRaw === undefined || legacyRaw === null ? undefined : String(legacyRaw).trim();

    if (callId) {
      functions.logger.info("[FCM] collectFcmTokensForUser: user doc (legacy fcmToken check)", {
        callId,
        userId: uid,
        path: userRef.path,
        userDocExists: userSnap.exists,
        legacyFcmTokenChars: legacy?.length ?? 0,
        firestoreConsoleHint: `users/${uid}`,
      });
    }

    if (legacy && legacy.length > 20) {
      if (legacy.length < FCM_MIN_STORED_TOKEN_LEN || !isPlausibleFcmRegistrationToken(legacy)) {
        try {
          await userRef.update({ fcmToken: FieldValue.delete() });
          functions.logger.info("[FCM] cleared invalid legacy users.fcmToken field", {
            userId: uid,
            callId,
            tokenLength: legacy.length,
          });
        } catch (e) {
          functions.logger.warn("[FCM] failed to clear legacy fcmToken", {
            userId: uid,
            callId,
            ...firestoreErrFields(e),
          });
        }
      } else {
        if (callId) {
          functions.logger.info("[FCM] collectFcmTokensForUser: using legacy users.fcmToken", {
            callId,
            userId: uid,
            tokenSuffix: legacy.slice(-8),
            tokenLen: legacy.length,
          });
        }
        tokens.push(legacy);
      }
    }
  }

  if (callId) {
    functions.logger.info("[FCM] collectFcmTokensForUser: result", {
      callId,
      userId: uid,
      sendableTokenCount: tokens.length,
      sendableTokenSuffixes: tokens.map((t) => t.slice(-8)),
      subdocCount: tokensSnap.size,
      skippedNoCandidateSubdocs: skippedNoCandidate,
      prunedShort,
      prunedMalformed,
      prunedStale,
      skippedDisabledSubdocs: skippedDisabled,
      prunedTotalCommitted: toPrune.length,
    });
  }

  if (tokens.length === 0 && toPrune.length > 0) {
    functions.logger.warn("[FCM] no sendable tokens remain after pruning bad registration docs", {
      userId: uid,
      callId,
      prunedSubdocs: toPrune.length,
    });
  }

  if (callId && tokens.length === 0) {
    functions.logger.warn("[FCM] collectFcmTokensForUser: ZERO sendable tokens (check empty subcollection log, prune counts, legacy)", {
      callId,
      receiverId: uid,
      userDocumentPath: userRef.path,
      fcmTokensCollectionPath: tokensPath,
      subdocsReadFromQuery: tokensSnap.size,
      skippedNoCandidateSubdocs: skippedNoCandidate,
      prunedShort,
      prunedMalformed,
      prunedStale,
      skippedDisabledSubdocs: skippedDisabled,
    });
  }

  if (diag?.collectOutcome) {
    const o = diag.collectOutcome;
    if (tokens.length > 0) {
      o.code = "tokens_ready";
    } else if (tokensSnap.size === 0) {
      o.code = "empty_fcm_tokens_subcollection";
      o.subdocCount = 0;
    } else {
      o.code = "no_sendable_after_filter";
      o.subdocCount = tokensSnap.size;
      o.skippedNoCandidateSubdocs = skippedNoCandidate;
      o.prunedShort = prunedShort;
      o.prunedMalformed = prunedMalformed;
      o.prunedStale = prunedStale;
      o.skippedDisabledSubdocs = skippedDisabled;
    }
  }

  return tokens;
}

export async function collectFcmTokensForUsers(
  db: Firestore,
  userIds: string[]
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uid of userIds) {
    if (!uid) continue;
    for (const t of await collectFcmTokensForUser(db, uid)) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

/**
 * Remove one registration token for a user: deletes any `fcmTokens` doc whose stored value matches
 * (token field or doc id). Same underlying cleanup as post-send prune.
 */
export async function removeFcmTokenFromDatabase(
  db: Firestore,
  userId: string,
  token: string
): Promise<number> {
  const t = token.trim();
  if (!t) return 0;
  return removeUnusableFcmTokenDocsForUser(db, userId, [t]);
}

function computeFcmTokenDeletes(
  docs: QueryDocumentSnapshot[],
  rejectedList: string[]
): DocumentReference[] {
  const rejectedNorm = new Set(rejectedList.map((t) => normFcmToken(t)));
  const rejectedDocIds = expandRejectedFirestoreDocIds(rejectedList);

  const toDeleteByPath = new Map<string, DocumentReference>();

  for (const docSnap of docs) {
    const rawTok = docSnap.get("token");
    const fromField =
      rawTok === undefined || rawTok === null ? undefined : String(rawTok).trim();
    const stored = (fromField ?? docSnap.id).trim();

    let matchesRejected = rejectedDocIds.has(docSnap.id);
    if (!matchesRejected && fromField) {
      matchesRejected =
        rejectedNorm.has(normFcmToken(fromField)) ||
        docSnap.id === fcmTokenFirestoreDocIdRawTrim(fromField) ||
        docSnap.id === fcmTokenFirestoreDocIdRawTrim(normFcmToken(fromField));
    }
    if (!matchesRejected) {
      matchesRejected = rejectedNorm.has(normFcmToken(stored));
    }

    const unusableShape =
      !stored ||
      stored.length < FCM_MIN_STORED_TOKEN_LEN ||
      !isPlausibleFcmRegistrationToken(stored);

    if (unusableShape || matchesRejected) {
      toDeleteByPath.set(docSnap.ref.path, docSnap.ref);
    }
  }

  return Array.from(toDeleteByPath.values());
}

/**
 * Deletes `users/{userId}/fcmTokens` docs that FCM rejected or that are unusable; clears `users.fcmToken`
 * when it matches a rejected token (Unicode-normalized compare). Uses a Firestore transaction so read+delete
 * is consistent under concurrent writers. Only pass tokens from {@link isFcmTokenDefinitelyInvalidCode}.
 */
export async function removeUnusableFcmTokenDocsForUser(
  db: Firestore,
  userId: string,
  tokensRejectedByFcm: string[]
): Promise<number> {
  const rejectedList = tokensRejectedByFcm.map((t) => t.trim()).filter((t) => t.length > 0);
  const rejectedNormSet = new Set(rejectedList.map((t) => normFcmToken(t)));

  const userRef = db.collection("users").doc(userId);
  const tokensCol = userRef.collection("fcmTokens");

  /** Pre-transaction: resolve refs by deterministic doc id (client parity) + token field queries. */
  const queryRefs = new Map<string, DocumentReference>();
  for (const bad of rejectedList) {
    const idVariants = [
      fcmTokenFirestoreDocIdRawTrim(bad),
      fcmTokenFirestoreDocIdRawTrim(normFcmToken(bad)),
    ];
    const seenIds = new Set<string>();
    for (const docId of idVariants) {
      if (!docId || seenIds.has(docId)) continue;
      seenIds.add(docId);
      try {
        const ref = tokensCol.doc(docId);
        const ds = await ref.get();
        if (ds.exists) {
          queryRefs.set(ref.path, ref);
        }
      } catch (e) {
        functions.logger.warn("[FCM] fcmTokens doc get by id failed", {
          userId,
          docId,
          error: String(e),
        });
      }
    }
    try {
      const q = await tokensCol.where("token", "==", bad).get();
      for (const d of q.docs) {
        queryRefs.set(d.ref.path, d.ref);
      }
      const qNorm = await tokensCol.where("token", "==", normFcmToken(bad)).get();
      for (const d of qNorm.docs) {
        queryRefs.set(d.ref.path, d.ref);
      }
    } catch (e) {
      functions.logger.warn("[FCM] token equality query for cleanup failed", {
        userId,
        error: String(e),
      });
    }
  }

  let subdocCount = 0;
  let legacyCleared = 0;

  await db.runTransaction(async (tx) => {
    // Firestore: every read must run before any write in the same transaction.
    const snap = await tx.get(tokensCol.limit(500));
    const userSnap =
      rejectedNormSet.size > 0 ? await tx.get(userRef) : null;

    const refs = computeFcmTokenDeletes(snap.docs, rejectedList);
    const toDelete = new Map<string, DocumentReference>();
    refs.forEach((r) => toDelete.set(r.path, r));
    queryRefs.forEach((r, p) => toDelete.set(p, r));

    let clearLegacy = false;
    if (userSnap) {
      const legacyRaw = userSnap.get("fcmToken");
      const legacy =
        legacyRaw === undefined || legacyRaw === null ? undefined : String(legacyRaw).trim();
      if (legacy && rejectedNormSet.has(normFcmToken(legacy))) {
        clearLegacy = true;
      }
    }

    for (const ref of toDelete.values()) {
      tx.delete(ref);
    }
    subdocCount = toDelete.size;

    if (clearLegacy) {
      tx.update(userRef, { fcmToken: FieldValue.delete() });
      legacyCleared = 1;
    }
  });

  if (legacyCleared > 0) {
    functions.logger.info("[FCM] cleared users.fcmToken after FCM rejected that token (transaction)", {
      userId,
    });
  } else if (rejectedList.length > 0) {
    const u = await userRef.get();
    const legRaw = u.get("fcmToken");
    const legacy =
      legRaw === undefined || legRaw === null ? undefined : String(legRaw).trim();
    if (!legacy) {
      functions.logger.info("[FCM] users.fcmToken: no legacy field (subcollection-only registration)", {
        userId,
      });
    } else if (rejectedNormSet.has(normFcmToken(legacy))) {
      functions.logger.error(
        "[FCM] users.fcmToken still matches rejected token but was not cleared in transaction — bug or race",
        {
          userId,
          legacySuffix: legacy.slice(-12),
        }
      );
    } else {
      functions.logger.info(
        "[FCM] users.fcmToken legacy unchanged (differs from FCM-rejected subcollection token(s))",
        {
          userId,
          legacySuffix: legacy.slice(-12),
          rejectedSuffixes: rejectedList.map((t) => t.slice(-12)),
        }
      );
    }
  }

  /**
   * Fallback: only when there is exactly one `fcmTokens` **subdocument** (one token per doc in this app;
   * not an array on `users`). Delete that doc only if it matches a rejected token — never delete an unrelated row.
   */
  if (rejectedList.length > 0 && subdocCount === 0 && legacyCleared === 0) {
    const snap2 = await tokensCol.get();
    if (snap2.docs.length === 1) {
      const d0 = snap2.docs[0];
      if (!fcmSubdocMatchesAnyRejectedToken(d0, rejectedList)) {
        functions.logger.warn(
          "[FCM] sole fcmTokens subdoc does not match FCM-rejected token(s); skipping fallback delete",
          {
            userId,
            docId: d0.id,
            tokenFieldSuffix: String(d0.get("token") ?? "")
              .trim()
              .slice(-12) || "(empty)",
            rejectedSuffixes: rejectedList.map((t) => t.slice(-12)),
          }
        );
      } else {
        try {
          await d0.ref.delete();
          subdocCount = 1;
          functions.logger.info(
            "[FCM] pruned sole matching fcmTokens subdoc after FCM rejection (fallback; one device row)",
            {
              userId,
              docId: d0.id,
              matchedRejectedSuffix: rejectedList[0]?.slice(-12),
            }
          );
        } catch (e) {
          functions.logger.error("[FCM] fallback sole matching subdoc delete failed", {
            userId,
            error: String(e),
          });
        }
      }
    }
  }

  return subdocCount + legacyCleared;
}

/** Correlate Cloud Logging ↔ adb (`📦 MESSAGE SOURCE TRACE`). */
function nextFcmTraceId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isIncomingCallInviteData(data: Record<string, string>): boolean {
  const t = data.type;
  return t === "incoming_call" || t === "call_invite";
}

/** All call FCM (including incoming invites) must be data-only on Android. */
function assertDataOnlyMulticastMessage(message: import("firebase-admin/messaging").MulticastMessage): void {
  const m = message as unknown as Record<string, unknown>;
  if (m.notification != null) {
    throw new Error("❌ Notification payload not allowed for call FCM");
  }
  const android = m.android as Record<string, unknown> | undefined;
  if (android != null && "notification" in android && android.notification != null) {
    throw new Error("❌ android.notification not allowed for call FCM (breaks onMessageReceived)");
  }
  const webpush = m.webpush as Record<string, unknown> | undefined;
  if (webpush != null && "notification" in webpush && webpush.notification != null) {
    throw new Error("❌ webpush.notification not allowed for call FCM");
  }
}

function logFinalFcmPayload(
  message: import("firebase-admin/messaging").MulticastMessage,
  meta: { logLabel?: string; chunkBase: number }
): void {
  const fn = require("firebase-functions/v1") as typeof import("firebase-functions/v1");
  const tokenCount = message.tokens?.length ?? 0;
  fn.logger.debug("🚀 FINAL FCM PAYLOAD", {
    ...meta,
    tokenCount,
    payloadJson: JSON.stringify({
      data: message.data,
      android_priority: message.android?.priority,
      hasNotification: !!message.notification,
    }),
  });
}

function buildMulticastForCallData(
  chunk: string[],
  dataWithTrace: Record<string, string>,
  collapseKey: string
): import("firebase-admin/messaging").MulticastMessage {
  /** FCM `data` is the only user-visible channel on Android for our app — never set `notification`. */
  type AndroidCallConfig = import("firebase-admin/messaging").AndroidConfig & {
    /** Not official Android FCM field; forwarded if supported; harmless if stripped. Mirrors user wake hints. */
    contentAvailable?: boolean;
  };

  if (isIncomingCallInviteData(dataWithTrace)) {
    const android: AndroidCallConfig = {
      priority: "high",
      // 65 seconds: call times out after 60 s on the JS side; any FCM held longer than
      // that would show a "missed" call UI for a call that already ended server-side.
      ttl: 65,
      collapseKey,
      directBootOk: true,
      contentAvailable: true,
    };
    return {
      tokens: chunk,
      data: dataWithTrace,
      android,
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            contentAvailable: true,
            sound: "default",
          },
        },
      },
    };
  }

  const android: AndroidCallConfig = {
    priority: "high",
    collapseKey,
    directBootOk: true,
    contentAvailable: true,
  };

  return {
    tokens: chunk,
    data: dataWithTrace,
    android,
    apns: {
      headers: {
        "apns-priority": "10",
      },
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
    },
  };
}

/** Whole-request failure (not per-token). Retry only likely-transient faults. */
async function sendEachForMulticastWithRetry(
  message: import("firebase-admin/messaging").MulticastMessage,
  meta: { logLabel?: string; chunkBase: number }
): Promise<import("firebase-admin/messaging").BatchResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await messagingInstance().sendEachForMulticast(message);
    } catch (e) {
      lastError = e;
      const msg = String(e);
      const transient =
        /UNAVAILABLE|DEADLINE|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|socket hang up|503|500/i.test(
          msg
        );
      if (attempt < 2 && transient) {
        const delayMs = 300 * 2 ** attempt;
        functions.logger.warn("[FCM] sendEachForMulticast transient error; will retry", {
          ...meta,
          attempt: attempt + 1,
          delayMs,
          error: msg.slice(0, 240),
        });
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

/**
 * Send call-related multicast (data-only on Android so `onMessageReceived` always runs).
 */
export async function sendCallDataMulticast(
  tokens: string[],
  data: Record<string, string>,
  options?: {
    collapseKey?: string;
    logLabel?: string;
    /** If > 0 and `tokens.length` ≤ this, run `send(..., dryRun: true)` per token first to avoid real sends to known-dead registrations (caps FCM quota use). */
    preSendDryRunMaxTokens?: number;
  }
): Promise<{ successCount: number; failureCount: number; invalidTokens: string[] }> {
  if (tokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const invalidTokens = new Set<string>();
  const maxDry = options?.preSendDryRunMaxTokens ?? 0;
  let tokensToSend = tokens;
  if (maxDry > 0 && tokens.length <= maxDry) {
    const messaging = messagingInstance();
    const keep: string[] = [];
    for (const t of tokens) {
      const raw = t.trim();
      if (!raw) continue;
      try {
        await messaging.send({ token: raw, data: { _pre: "1" } }, true);
        keep.push(raw);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        const code = err.code;
        if (isFcmTokenDefinitelyInvalidCode(code)) {
          invalidTokens.add(raw);
          functions.logger.warn("[FCM] pre-send dry-run rejected token (skipping real multicast)", {
            logLabel: options?.logLabel,
            code,
            message: err.message,
            tokenSuffix: raw.slice(-12),
            tokenLength: raw.length,
          });
        } else {
          functions.logger.debug("[FCM] pre-send dry-run inconclusive; will attempt real send", {
            logLabel: options?.logLabel,
            code,
            tokenSuffix: raw.slice(-12),
          });
          keep.push(raw);
        }
      }
    }
    tokensToSend = keep;
  }

  if (tokensToSend.length === 0) {
    return {
      successCount: 0,
      failureCount: 0,
      invalidTokens: Array.from(invalidTokens),
    };
  }

  const dataWithTrace: Record<string, string> = {
    ...data,
    traceId: data.traceId ?? nextFcmTraceId(),
  };

  const collapseKey =
    options?.collapseKey ?? `gyw_${dataWithTrace.type ?? "call"}_${dataWithTrace.callId ?? "x"}`;

  functions.logger.debug("FCM CALL PAYLOAD:", {
    label: options?.logLabel ?? "multicast",
    tokenCount: tokensToSend.length,
    collapseKey,
    data: dataWithTrace,
    incomingUi: isIncomingCallInviteData(dataWithTrace),
  });

  let totalSuccess = 0;
  let totalFailure = 0;

  for (let i = 0; i < tokensToSend.length; i += FCM_CALL_CHUNK) {
    const chunk = tokensToSend.slice(i, i + FCM_CALL_CHUNK);
    const message = buildMulticastForCallData(chunk, dataWithTrace, collapseKey);
    assertDataOnlyMulticastMessage(message);
    logFinalFcmPayload(message, { logLabel: options?.logLabel, chunkBase: i });

    try {
      const resp = await sendEachForMulticastWithRetry(message, {
        logLabel: options?.logLabel,
        chunkBase: i,
      });
      totalSuccess += resp.successCount;
      totalFailure += resp.failureCount;
      functions.logger.debug("[FCM] sendEachForMulticast chunk result", {
        logLabel: options?.logLabel,
        chunkBase: i,
        successCount: resp.successCount,
        failureCount: resp.failureCount,
      });
      if (resp.failureCount > 0) {
        resp.responses.forEach((r, idx) => {
          if (!r.success) {
            const code = r.error?.code;
            const meta = {
              logLabel: options?.logLabel,
              chunkBase: i,
              idx,
              message: r.error?.message,
              code,
              tokenSuffix: chunk[idx]?.slice(-12),
              tokenLength: chunk[idx]?.length,
            };
            if (isFcmTokenDefinitelyInvalidCode(code)) {
              const bad = chunk[idx]?.trim();
              if (bad) {
                invalidTokens.add(bad);
              }
              functions.logger.warn("[FCM] token send rejected (invalid or unregistered; will prune)", meta);
            } else {
              functions.logger.error("[FCM] token send failed", meta);
            }
          }
        });
      }
    } catch (e) {
      functions.logger.error("[FCM] sendEachForMulticast error", {
        logLabel: options?.logLabel,
        chunkBase: i,
        error: String(e),
      });
    }
  }

  return {
    successCount: totalSuccess,
    failureCount: totalFailure,
    invalidTokens: Array.from(invalidTokens),
  };
}

export async function sendCallPushToUser(
  db: Firestore,
  userId: string,
  fields: Record<string, string | number | boolean | undefined | null>,
  options?: { collapseKey?: string; logLabel?: string }
): Promise<void> {
  const tokens = await collectFcmTokensForUser(db, userId);
  if (tokens.length === 0) {
    functions.logger.info("[FCM] no tokens for user", { userId, type: fields.type });
    return;
  }
  const data = stringifyCallData(fields);
  const result = await sendCallDataMulticast(tokens, data, {
    collapseKey: options?.collapseKey,
    logLabel: options?.logLabel ?? `user:${userId}`,
  });
  if (result.failureCount > 0 || result.invalidTokens.length > 0) {
    try {
      const removed = await removeUnusableFcmTokenDocsForUser(db, userId, result.invalidTokens);
      if (removed > 0) {
        functions.logger.info("[FCM] removed unusable token docs after send", {
          userId,
          removed,
          logLabel: options?.logLabel ?? `user:${userId}`,
        });
      }
    } catch (e) {
      functions.logger.warn("[FCM] token doc cleanup failed", { userId, error: String(e) });
    }
  }
}

export async function sendCallPushToUsers(
  db: Firestore,
  userIds: string[],
  fields: Record<string, string | number | boolean | undefined | null>,
  options?: { collapseKey?: string; logLabel?: string }
): Promise<void> {
  const tokens = await collectFcmTokensForUsers(db, userIds);
  if (tokens.length === 0) {
    functions.logger.info("[FCM] no tokens for users", { userIds, type: fields.type });
    return;
  }
  const data = stringifyCallData(fields);
  const result = await sendCallDataMulticast(tokens, data, options);
  if (result.failureCount > 0 || result.invalidTokens.length > 0) {
    for (const uid of userIds) {
      if (!uid) continue;
      try {
        const removed = await removeUnusableFcmTokenDocsForUser(db, uid, result.invalidTokens);
        if (removed > 0) {
          functions.logger.info("[FCM] removed unusable token docs after send (multi-user)", {
            userId: uid,
            removed,
            logLabel: options?.logLabel,
          });
        }
      } catch (e) {
        functions.logger.warn("[FCM] token doc cleanup failed", { userId: uid, error: String(e) });
      }
    }
  }
}
