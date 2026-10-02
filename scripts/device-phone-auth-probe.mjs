#!/usr/bin/env node
/**
 * Device probe: launch app, tap Send OTP on sign-in, dump AUTH_PHONE / FirebaseAuth logcat.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const phone = process.env.AUTH_PROBE_PHONE || '905369936898';
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

function readUiDump() {
  const dumpPath = path.join(os.tmpdir(), 'gyw-ui-probe.xml');
  shIgnore('adb shell uiautomator dump /sdcard/ui-probe.xml');
  shIgnore(`adb pull /sdcard/ui-probe.xml "${dumpPath}"`);
  if (!fs.existsSync(dumpPath)) return '';
  return fs.readFileSync(dumpPath, 'utf8');
}

function tapCenter(bounds) {
  shIgnore(`adb shell input tap ${bounds.x} ${bounds.y}`);
}

function findByResourceId(xml, id) {
  const re = new RegExp(
    `resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  );
  const m = xml.match(re);
  if (!m) return null;
  return {
    x: Math.floor((+m[1] + +m[3]) / 2),
    y: Math.floor((+m[2] + +m[4]) / 2),
  };
}

function findByText(xml, labels) {
  for (const label of labels) {
    const re = new RegExp(
      `text="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    );
    const m = xml.match(re);
    if (m) {
      return {
        x: Math.floor((+m[1] + +m[3]) / 2),
        y: Math.floor((+m[2] + +m[4]) / 2),
      };
    }
  }
  return null;
}

function tapFromUiDump() {
  const xml = readUiDump();
  if (!xml) return null;
  return {
    phone: findByResourceId(xml, 'auth-phone-input'),
    send: findByResourceId(xml, 'auth-send-otp'),
  };
}

async function navigateToSignIn() {
  let xml = readUiDump();
  if (findByResourceId(xml, 'auth-phone-input')) {
    console.log('[probe] already on sign-in');
    return;
  }

  const continueBtn = findByText(xml, ['Continue', 'Devam', 'Dowam et', 'Продолжить']);
  if (continueBtn) {
    console.log('[probe] tap Continue', continueBtn);
    tapCenter(continueBtn);
    await sleep(4000);
    xml = readUiDump();
  }

  const signInLink = findByText(xml, ['Sign in', 'Giriş yap', 'Girmek', 'Войти']);
  if (signInLink) {
    console.log('[probe] tap Sign in link', signInLink);
    tapCenter(signInLink);
    await sleep(4000);
    return;
  }

  console.log('[probe] navigation fallback — bottom-center taps');
  tapCenter({ x: 360, y: 1477 });
  await sleep(4000);
  tapCenter({ x: 280, y: 1180 });
  await sleep(4000);
}

(async () => {
  console.log('[probe] adb reverse + logcat clear');
  shIgnore('adb reverse tcp:8081 tcp:8081');
  shIgnore('adb logcat -c');
  shIgnore(`adb shell am force-stop ${pkg}`);

  console.log('[probe] launch dev client -> Metro');
  shIgnore(
    `adb shell am start -a android.intent.action.VIEW -d "${devClientUri}" -p ${pkg}`,
  );

  console.log('[probe] wait for bundle (45s)…');
  await sleep(45000);

  await navigateToSignIn();

  let coords = tapFromUiDump();
  if (!coords?.phone || !coords?.send) {
    console.log('[probe] testID not found, fallback coordinates');
    coords = {
      phone: { x: 540, y: 1050 },
      send: { x: 540, y: 1250 },
    };
  } else {
    console.log('[probe] taps from testID', coords);
  }

  shIgnore(`adb shell input tap ${coords.phone.x} ${coords.phone.y}`);
  await sleep(500);
  shIgnore(`adb shell input text ${phone}`);
  await sleep(500);
  shIgnore(`adb shell input tap ${coords.send.x} ${coords.send.y}`);

  console.log('[probe] wait for Firebase auth (20s)…');
  await sleep(20000);

  const log = shIgnore('adb logcat -d -s AUTH_PHONE FirebaseAuth RecaptchaActivity ReactNativeJS:I');
  const authLines = log
    .split('\n')
    .filter(
      (l) =>
        l.includes('AUTH_PHONE') ||
        l.includes('FirebaseAuth') ||
        l.includes('RecaptchaActivity') ||
        l.includes('[AUTH_PHONE]'),
    )
    .join('\n');

  console.log('\n=== LOGCAT ===\n');
  console.log(authLines || '(empty)');

  const ok =
    authLines.includes('AUTH_CONFIRMATION_RECEIVED') ||
    authLines.includes('AUTH_DEV_BYPASS_READY') ||
    authLines.includes('onCodeSent') ||
    authLines.includes('AUTH_CONFIRMATION');
  const failEncryption = authLines.includes('Could not generate an encryption key');
  const failMissing =
    authLines.includes('missing-client-identifier') || authLines.includes('17093');
  const recaptchaReady =
    authLines.includes('AUTH_RECAPTCHA_MODAL_READY') || authLines.includes('ready":true');
  const recaptchaOk = authLines.includes('AUTH_RECAPTCHA_TOKEN_OK');
  const invalidApiKey = authLines.includes('invalid-api-key');

  console.log('\n=== PROBE RESULT ===');
  console.log('NATIVE_FIX_DEPLOYED:', authLines.includes('AUTH_LIFECYCLE_TRACER_REGISTERED'));
  console.log('OTP_SUCCESS:', ok);
  console.log('DEV_BYPASS:', authLines.includes('AUTH_DEV_BYPASS_READY'));
  console.log('RECAPTCHA_READY:', recaptchaReady);
  console.log('RECAPTCHA_TOKEN_OK:', recaptchaOk);
  console.log('INVALID_API_KEY:', invalidApiKey);
  console.log('RECAPTCHA_ENCRYPTION_FAIL:', failEncryption);
  console.log('MISSING_CLIENT_IDENTIFIER:', failMissing);
  console.log('RATE_LIMITED:', authLines.includes('too-many-requests'));

  if (failEncryption) process.exit(2);
  if (failMissing && !ok) process.exit(1);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
