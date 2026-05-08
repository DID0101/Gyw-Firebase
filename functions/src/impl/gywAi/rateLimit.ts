import { FieldValue, type Firestore } from "firebase-admin/firestore";
import * as functionsV1 from "firebase-functions/v1";

type RateLimitState = {
  windowStartMs: number;
  count: number;
  updatedAt?: FirebaseFirestore.FieldValue;
};

/**
 * Firestore-backed per-user fixed-window rate limit.
 * - One doc per uid: `aiRateLimits/{uid}`
 * - Uses a transaction for correctness under concurrency.
 */
export async function enforcePerUserRateLimit(params: {
  db: Firestore;
  uid: string;
  limitPerMinute: number;
  nowMs?: number;
}): Promise<void> {
  const { db, uid, limitPerMinute } = params;
  const nowMs = params.nowMs ?? Date.now();
  const windowMs = 60_000;

  const ref = db.collection("aiRateLimits").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? (snap.data() as Partial<RateLimitState>) : {}) ?? {};

    const prevWindowStartMs = typeof data.windowStartMs === "number" ? data.windowStartMs : 0;
    const prevCount = typeof data.count === "number" ? data.count : 0;

    const sameWindow = nowMs - prevWindowStartMs < windowMs;
    const windowStartMs = sameWindow ? prevWindowStartMs : nowMs;
    const nextCount = (sameWindow ? prevCount : 0) + 1;

    if (nextCount > limitPerMinute) {
      throw new functionsV1.https.HttpsError(
        "resource-exhausted",
        "Too many Gyw AI requests. Please wait a moment and try again."
      );
    }

    tx.set(
      ref,
      {
        windowStartMs,
        count: nextCount,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

