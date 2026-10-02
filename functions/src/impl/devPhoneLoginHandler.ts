/**
 * Dev-only phone login when client Play Integrity / reCAPTCHA cannot obtain a client identifier.
 * Creates/updates a dev email user and returns credentials for signInWithEmailAndPassword
 * (avoids custom-token IAM signBlob requirement on Cloud Functions).
 */
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as functions from "firebase-functions/v1";

import { getDb } from "./adminApp";

type DevPhoneAuthDoc = {
  enabled?: boolean;
  phones?: Record<string, string>;
};

const BUILTIN_PHONES: Record<string, string> = {
  "+905369936898": "123456",
};

function normalizePhone(input: string): string {
  const cleaned = String(input || "").replace(/[^\d+]/g, "");
  if (!cleaned.startsWith("+") || cleaned.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid phone number");
  }
  return cleaned;
}

function devEmailForPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  return `dev.phone.${digits}@gyw-dev.internal`;
}

function devPasswordForPhone(phoneNumber: string, code: string): string {
  const secret = process.env.GYW_DEV_PHONE_SECRET ?? "gyw-dev-phone-v1";
  return crypto
    .createHmac("sha256", secret)
    .update(`${phoneNumber}:${code}`)
    .digest("hex")
    .slice(0, 32);
}

async function loadAllowlist(): Promise<Record<string, string>> {
  const merged = { ...BUILTIN_PHONES };
  try {
    const snap = await getDb().collection("system").doc("devPhoneAuth").get();
    const data = snap.data() as DevPhoneAuthDoc | undefined;
    if (data?.enabled === false) return merged;
    if (data?.phones) {
      for (const [phone, code] of Object.entries(data.phones)) {
        merged[phone] = String(code);
      }
    }
  } catch (e) {
    functions.logger.warn("[devPhoneLogin] allowlist read failed, using builtin", e);
  }
  return merged;
}

export async function handleDevPhoneLogin(
  data: { phoneNumber?: string; code?: string },
  _context: functions.https.CallableContext
): Promise<{ uid: string; phoneNumber: string | null; email: string; password: string }> {
  const phoneNumber = normalizePhone(String(data?.phoneNumber ?? ""));
  const code = String(data?.code ?? "").trim();

  if (code.length < 4) {
    throw new functions.https.HttpsError("invalid-argument", "Verification code required");
  }

  const allowlist = await loadAllowlist();
  const expected = allowlist[phoneNumber];
  if (!expected) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This phone is not in the dev allowlist. Add EXPO_PUBLIC_DEV_PHONE_CODES or Firestore system/devPhoneAuth."
    );
  }
  if (code !== expected) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid verification code");
  }

  const email = devEmailForPhone(phoneNumber);
  const password = devPasswordForPhone(phoneNumber, expected);

  let uid: string;
  let signInEmail = email;

  try {
    const byPhone = await admin.auth().getUserByPhoneNumber(phoneNumber);
    uid = byPhone.uid;
    signInEmail = byPhone.email ?? email;
    await admin.auth().updateUser(uid, { password });
    if (!byPhone.email) {
      try {
        await admin.auth().updateUser(uid, { email });
      } catch (linkErr) {
        functions.logger.warn("[devPhoneLogin] could not attach dev email to existing phone user", linkErr);
      }
    }
  } catch (phoneErr: unknown) {
    const pCode = (phoneErr as { code?: string })?.code;
    if (pCode !== "auth/user-not-found") {
      functions.logger.error("[devPhoneLogin] getUserByPhoneNumber failed", phoneErr);
      throw new functions.https.HttpsError("internal", "Failed to look up user by phone");
    }

    try {
      const byEmail = await admin.auth().getUserByEmail(email);
      uid = byEmail.uid;
      signInEmail = email;
      await admin.auth().updateUser(uid, { password });
      try {
        await admin.auth().updateUser(uid, { phoneNumber });
      } catch {
        /* phone may belong to another account */
      }
    } catch (emailErr: unknown) {
      const eCode = (emailErr as { code?: string })?.code;
      if (eCode !== "auth/user-not-found") {
        functions.logger.error("[devPhoneLogin] getUserByEmail failed", emailErr);
        throw new functions.https.HttpsError("internal", "Failed to look up dev user");
      }
      const created = await admin.auth().createUser({ email, password });
      uid = created.uid;
      signInEmail = email;
      try {
        await admin.auth().updateUser(uid, { phoneNumber });
      } catch {
        /* non-fatal */
      }
    }
  }

  functions.logger.info("[devPhoneLogin] dev credentials issued", {
    uidPrefix: uid.slice(0, 8),
    phoneSuffix: phoneNumber.slice(-4),
  });

  return { uid, phoneNumber, email: signInEmail, password };
}
