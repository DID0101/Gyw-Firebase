#!/usr/bin/env ts-node
/**
 * scripts/testCallPush.ts
 *
 * CLI tool — send a test INCOMING_CALL (or CALL_CANCELLED) FCM data-only
 * message to a specific device token via the Firebase Admin SDK.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   npx ts-node scripts/testCallPush.ts \
 *     --token <fcm_device_token>         (required)
 *     --platform android|ios             (default: android)
 *     --type    audio|video              (default: audio)
 *     --callId  <uuid>                   (default: auto-generated)
 *     --callerName "Display Name"        (default: "Test Caller")
 *     --cancel                           (send CALL_CANCELLED instead)
 *
 * ── Auth ───────────────────────────────────────────────────────────────────
 *   Option A (recommended):
 *     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 *   Option B (env vars):
 *     export GYW_PROJECT_ID=gyw1-146d7
 *     export GYW_CLIENT_EMAIL=firebase-adminsdk-...@gyw1-146d7.iam.gserviceaccount.com
 *     export GYW_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
 *
 * ── Run from project root ──────────────────────────────────────────────────
 *   Relies on firebase-admin installed in functions/node_modules.
 *   Requires ts-node: npm install -g ts-node  OR  npx ts-node
 */

// ── Resolve firebase-admin from functions/node_modules ────────────────────
let admin: typeof import('firebase-admin');
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  admin = require('../functions/node_modules/firebase-admin') as typeof import('firebase-admin');
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    admin = require('firebase-admin') as typeof import('firebase-admin');
  } catch {
    console.error('[testCallPush] firebase-admin not found.');
    console.error('  Run:  cd functions && npm install');
    process.exit(1);
  }
}

// ── Simple arg parser ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true; // boolean flag
      } else {
        result[key] = next;
        i++;
      }
    }
  }
  return result;
}

// ── Helper: random UUID v4 ────────────────────────────────────────────────

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Firebase Admin init ───────────────────────────────────────────────────

function initAdmin(): void {
  if (admin.apps.length > 0) return;

  const projectId   = process.env.GYW_PROJECT_ID   || 'gyw1-146d7';
  const clientEmail = process.env.GYW_CLIENT_EMAIL;
  const privateKey  = process.env.GYW_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential:  admin.credential.applicationDefault(),
      projectId,
    });
    console.log('[testCallPush] Auth: GOOGLE_APPLICATION_CREDENTIALS');
  } else if (clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
    console.log('[testCallPush] Auth: env-var service account');
  } else {
    console.error('[testCallPush] No credentials found.');
    console.error('  Set GOOGLE_APPLICATION_CREDENTIALS or GYW_CLIENT_EMAIL + GYW_PRIVATE_KEY');
    process.exit(1);
  }
}

// ── FCM sender ────────────────────────────────────────────────────────────

interface SendOptions {
  token:       string;
  platform:    'android' | 'ios';
  callType:    'audio' | 'video';
  callId:      string;
  callerName:  string;
  isCancel:    boolean;
}

async function sendFCM(opts: SendOptions): Promise<void> {
  const { token, platform, callType, callId, callerName, isCancel } = opts;

  const type = isCancel ? 'CALL_CANCELLED' : 'incoming_call';

  const data: Record<string, string> = {
    type,
    callId,
    callerId:     'debug-caller-uid',
    callerName,
    callerAvatar: '',
    callType,
  };

  const message: admin.messaging.Message = {
    token,
    data,
    android: {
      priority: 'high',
      ttl:      30_000,
    },
  };

  // For iOS FCM: add APNS config so the message wakes the app
  if (platform === 'ios') {
    message.apns = {
      headers: {
        'apns-priority':   '10',
        'apns-push-type':  'background',
      },
      payload: {
        aps: {
          'content-available': 1,
        },
      },
    };
  }

  console.log('\n── Sending FCM message ──────────────────────────────────────');
  console.log('  Project  :', admin.app().options.projectId);
  console.log('  Token    :', `${token.slice(0, 20)}...${token.slice(-8)}`);
  console.log('  Platform :', platform);
  console.log('  Type     :', type);
  console.log('  CallId   :', callId);
  console.log('  Caller   :', callerName);
  console.log('  CallType :', callType);
  console.log('────────────────────────────────────────────────────────────\n');

  const start = Date.now();
  const messageId = await admin.messaging().send(message);
  const elapsed   = Date.now() - start;

  console.log('✅ Delivered');
  console.log('  MessageId :', messageId);
  console.log('  Latency   :', `${elapsed} ms`);
}

// ── Cancel helper ──────────────────────────────────────────────────────────

async function sendCancel(opts: SendOptions): Promise<void> {
  await sendFCM({ ...opts, isCancel: true });
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const token = args.token as string | undefined;
  if (!token) {
    console.error('Usage: npx ts-node scripts/testCallPush.ts --token <fcm_token> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --token       <string>   FCM device registration token (required)');
    console.error('  --platform    android|ios        (default: android)');
    console.error('  --type        audio|video        (default: audio)');
    console.error('  --callId      <uuid>             (default: auto-generated)');
    console.error('  --callerName  <string>           (default: "Test Caller")');
    console.error('  --cancel                         Send CALL_CANCELLED instead');
    process.exit(1);
  }

  const platform   = (args.platform as string) === 'ios' ? 'ios' : 'android';
  const callType   = (args.type     as string) === 'video' ? 'video' : 'audio';
  const callId     = (args.callId   as string) || uuidv4();
  const callerName = (args.callerName as string) || 'Test Caller';
  const isCancel   = !!args.cancel;

  initAdmin();

  try {
    const opts: SendOptions = { token, platform, callType, callId, callerName, isCancel };

    if (isCancel) {
      await sendCancel(opts);
    } else {
      await sendFCM({ ...opts, isCancel: false });

      // Offer to auto-cancel after 30s
      if (!args['no-auto-cancel']) {
        console.log('\n⏳ Auto-cancelling in 30 s  (run with --no-auto-cancel to skip)...\n');
        await new Promise((r) => setTimeout(r, 30_000));
        await sendCancel({ ...opts, isCancel: true });
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n❌ FCM send failed:', msg);

    if (msg.includes('registration-token-not-registered')) {
      console.error('  → Token is stale. Get a fresh token from the device.');
    } else if (msg.includes('invalid-argument')) {
      console.error('  → Malformed token or message payload.');
    }

    process.exit(1);
  }

  process.exit(0);
}

main();
