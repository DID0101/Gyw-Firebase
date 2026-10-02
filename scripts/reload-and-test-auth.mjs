#!/usr/bin/env node
/**
 * Reload dev client, navigate to sign-in, send OTP, report auth logs.
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

function readUi() {
  const dumpPath = path.join(os.tmpdir(), 'gyw-reload-test.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-reload-test.xml');
  shIgnore(`adb pull /sdcard/gyw-reload-test.xml "${dumpPath}"`);
  if (!fs.existsSync(dumpPath)) return '';
  return fs.readFileSync(dumpPath, 'utf8');
}

function centerFromBounds(m) {
  return {
    x: Math.floor((+m[1] + +m[3]) / 2),
    y: Math.floor((+m[2] + +m[4]) / 2),
  };
}

function findText(xml, labels) {
  for (const label of labels) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
    const m = xml.match(re);
    if (m) return centerFromBounds(m);
  }
  return null;
}

function findId(xml, id) {
  const re = new RegExp(
    `resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  );
  const m = xml.match(re);
  return m ? centerFromBounds(m) : null;
}

function tap(c) {
  if (!c) return;
  shIgnore(`adb shell input tap ${c.x} ${c.y}`);
}

function dismissOverlays(xml) {
  if (xml.includes('There was a problem loading')) {
    const reload = findText(xml, ['Reload']);
    if (reload) {
      console.log('[reload-test] tap Reload on error screen');
      tap(reload);
      return true;
    }
  }
  if (xml.includes('Log ') && xml.includes('Console Error')) {
    const dismiss = findText(xml, ['Dismiss', 'Minimize']);
    if (dismiss) {
      console.log('[reload-test] tap LogBox Dismiss/Minimize', dismiss);
      tap(dismiss);
    } else {
      console.log('[reload-test] dismiss LogBox via back');
      shIgnore('adb shell input keyevent 4');
    }
    return true;
  }
  return false;
}

async function settleUi(maxRounds = 8) {
  let xml = readUi();
  for (let i = 0; i < maxRounds; i++) {
    if (findId(xml, 'auth-phone-input')) return xml;
    if (findText(xml, ['Continue', 'Devam', 'Dowam et', 'Продолжить'])) return xml;
    if (dismissOverlays(xml)) {
      await sleep(1500);
      xml = readUi();
      continue;
    }
    await sleep(1000);
    xml = readUi();
  }
  return xml;
}

(async () => {
  console.log('[reload-test] adb reverse + relaunch');
  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore(`adb shell am force-stop ${pkg}`);
  shIgnore(`adb shell am start -a android.intent.action.VIEW -d "${devClientUri}" -p ${pkg}`);

  console.log('[reload-test] wait for cached bundle (35s)');
  await sleep(35000);

  let xml = await settleUi();

  if (xml.includes('Development Build') && (xml.includes('127.0.0.1:8081') || xml.includes('localhost:8081'))) {
    const recent = findText(xml, ['http://127.0.0.1:8081', 'http://localhost:8081']);
    console.log('[reload-test] open recent Metro', recent);
    tap(recent);
    await sleep(50000);
    xml = await settleUi(12);
  }

  if (!findId(xml, 'auth-phone-input')) {
    const cont = findText(xml, ['Continue', 'Devam', 'Dowam et', 'Продолжить']);
    console.log('[reload-test] Continue', cont);
    tap(cont);
    await sleep(3000);
    xml = await settleUi();
    const signIn = findText(xml, ['Sign in', 'Giriş yap', 'Girmek', 'Войти']);
    console.log('[reload-test] Sign in', signIn);
    tap(signIn);
    await sleep(3000);
    xml = await settleUi();
  }

  const phoneField = findId(xml, 'auth-phone-input');
  const sendBtn = findId(xml, 'auth-send-otp');
  console.log('[reload-test] sign-in fields', { phoneField, sendBtn });

  if (!phoneField || !sendBtn) {
    const texts = [...xml.matchAll(/text="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    console.log('[reload-test] visible text:', texts.slice(0, 20).join(' | '));
    process.exit(3);
  }

  shIgnore('adb logcat -c');
  tap(phoneField);
  await sleep(400);
  shIgnore(`adb shell input text ${phone}`);
  await sleep(400);
  tap(sendBtn);

  console.log('[reload-test] wait for OTP flow (25s)');
  await sleep(25000);

  const log = shIgnore(
    'adb logcat -d -s ReactNativeJS:I ReactNativeJS:W ReactNativeJS:E AUTH_PHONE FirebaseAuth',
  );
  const lines = log
    .split('\n')
    .filter(
      (l) =>
        l.includes('AUTH_PHONE') ||
        l.includes('AUTH_DEV_BYPASS') ||
        l.includes('AUTH_RECAPTCHA') ||
        l.includes('invalid-api-key') ||
        l.includes('too-many-requests'),
    );

  console.log('\n=== AUTH LOGS ===\n');
  console.log(lines.join('\n') || '(empty)');

  const joined = lines.join('\n');
  console.log('\n=== RESULT ===');
  console.log('APP_LOADED:', joined.includes('AUTH_RECAPTCHA_MODAL_REGISTERED') || joined.includes('AUTH_READY'));
  console.log('DEV_BYPASS_READY:', joined.includes('AUTH_DEV_BYPASS_READY'));
  console.log('OTP_CONFIRMATION:', joined.includes('AUTH_CONFIRMATION_RECEIVED'));
  console.log('RECAPTCHA_MODAL_READY:', joined.includes('AUTH_RECAPTCHA_MODAL_READY') || joined.includes('"ready":true'));
  console.log('RECAPTCHA_TOKEN_OK:', joined.includes('AUTH_RECAPTCHA_TOKEN_OK'));
  console.log('INVALID_API_KEY:', joined.includes('invalid-api-key'));
  console.log('RATE_LIMITED:', joined.includes('too-many-requests'));

  if (joined.includes('AUTH_DEV_BYPASS_READY') || joined.includes('AUTH_CONFIRMATION_RECEIVED')) {
    process.exit(0);
  }
  if (joined.includes('invalid-api-key')) process.exit(2);
  process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
