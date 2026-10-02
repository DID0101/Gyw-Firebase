#!/usr/bin/env node
/**
 * Callee accept-path probe: launch app, show IncomingCallActivity, tap Accept, dump trace logs.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const metroHost = process.env.METRO_HOST || '192.168.1.102';
const metroUrl = encodeURIComponent(`http://${metroHost}:8081`);
const devClientUri = `exp+gyw://expo-development-client/?url=${metroUrl}`;

const TRACE_ORDER = [
  'ACCEPT_CLICK',
  'ACCEPT_NATIVE_HANDLER_ENTER',
  'ACCEPT_DEEPLINK_START',
  'MAIN_ACTIVITY_ONCREATE',
  'MAIN_ACTIVITY_ONNEWINTENT',
  'ACCEPT_JS_EMIT_OK',
  'ACCEPT_JS_EMIT_FAILED',
  'ACCEPT_JS_EVENT_RECEIVED',
  'ACCEPT_GET_INITIAL_INTENT',
  'CALL_ACCEPT_NAVIGATION_START',
  'CALL_ACCEPT_NAVIGATION_SUCCESS',
  'CALL_SCREEN_MOUNTED',
  'DO_ACCEPT_CALL_START',
  'WEBRTC_CREATE_PEER_START',
  'WEBRTC_CREATE_ANSWER_START',
  'WEBRTC_CREATE_ANSWER_SUCCESS',
  'WEBRTC_SEND_ANSWER_FIRESTORE',
  'WEBRTC_SEND_ICE',
];

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function shIgnore(cmd) {
  try {
    return sh(cmd);
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findAcceptTap() {
  const dumpPath = path.join(os.tmpdir(), 'gyw-accept-probe.xml');
  shIgnore('adb shell uiautomator dump /sdcard/accept-probe.xml');
  shIgnore(`adb pull /sdcard/accept-probe.xml "${dumpPath}"`);
  if (!fs.existsSync(dumpPath)) return { x: 540, y: 1350 };
  const xml = fs.readFileSync(dumpPath, 'utf8');
  const patterns = [
    /text="Accept"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i,
    /content-desc="Accept"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i,
    /text="Accept"[^>]*clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i,
    /clickable="true"[^>]*text="Accept"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/i,
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) {
      return {
        x: Math.floor((+m[1] + +m[3]) / 2),
        y: Math.floor((+m[2] + +m[4]) / 2),
      };
    }
  }
  return { x: 540, y: 1350 };
}

function firstMissing(logText) {
  for (const tag of TRACE_ORDER) {
    if (!logText.includes(tag)) return tag;
  }
  return null;
}

(async () => {
  const callId = `PROBE${Date.now().toString(36).slice(-8)}`;
  console.log('[accept-probe] callId=', callId);

  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore('adb logcat -c');
  shIgnore(`adb shell am force-stop ${pkg}`);

  console.log('[accept-probe] launch dev client');
  shIgnore(
    `adb shell am start -a android.intent.action.VIEW -d "${devClientUri}" -p ${pkg}`,
  );

  console.log('[accept-probe] open Gyw from dev launcher');
  let opened = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const dumpPath = path.join(os.tmpdir(), 'gyw-dev-launcher.xml');
    shIgnore('adb shell uiautomator dump /sdcard/dev-launcher.xml');
    shIgnore(`adb pull /sdcard/dev-launcher.xml "${dumpPath}"`);
    if (fs.existsSync(dumpPath)) {
      const xml = fs.readFileSync(dumpPath, 'utf8');
      const m = xml.match(
        /content-desc="Gyw[^"]*"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/,
      );
      if (m) {
        const x = Math.floor((+m[1] + +m[3]) / 2);
        const y = Math.floor((+m[2] + +m[4]) / 2);
        console.log('[accept-probe] tap dev launcher project at', { x, y });
        shIgnore(`adb shell input tap ${x} ${y}`);
        opened = true;
        break;
      }
    }
    await sleep(2000);
  }
  if (!opened) console.warn('[accept-probe] dev launcher project tap missed');

  console.log('[accept-probe] wait for RN home (45s)…');
  let rnReady = false;
  for (let i = 0; i < 23; i++) {
    await sleep(2000);
    const log = shIgnore('adb logcat -d -s ReactNativeJS:I');
    if (
      log.includes('CONTACTS_CACHE_READY') ||
      (log.includes('Running "main"') && log.includes('chat_title'))
    ) {
      rnReady = true;
      console.log('[accept-probe] RN home ready at', (i + 1) * 2, 's');
      break;
    }
  }
  if (!rnReady) console.warn('[accept-probe] RN home may not be ready — continuing');

  await sleep(2000);
  shIgnore('adb logcat -c');

  console.log('[accept-probe] show IncomingCallActivity + auto-accept intent');
  shIgnore(
    `adb shell am start -n ${pkg}/.IncomingCallActivity -a ACTION_ACCEPT_CALL --es callId ${callId} --es chatId ${callId} --es callType audio --es callerName ProbeCaller`,
  );
  await sleep(2000);

  const tap = findAcceptTap();
  if (tap.x !== 540 || tap.y !== 1350) {
    console.log('[accept-probe] fallback tap Accept at', tap);
    shIgnore(`adb shell input tap ${tap.x} ${tap.y}`);
  }
  await sleep(18000);

  const logFile = path.join(os.tmpdir(), `gyw-accept-${callId}.log`);
  shIgnore(`adb logcat -d > "${logFile}"`);
  const combined = fs.readFileSync(logFile, 'utf8');
  const nativeLog = combined;
  const jsLog = combined;

  console.log('\n=== HIT TAGS ===');
  for (const tag of TRACE_ORDER) {
    if (combined.includes(tag)) console.log('  OK', tag);
  }

  const missing = firstMissing(combined);
  console.log('\n=== FIRST MISSING ===');
  console.log(missing ?? '(all present)');

  console.log('\n=== LOG FILE ===', logFile);
  console.log(
    combined
      .split('\n')
      .filter((l) => /ACCEPT_|MAIN_ACTIVITY|DEEPLINK|EMIT|CALL_ACCEPT|CALL_SCREEN|DO_ACCEPT|WEBRTC_/.test(l))
      .join('\n') || '(none)',
  );

  if (missing) process.exit(1);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
