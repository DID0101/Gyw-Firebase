#!/usr/bin/env node
/**
 * Full sign-in OTP probe for real phone (+905526055202 default).
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
  const p = path.join(os.tmpdir(), 'gyw-full-auth.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-full-auth.xml');
  shIgnore(`adb pull /sdcard/gyw-full-auth.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  const x = Math.floor((+m[1] + +m[3]) / 2);
  const y = Math.floor((+m[2] + +m[4]) / 2);
  shIgnore(`adb shell input tap ${x} ${y}`);
  return true;
}

function tapId(xml, id) {
  const re = new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  const x = Math.floor((+m[1] + +m[3]) / 2);
  const y = Math.floor((+m[2] + +m[4]) / 2);
  shIgnore(`adb shell input tap ${x} ${y}`);
  return true;
}

async function goSignIn() {
  let xml = dump();
  if (xml.includes('auth-phone-input')) return true;

  if (xml.includes('Try again')) {
    tapText(xml, 'Try again');
    await sleep(5000);
    xml = dump();
  }

  if (xml.includes('http://127.0.0.1:8081')) {
    tapText(xml, 'http://127.0.0.1:8081');
    await sleep(40000);
    xml = dump();
  }

  for (let i = 0; i < 3; i++) {
    if (xml.includes('auth-phone-input')) return true;
    if (tapText(xml, 'Continue')) {
      await sleep(2500);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'Sign in')) {
      await sleep(2500);
      xml = dump();
      continue;
    }
    if (tapText(xml, 'OK')) {
      await sleep(1500);
      xml = dump();
      if (tapText(xml, 'Sign in')) {
        await sleep(2500);
        xml = dump();
      }
      continue;
    }
    await sleep(1500);
    xml = dump();
  }
  return xml.includes('auth-phone-input');
}

(async () => {
  console.log('[full-auth] phone', phone);
  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore(`adb shell am force-stop ${pkg}`);
  shIgnore(`adb shell am start -a android.intent.action.VIEW -d "${devClientUri}" -p ${pkg}`);
  console.log('[full-auth] wait for bundle (35s)');
  await sleep(35000);

  const onSignIn = await goSignIn();
  if (!onSignIn) {
    const xml = dump();
    const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
    console.error('[full-auth] could not reach sign-in. texts:', texts.join(' | '));
    process.exit(3);
  }

  shIgnore('adb logcat -c');
  let xml = dump();
  tapId(xml, 'auth-phone-input');
  await sleep(400);
  for (let i = 0; i < 24; i++) shIgnore('adb shell input keyevent 67');
  shIgnore(`adb shell input text ${phone}`);
  await sleep(500);
  xml = dump();
  if (!tapId(xml, 'auth-send-otp')) {
    console.error('[full-auth] send button missing');
    process.exit(4);
  }

  console.log('[full-auth] waiting 50s for recaptcha + OTP (complete checkbox on device if shown)');
  await sleep(50000);

  const log = shIgnore('adb logcat -d -s ReactNativeJS:I ReactNativeJS:W ReactNativeJS:E');
  const lines = log.split('\n').filter((l) =>
    /AUTH_PHONE|AUTH_RECAPTCHA|account-not|checkPhone|failed-precondition|OTP send failed|DEV_BYPASS/i.test(l),
  );
  console.log('\n=== AUTH LOGS ===\n');
  console.log(lines.join('\n') || '(empty)');

  xml = dump();
  const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
  console.log('\n=== UI AFTER ===\n', texts.join(' | '));

  const joined = lines.join('\n');
  if (joined.includes('AUTH_RECAPTCHA_MODAL_READY') || joined.includes('AUTH_RECAPTCHA_CHECKBOX_START')) {
    console.log('\nRESULT: recaptcha flow started for real number');
  }
  if (joined.includes('AUTH_RECAPTCHA_TOKEN_OK') || joined.includes('AUTH_CONFIRMATION_RECEIVED')) {
    console.log('RESULT: OTP sent');
    process.exit(0);
  }
  if (texts.some((t) => t.includes('No account found') || t.includes('accountNotRegistered'))) {
    console.log('RESULT: blocked unregistered sign-in (pre-check)');
    process.exit(0);
  }
  if (texts.some((t) => t.includes('Enter the code') || t.includes('Enter code'))) {
    console.log('RESULT: OTP code entry visible');
    process.exit(0);
  }
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
