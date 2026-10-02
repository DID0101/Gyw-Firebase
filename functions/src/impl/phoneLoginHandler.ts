/**
 * Server-side Firebase Phone Auth (Identity Toolkit REST).
 * Fallback when client Play Integrity + reCAPTCHA fail (auth/missing-client-identifier).
 *
 * Real numbers still need a recaptcha/integrity token on the Identity Toolkit API.
 * Firebase Console test phone numbers work with API key only (no SMS charge).
 */
import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { GoogleAuth } from "google-auth-library";

import { getDb } from "./adminApp";

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";
const RATE_LIMIT_COLLECTION = "phoneLoginRateLimits";

/** Web API key — same project as lib/firebase.ts (gyw1-146d7). */
const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY ?? "AIzaSyBctdX2zyTERwPQGPdfWzhNmZKBJtxiuns";

type SendRequest = { phoneNumber?: string; recaptchaToken?: string };
type VerifyRequest = { sessionInfo?: string; code?: string; phoneNumber?: string };

type IdentityErrorBody = {
  error?: { message?: string; code?: number };
};

function normalizePhone(input: string): string {
  const cleaned = String(input || "").replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+") || cleaned.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid phone number");
  }
  return cleaned;
}

function mapIdentityError(status: number, text: string): functions.https.HttpsError {
  let message = "unknown";
  try {
    const parsed = JSON.parse(text) as IdentityErrorBody;
    message = parsed.error?.message ?? message;
  } catch {
    message = text.slice(0, 200);
  }

  functions.logger.error("[phoneLogin] identity error", { status, message, text });

  if (message.includes("TOO_MANY_ATTEMPTS")) {
    return new functions.https.HttpsError(
      "resource-exhausted",
      "Firebase temporarily blocked OTP for this number/device. Wait 1–2 hours, or add a Firebase test phone number (Auth → Phone → test numbers) and use that in dev."
    );
  }
  if (message.includes("MISSING_CLIENT_IDENTIFIER")) {
    return new functions.https.HttpsError(
      "failed-precondition",
      "Server OTP also needs app verification. Add a Firebase test phone number (Auth → Phone → test numbers), enable Play Integrity API in Google Cloud for gyw1-146d7, and add SHA-256 FA:C6:17:45:… to Firebase Android app settings."
    );
  }
  if (message.includes("INVALID_PHONE_NUMBER")) {
    return new functions.https.HttpsError("invalid-argument", "Invalid phone number format.");
  }

  return new functions.https.HttpsError(
    "failed-precondition",
    `Phone verification failed (${status}: ${message}).`
  );
}

async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const auth = new GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/identitytoolkit",
        "https://www.googleapis.com/auth/cloud-platform",
      ],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token ?? null;
  } catch (e) {
    functions.logger.warn("[phoneLogin] service account token unavailable", e);
    return null;
  }
}

async function identityPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const url = `${IDENTITY_BASE}/${path}?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`;
  const accessToken = await getGoogleAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw mapIdentityError(res.status, text);
  }
  return JSON.parse(text) as T;
}

async function assertRateLimit(key: string, maxPerHour: number): Promise<void> {
  const db = getDb();
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(key);
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { attempts?: number[] } | undefined;
    const attempts = (data?.attempts ?? []).filter((t) => t > hourAgo);
    if (attempts.length >= maxPerHour) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Too many OTP requests. Try again in an hour."
      );
    }
    attempts.push(now);
    tx.set(ref, { attempts, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function handleSendPhoneLoginOtp(
  data: SendRequest,
  context: functions.https.CallableContext
): Promise<{ sessionInfo: string; mode: "server" }> {
  const phoneNumber = normalizePhone(String(data?.phoneNumber ?? ""));
  const recaptchaToken = String(data?.recaptchaToken ?? "").trim();
  const rateKey = `${context.auth?.uid ?? "anon"}_${phoneNumber.replace(/\D/g, "").slice(-10)}`;
  await assertRateLimit(`send_${rateKey}`, 8);

  const body: Record<string, unknown> = { phoneNumber };
  if (recaptchaToken) {
    body.recaptchaToken = recaptchaToken;
  }

  const result = await identityPost<{ sessionInfo?: string }>("accounts:sendVerificationCode", body);

  if (!result.sessionInfo) {
    throw new functions.https.HttpsError("internal", "No sessionInfo returned from Identity Toolkit");
  }

  functions.logger.info("[phoneLogin] OTP sent via server", {
    phoneSuffix: phoneNumber.slice(-4),
    uid: context.auth?.uid ?? null,
  });

  return { sessionInfo: result.sessionInfo, mode: "server" };
}

export async function handleVerifyPhoneLoginOtp(
  data: VerifyRequest,
  context: functions.https.CallableContext
): Promise<{ customToken: string; uid: string; phoneNumber: string | null }> {
  const sessionInfo = String(data?.sessionInfo ?? "").trim();
  const code = String(data?.code ?? "").trim();
  const phoneNumber = data?.phoneNumber ? normalizePhone(data.phoneNumber) : null;

  if (!sessionInfo || code.length !== 6) {
    throw new functions.https.HttpsError("invalid-argument", "sessionInfo and 6-digit code required");
  }

  const rateKey = `${context.auth?.uid ?? "anon"}_${phoneNumber?.replace(/\D/g, "").slice(-10) ?? "unknown"}`;
  await assertRateLimit(`verify_${rateKey}`, 12);

  const signIn = await identityPost<{
    localId?: string;
    phoneNumber?: string;
    idToken?: string;
  }>("accounts:signInWithPhoneNumber", {
    sessionInfo,
    code,
  });

  const uid = signIn.localId;
  if (!uid) {
    throw new functions.https.HttpsError("internal", "Phone sign-in did not return a user id");
  }

  const resolvedPhone = signIn.phoneNumber ?? phoneNumber;
  const customToken = await admin.auth().createCustomToken(uid, {
    phone_login: true,
    phone: resolvedPhone ?? null,
  });

  functions.logger.info("[phoneLogin] verified via server", {
    uidPrefix: uid.slice(0, 8),
    phoneSuffix: resolvedPhone?.slice(-4) ?? null,
  });

  return {
    customToken,
    uid,
    phoneNumber: resolvedPhone ?? null,
  };
}
