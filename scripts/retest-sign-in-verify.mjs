#!/usr/bin/env node
/**
 * Retest sign-in OTP: reload app, reset flow, send OTP, monitor verify logs.
 * Complete reCAPTCHA on device; enter SMS code within 2 min for full verify test.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const phone = process.env.AUTH_PROBE_PHONE || '905526055202';
const metroUrl = encodeURIComponent('http://127.0.0.1:8081');
const devClientUri = `exp+gyw://expo-development-client/?url=${metroUrl}`;

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
function dump() {
  const p = path.join(os.tmpdir(), 'gyw-retest.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-retest.xml');
  shIgnore(`adb pull /sdcard/gyw-retest.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function tapText(xml, labels) {
  const list = Array.isArray(labels) ? labels : [labels];
  for (const label of list) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
    const m = xml.match(re);
    if (m) {
      const x = Math.floor((+m[1] + +m[3]) / 2);
      const y = Math.floor((+m[2] + +m[4]) / 2);
      shIgnore(`adb shell input tap ${x} ${y}`);
      return label;
    }
  }
  return null;
}
function tapId(xml, id) {
  const re = new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  shIgnore(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}

async function goSignInFresh() {
  let xml = dump();

  for (let round = 0; round < 6; round++) {
    if (xml.includes('auth-phone-input')) return true;

    if (tapText(xml, 'OK')) {
      await sleep(1500);
      xml = dump();
      continue;
    }
    if (tapText(xml, ['Sign in', 'Giriş yap'])) {
      await sleep(2500);
      xml = dump();
      continue;
    }
    if (tapText(xml, ['Wrong phone number?', 'auth.wrongPhoneNumber', 'Wrong phone'])) {
      await sleep(1500);
      xml = dump();
      continue;
    }
    if (tapText(xml, ['Verify', 'auth.verify', 'common.verify'])) {
      await sleep(500);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'Try again')) {
      await sleep(5000);
      xml = dump();
      continue;
    }
    if (xml.includes('http://127.0.0.1:8081') || xml.includes('localhost:8081')) {
      tapText(xml, ['http://127.0.0.1:8081', 'http://localhost:8081']);
      await sleep(45000);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'Continue')) {
      await sleep(2500);
      xml = dump();
      continue;
    }
    await sleep(1500);
    xml = dump();
  }
  return xml.includes('auth-phone-input');
}

function readAuthLogs() {
  const log = shIgnore('adb logcat -d -s ReactNativeJS:I ReactNativeJS:W ReactNativeJS:E');
  return log.split('\n').filter((l) =>
    /AUTH_PHONE|AUTH_VERIFY|OTP verify|client\/phone-credential|AUTH_CONFIRMATION/i.test(l),
  );
}

(async () => {
  console.log('[retest] phone', phone);
  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore(`adb shell am force-stop ${pkg}`);
  shIgnore(`adb shell am start -a android.intent.action.VIEW -d "${devClientUri}" -p ${pkg}`);
  console.log('[retest] waiting for bundle (40s)');
  await sleep(40000);

  const onSignIn = await goSignInFresh();
  if (!onSignIn) {
    const xml = dump();
    const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
    console.error('[retest] not on sign-in:', texts.join(' | '));
    process.exit(3);
  }

  shIgnore('adb logcat -c');
  let xml = dump();
  tapId(xml, 'auth-phone-input');
  await sleep(400);
  for (let i = 0; i < 24; i++) shIgnore('adb shell input keyevent 67');
  shIgnore(`adb shell input text ${phone}`);
  await sleep(400);
  xml = dump();
  if (!tapId(xml, 'auth-send-otp')) {
    console.error('[retest] send button missing');
    process.exit(4);
  }

  console.log('[retest] OTP sent tap — complete reCAPTCHA on device, then enter SMS code + Verify');
  console.log('[retest] monitoring logs for 120s...');

  const started = Date.now();
  let lastCount = 0;
  while (Date.now() - started < 120000) {
    await sleep(8000);
    const lines = readAuthLogs();
    const newLines = lines.slice(lastCount);
    if (newLines.length) {
      console.log(newLines.join('\n'));
      lastCount = lines.length;
    }
    if (lines.some((l) => l.includes('AUTH_VERIFY_SUCCESS'))) {
      console.log('\n[retest] PASS — verify succeeded');
      process.exit(0);
    }
    if (lines.some((l) => l.includes('client/phone-credential') && l.includes('AUTH_VERIFY_FAILED'))) {
      console.log('\n[retest] FAIL — client credential verify failed (see logs above)');
      process.exit(2);
    }
  }

  const final = readAuthLogs();
  console.log('\n=== FINAL AUTH LOGS ===\n');
  console.log(final.join('\n') || '(empty)');

  if (final.some((l) => l.includes('AUTH_CONFIRMATION_RECEIVED'))) {
    console.log('\n[retest] OTP send OK — enter SMS on device and tap Verify (client/phone-credential path)');
    process.exit(0);
  }
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
