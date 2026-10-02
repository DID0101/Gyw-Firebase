#!/usr/bin/env node
/** Dev bypass sign-in: verify no post-auth sign-out (profile read fix). */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const phone = '905369936898';
const code = '123456';

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
  const p = path.join(os.tmpdir(), 'gyw-dev-auth.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-dev-auth.xml');
  shIgnore(`adb pull /sdcard/gyw-dev-auth.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function tapId(xml, id) {
  const re = new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  shIgnore(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}
function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  shIgnore(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}

async function goSignIn() {
  let xml = dump();
  for (let i = 0; i < 10; i++) {
    if (xml.includes('auth-phone-input')) return true;
    if (tapText(xml, 'OK')) {
      await sleep(1500);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'Sign in') || tapText(xml, 'Giriş yap')) {
      await sleep(2000);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'Continue')) {
      await sleep(2000);
      xml = dump();
      continue;
    }
    await sleep(1500);
    xml = dump();
  }
  return xml.includes('auth-phone-input');
}

function authLogs() {
  return shIgnore('adb logcat -d -s ReactNativeJS:I ReactNativeJS:W ReactNativeJS:E')
    .split('\n')
    .filter((l) =>
      /AUTH_VERIFY_SUCCESS|AUTH_SIGN_OUT|AUTH_OTP_VERIFY_OK|accountNotRegistered|ChatsTab|SignIn/i.test(l),
    );
}

(async () => {
  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore('adb logcat -c');

  let xml = dump();
  if (!(await goSignIn())) {
    console.error('[dev-auth-test] could not reach sign-in');
    process.exit(2);
  }

  xml = dump();
  tapId(xml, 'auth-phone-input');
  await sleep(300);
  for (let i = 0; i < 20; i++) shIgnore('adb shell input keyevent 67');
  shIgnore(`adb shell input text ${phone}`);
  await sleep(400);
  xml = dump();
  if (!tapId(xml, 'auth-send-otp')) {
    console.error('[dev-auth-test] send OTP button missing');
    process.exit(3);
  }
  await sleep(5000);

  xml = dump();
  tapText(xml, 'OK');
  await sleep(800);
  xml = dump();
  tapId(xml, 'auth-otp-input');
  await sleep(300);
  shIgnore(`adb shell input text ${code}`);
  await sleep(400);
  xml = dump();
  if (!tapId(xml, 'auth-verify-otp')) {
    tapText(xml, 'Verify');
  }

  console.log('[dev-auth-test] waiting 15s for auth flow...');
  await sleep(15000);

  const lines = authLogs();
  console.log(lines.join('\n') || '(no matching logs)');

  const verified = lines.some((l) => l.includes('AUTH_VERIFY_SUCCESS') || l.includes('AUTH_OTP_VERIFY_OK'));
  const signedOut = lines.some((l) => l.includes('AUTH_SIGN_OUT'));
  const onChats = lines.some((l) => l.includes('ChatsTab'));

  if (verified && !signedOut) {
    console.log('\n[dev-auth-test] PASS — verified without sign-out');
    process.exit(0);
  }
  if (verified && signedOut) {
    console.log('\n[dev-auth-test] FAIL — verified then signed out');
    process.exit(1);
  }
  console.log('\n[dev-auth-test] INCONCLUSIVE — check device manually');
  process.exit(4);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
