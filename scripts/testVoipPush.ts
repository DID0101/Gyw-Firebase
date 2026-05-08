#!/usr/bin/env ts-node
/**
 * scripts/testVoipPush.ts
 *
 * CLI tool — send a real VoIP push directly to an iOS device via
 * the APNs HTTP/2 API using node-apn.
 *
 * Why use this instead of testCallPush.ts?
 *   • FCM → APNs relay can add 1-3 s of latency on the first message.
 *   • PushKit / CallKit require apns-push-type: voip and a VoIP certificate.
 *     Firebase's HTTP v1 API cannot set that header — only direct APNs can.
 *   • This script hits APNs directly, bypassing FCM entirely, so you can
 *     verify your GywVoIPPushDelegate.swift receives the push independently
 *     of FCM configuration issues.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   npx ts-node scripts/testVoipPush.ts \
 *     --deviceToken <hex_voip_device_token>    (required)
 *     --keyPath     /path/to/AuthKey_XXXXX.p8  (required)
 *     --keyId       XXXXXXXXXX                 (required, 10-char key ID)
 *     --teamId      XXXXXXXXXX                 (required, 10-char team ID)
 *     [--bundleId   com.tropicolx.signal-clone]
 *     [--callId     <uuid>]
 *     [--callerName "Test Caller"]
 *     [--type       audio|video]
 *     [--production]                           (default: sandbox/dev APNs)
 *     [--cancel]                               (send CALL_CANCELLED payload)
 *
 * ── Alt: env vars ──────────────────────────────────────────────────────────
 *   APNS_KEY_P8      full .p8 key content (multiline, or \n-escaped)
 *   APNS_KEY_ID      10-char key ID
 *   APNS_TEAM_ID     10-char team ID
 *   IOS_BUNDLE_ID    bundle identifier
 *   NODE_ENV         "production" to use prod APNs gateway
 *
 * ── Run from project root ──────────────────────────────────────────────────
 *   Relies on node-apn installed in functions/node_modules.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Resolve node-apn from functions/node_modules ──────────────────────────
let apn: any;
try {
  apn = require('../functions/node_modules/apn');
} catch {
  try {
    apn = require('apn');
  } catch {
    console.error('[testVoipPush] node-apn not found.');
    console.error('  Run:  cd functions && npm install');
    process.exit(1);
  }
}

// ── Arg parser ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key  = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    }
  }
  return result;
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── APNs sender ───────────────────────────────────────────────────────────

interface VoipSendOptions {
  deviceToken:  string;
  keyContent:   string;   // .p8 file content
  keyId:        string;
  teamId:       string;
  bundleId:     string;
  production:   boolean;
  callId:       string;
  callerName:   string;
  callType:     'audio' | 'video';
  isCancel:     boolean;
}

async function sendVoipPush(opts: VoipSendOptions): Promise<void> {
  const {
    deviceToken, keyContent, keyId, teamId,
    bundleId, production, callId, callerName, callType, isCancel,
  } = opts;

  const provider = new apn.Provider({
    token: {
      key:    Buffer.from(keyContent, 'utf8'),
      keyId,
      teamId,
    },
    production,
  });

  const note            = new apn.Notification();
  note.topic            = `${bundleId}.voip`;  // MUST be <bundleId>.voip for PushKit
  note.pushType         = 'voip';              // apns-push-type: voip
  note.priority         = 10;                  // apns-priority: 10 (immediate)
  note.expiry           = Math.floor(Date.now() / 1000) + 30; // 30 s TTL

  note.payload = isCancel
    ? {
        type:         'CALL_CANCELLED',
        callId,
        callerId:     'debug-caller-uid',
        callerName,
        callerAvatar: '',
        callType,
      }
    : {
        type:         'INCOMING_CALL',
        callId,
        callerId:     'debug-caller-uid',
        callerName,
        callerAvatar: '',
        callType,
      };

  const gateway = production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

  console.log('\n── Sending APNs VoIP push ───────────────────────────────────');
  console.log('  Gateway     :', gateway);
  console.log('  Topic       :', note.topic);
  console.log('  DeviceToken :', `${deviceToken.slice(0, 12)}...${deviceToken.slice(-8)}`);
  console.log('  KeyId       :', keyId);
  console.log('  TeamId      :', teamId);
  console.log('  Type        :', note.payload.type);
  console.log('  CallId      :', callId);
  console.log('  Caller      :', callerName);
  console.log('  CallType    :', callType);
  console.log('────────────────────────────────────────────────────────────\n');

  const start = Date.now();

  try {
    const result = await provider.send(note, deviceToken) as {
      sent:   Array<{ device: string }>;
      failed: Array<{ device: string; error?: Error; response?: { reason?: string; statusCode?: number } }>;
    };

    const elapsed = Date.now() - start;

    if (result.failed.length > 0) {
      const failure = result.failed[0];
      const reason  = failure.response?.reason ?? failure.error?.message ?? 'Unknown';
      const status  = failure.response?.statusCode;

      console.error('❌ APNs rejected the push');
      console.error('  Reason      :', reason);
      if (status) console.error('  Status code :', status);
      console.error('');
      console.error('Common reasons:');
      console.error('  BadDeviceToken    → Token is invalid or for the wrong environment');
      console.error('  BadTopic          → bundleId doesn't match the VoIP cert');
      console.error('  DeviceTokenNotForTopic → Using wrong cert type (need VoIP cert)');
      console.error('  Unregistered      → Device uninstalled the app');
      process.exit(1);
    }

    console.log('✅ Delivered');
    console.log('  Sent        :', result.sent.length);
    console.log('  Latency     :', `${elapsed} ms`);

    if (!isCancel) {
      console.log('\n  GywVoIPPushDelegate.swift should have fired within ~1 s.');
      console.log('  If nothing happened:');
      console.log('    1. Confirm the .p8 key is a VoIP Services cert (not standard APNS)');
      console.log('    2. Confirm the device is on sandbox vs production');
      console.log('    3. Check Xcode → Devices log for "Received VoIP push"');
    }
  } finally {
    provider.shutdown();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // Required
  const deviceToken = args.deviceToken as string | undefined;
  if (!deviceToken) {
    console.error('Usage: npx ts-node scripts/testVoipPush.ts --deviceToken <hex> --keyPath <.p8> ...');
    console.error('');
    console.error('Required:');
    console.error('  --deviceToken  <hex>    VoIP device token from PushKit');
    console.error('  --keyPath      <file>   Path to .p8 VoIP key file  (or APNS_KEY_P8 env)');
    console.error('  --keyId        <10chr>  Key ID from Apple Dev portal (or APNS_KEY_ID env)');
    console.error('  --teamId       <10chr>  Team ID from Apple Dev portal (or APNS_TEAM_ID env)');
    console.error('');
    console.error('Optional:');
    console.error('  --bundleId     com.tropicolx.signal-clone  (default)');
    console.error('  --callId       <uuid>                      (auto-generated)');
    console.error('  --callerName   "Name"                      (default: "Test Caller")');
    console.error('  --type         audio|video                 (default: audio)');
    console.error('  --production                               (use prod APNs; default: sandbox)');
    console.error('  --cancel                                   Send CALL_CANCELLED instead');
    process.exit(1);
  }

  // Key material: --keyPath file wins over APNS_KEY_P8 env
  let keyContent: string;
  if (args.keyPath) {
    const keyFile = path.resolve(args.keyPath as string);
    if (!fs.existsSync(keyFile)) {
      console.error(`[testVoipPush] Key file not found: ${keyFile}`);
      process.exit(1);
    }
    keyContent = fs.readFileSync(keyFile, 'utf8');
  } else if (process.env.APNS_KEY_P8) {
    keyContent = process.env.APNS_KEY_P8.replace(/\\n/g, '\n');
  } else {
    console.error('[testVoipPush] Provide --keyPath or set APNS_KEY_P8 env var');
    process.exit(1);
  }

  const keyId = (args.keyId as string | undefined)
    || process.env.APNS_KEY_ID
    || '';
  const teamId = (args.teamId as string | undefined)
    || process.env.APNS_TEAM_ID
    || '';

  if (!keyId || !teamId) {
    console.error('[testVoipPush] --keyId and --teamId are required (or APNS_KEY_ID / APNS_TEAM_ID)');
    process.exit(1);
  }

  const bundleId   = (args.bundleId   as string | undefined) || process.env.IOS_BUNDLE_ID || 'com.tropicolx.signal-clone';
  const callId     = (args.callId     as string | undefined) || uuidv4();
  const callerName = (args.callerName as string | undefined) || 'Test Caller';
  const callType   = (args.type as string) === 'video' ? 'video' : 'audio';
  const production = !!args.production || process.env.NODE_ENV === 'production';
  const isCancel   = !!args.cancel;

  try {
    await sendVoipPush({
      deviceToken,
      keyContent,
      keyId,
      teamId,
      bundleId,
      production,
      callId,
      callerName,
      callType,
      isCancel,
    });

    // Auto-cancel after 30 s
    if (!isCancel && !args['no-auto-cancel']) {
      console.log('\n⏳ Auto-cancelling in 30 s  (pass --no-auto-cancel to skip)...\n');
      await new Promise((r) => setTimeout(r, 30_000));
      await sendVoipPush({
        deviceToken,
        keyContent,
        keyId,
        teamId,
        bundleId,
        production,
        callId,
        callerName,
        callType,
        isCancel: true,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n❌ Fatal error:', msg);
    process.exit(1);
  }

  process.exit(0);
}

main();
