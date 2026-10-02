#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const phone = process.env.AUTH_PROBE_PHONE || '905526055206';
const metroPort = process.env.METRO_PORT || '8082';
const pkg = 'com.gyw1.chat';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function dump() {
  const p = path.join(os.tmpdir(), 'gyw-otp-probe.xml');
  sh('adb shell uiautomator dump /sdcard/gyw-otp-probe.xml');
  sh(`adb pull /sdcard/gyw-otp-probe.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function tapId(xml, id) {
  const re = new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  sh(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}

function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`),
    new RegExp(`bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*text="${esc}"`),
    new RegExp(`content-desc="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (!m) continue;
    sh(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
    return true;
  }
  return false;
}

sh(`adb reverse tcp:${metroPort} tcp:${metroPort}`);
sh(`adb shell am force-stop ${pkg}`);
const devUri = encodeURIComponent(`http://127.0.0.1:${metroPort}`);
sh(
  `adb shell am start -a android.intent.action.VIEW -d "exp+gyw://expo-development-client/?url=${devUri}" -p ${pkg}`,
);
console.log(`[probe] launched dev client on port ${metroPort}, waiting 25s...`);
await sleep(25_000);

let xml = dump();
const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
console.log('[probe] screen:', texts.slice(0, 15).join(' | '));

for (let step = 0; step < 8; step++) {
  if (xml.includes('auth-phone-input')) break;
  if (tapText(xml, 'OK')) {
    await sleep(1200);
    xml = dump();
    continue;
  }
  if (tapText(xml, 'Continue')) {
    await sleep(3000);
    xml = dump();
    continue;
  }
  for (const label of ['Sign in', 'Sign In', 'Giriş yap', 'Log in', 'Already have an account']) {
    if (tapText(xml, label)) {
      await sleep(2500);
      xml = dump();
      break;
    }
  }
  await sleep(1500);
  xml = dump();
}

if (!xml.includes('auth-phone-input')) {
  console.error('[probe] not on sign-in screen');
  process.exit(2);
}

sh('adb logcat -c');
tapId(xml, 'auth-phone-input');
await sleep(300);
for (let i = 0; i < 20; i++) sh('adb shell input keyevent 67');
sh(`adb shell input text ${phone}`);
await sleep(400);
xml = dump();
if (!tapId(xml, 'auth-send-otp')) {
  console.error('[probe] send OTP button not found');
  process.exit(3);
}

console.log('[probe] tapped Send OTP, waiting 40s (silent reCAPTCHA)...');
await sleep(40_000);

const log = sh('adb logcat -d -s ReactNativeJS:I ReactNativeJS:W ReactNativeJS:E');
const hits = log
  .split('\n')
  .filter((l) =>
    /AUTH_PHONE|AUTH_OTP|RECAPTCHA|FALLBACK|CONFIRMATION|OTP send|missing-client|MODAL_READY/i.test(l),
  );
console.log('\n=== AUTH LOGS ===\n');
console.log(hits.slice(-30).join('\n') || '(empty)');

const joined = hits.join('\n');
if (/AUTH_CONFIRMATION_RECEIVED|AUTH_OTP_FALLBACK_OK|AUTH_OTP_NATIVE_OK|AUTH_RECAPTCHA_TOKEN_OK/.test(joined)) {
  console.log('\nRESULT: PASS — OTP send succeeded');
  if (/AUTH_RECAPTCHA_MODAL_READY/.test(joined) && !/mode.*invisible/i.test(joined)) {
    console.log('NOTE: visible reCAPTCHA modal appeared (unexpected)');
  }
  if (/AUTH_FALLBACK_INVISIBLE_RECAPTCHA|mode.*invisible/i.test(joined)) {
    console.log('NOTE: used silent invisible fallback after native Play Integrity');
  }
  process.exit(0);
}

if (/AUTH_RECAPTCHA_MODAL_READY/.test(joined)) {
  console.log('\nRESULT: FAIL — visible checkbox modal shown (should be silent)');
  process.exit(1);
}

console.log('\nRESULT: FAIL — OTP did not complete');
process.exit(1);
