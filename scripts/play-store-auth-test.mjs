#!/usr/bin/env node
/**
 * Play Store build auth test via USB (adb + uiautomator).
 * Usage: node scripts/play-store-auth-test.mjs [sign-in|sign-up|both]
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const mode = process.argv[2] || 'both';
const signInPhone = process.env.AUTH_PROBE_PHONE || '905526055202';
const signUpPhone = (process.env.AUTH_SIGNUP_PHONE || '905551234567').replace(/^\+/, '');

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
  const p = path.join(os.tmpdir(), 'gyw-play-auth.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-play-auth.xml');
  shIgnore(`adb pull /sdcard/gyw-play-auth.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function uiTexts(xml) {
  return [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

function tapBounds(x, y) {
  shIgnore(`adb shell input tap ${Math.round(x)} ${Math.round(y)}`);
}

function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  tapBounds((+m[1] + +m[3]) / 2, (+m[2] + +m[4]) / 2);
  return true;
}

function tapId(xml, id) {
  const re = new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return false;
  tapBounds((+m[1] + +m[3]) / 2, (+m[2] + +m[4]) / 2);
  return true;
}

async function waitPastOverlay(maxMs = 90000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const xml = dump();
    const texts = uiTexts(xml);
    if (!texts.some((t) => /overlay on the lock/i.test(t))) return true;
    await sleep(2000);
  }
  return false;
}

async function launchFresh() {
  const skipClear = process.env.AUTH_TEST_SKIP_CLEAR === '1';
  if (!skipClear) {
    shIgnore(`adb shell pm clear ${pkg}`);
    await sleep(1500);
  } else {
    shIgnore(`adb shell am force-stop ${pkg}`);
    await sleep(800);
  }
  shIgnore(`adb shell am start -n ${pkg}/.MainActivity`);
  console.log('[play-auth] waiting 10s for cold start…');
  await sleep(10000);
  if (!(await waitPastOverlay(15000))) {
    console.log('[play-auth] WARN: overlay dialog still visible — tap ALLOW on device');
    await waitPastOverlay(120000);
  }
}

async function goWelcomeToSignUp() {
  let xml = dump();
  if (uiTexts(xml).some((t) => t.includes('Create an account'))) return xml;
  if (!tapText(xml, 'Continue')) tapBounds(360, 1477);
  await sleep(3000);
  return dump();
}

async function goToSignIn() {
  let xml = await goWelcomeToSignUp();
  if (xml.includes('auth-phone-input')) return xml;
  tapText(xml, 'Sign in');
  await sleep(2500);
  return dump();
}

async function signOutIfNeeded() {
  let xml = dump();
  if (!uiTexts(xml).some((t) => t === 'Chats' || t.includes('Gyw'))) return;
  tapBounds(50, 120);
  await sleep(1500);
  xml = dump();
  if (!tapText(xml, 'Sign out')) tapText(xml, 'Sign Out');
  await sleep(4000);
}

async function testSignIn() {
  console.log('\n=== SIGN IN TEST ===');
  shIgnore('adb logcat -c');
  if (process.env.AUTH_TEST_NO_LAUNCH !== '1') {
    await launchFresh();
  } else {
    shIgnore(`adb shell am start -n ${pkg}/.MainActivity`);
    await sleep(5000);
    await waitPastOverlay(30000);
  }
  let xml = await goToSignIn();
  if (!xml.includes('auth-phone-input')) {
    console.error('[play-auth] FAIL: not on sign-in. UI:', uiTexts(xml).join(' | '));
    return false;
  }
  tapId(xml, 'auth-phone-input');
  await sleep(400);
  for (let i = 0; i < 30; i++) shIgnore('adb shell input keyevent 67');
  shIgnore(`adb shell input text %2B${signInPhone.replace(/^\+/, '')}`);
  await sleep(500);
  xml = dump();
  if (!tapId(xml, 'auth-send-otp')) {
    console.error('[play-auth] FAIL: send OTP button missing');
    return false;
  }
  console.log('[play-auth] OTP send tapped. Complete reCAPTCHA on device if shown (60s)…');
  await sleep(60000);
  xml = dump();
  const texts = uiTexts(xml);
  console.log('[play-auth] UI after send:', texts.join(' | '));

  const log = shIgnore('adb logcat -d -t 600');
  const authLines = log
    .split('\n')
    .filter((l) =>
      /PROD_DEBUG|AUTH_|AUTH_PHONE|AUTH_STATE|RECAPTCHA|ReactNativeJS|globalError|OTP|missing-client|failed-precondition|SignIn|SCREEN_MOUNTED/i.test(l),
    );
  console.log('\n--- Sign-in logs (last 40) ---');
  console.log(authLines.slice(-40).join('\n') || '(no auth lines)');

  const onRecaptcha = texts.some((t) => /human|not a robot|reCAPTCHA|bridges/i.test(t));
  const onOtp =
    xml.includes('auth-verify-otp') ||
    (texts.some((t) => /enter.*code|6.digit|verification code/i.test(t)) && !onRecaptcha);
  const onChats = texts.some((t) => t === 'Chats' || t.includes('Gyw'));
  const onErr = texts.some((t) => /error|failed|blocked|wrong/i.test(t));
  if (onRecaptcha) {
    console.log('\nRESULT SIGN-IN: WAITING — complete reCAPTCHA on device (checkbox / image challenge)');
    return true;
  }
  if (onOtp) {
    console.log('\nRESULT SIGN-IN: PASS — OTP entry screen visible');
    console.log('>>> Enter the 6-digit SMS code on your phone, or reply with the code to finish verify via adb <<<');
    return true;
  }
  if (onChats) {
    console.log('\nRESULT SIGN-IN: WARN — reached Chats without OTP step');
    return true;
  }
  if (onErr) {
    console.log('\nRESULT SIGN-IN: FAIL — error on screen');
    return false;
  }
  console.log('\nRESULT SIGN-IN: UNKNOWN — check device screen');
  return false;
}

async function testSignUp() {
  console.log('\n=== SIGN UP TEST ===');
  shIgnore('adb logcat -c');
  await launchFresh();
  let xml = await goWelcomeToSignUp();
  const texts = uiTexts(xml);
  if (!texts.some((t) => t.includes('Create an account'))) {
    console.error('[play-auth] FAIL: sign-up form not shown:', texts.join(' | '));
    return false;
  }
  console.log('[play-auth] PASS — sign-up form visible');

  // Tap through form fields (focus order)
  tapBounds(360, 320);
  await sleep(300);
  shIgnore('adb shell input text Test');
  shIgnore('adb shell input keyevent 61');
  shIgnore('adb shell input text User');
  shIgnore('adb shell input keyevent 61');
  shIgnore('adb shell input text playstoretest');
  shIgnore('adb shell input keyevent 61');
  shIgnore(`adb shell input text %2B${signUpPhone}`);
  await sleep(500);
  xml = dump();
  tapText(xml, 'Continue');
  console.log('[play-auth] Sign-up continue tapped. Complete reCAPTCHA if shown (60s)…');
  await sleep(60000);
  xml = dump();
  const after = uiTexts(xml);
  console.log('[play-auth] UI after sign-up continue:', after.join(' | '));

  const log = shIgnore('adb logcat -d -t 600');
  const authLines = log
    .split('\n')
    .filter((l) =>
      /PROD_DEBUG|AUTH_|AUTH_PHONE|RECAPTCHA|ReactNativeJS|account-already|already exists|OTP|failed-precondition/i.test(l),
    );
  console.log('\n--- Sign-up logs (last 40) ---');
  console.log(authLines.slice(-40).join('\n') || '(no auth lines)');

  const onOtp = after.some((t) => /code|verify|OTP/i.test(t));
  const exists = after.some((t) => /already exists|sign in/i.test(t));
  if (onOtp) {
    console.log('\nRESULT SIGN-UP: PASS — OTP step reached (or account check passed to OTP)');
    return true;
  }
  if (exists) {
    console.log('\nRESULT SIGN-UP: EXPECTED — phone already registered (use a new number for full signup)');
    return true;
  }
  console.log('\nRESULT SIGN-UP: check device for errors or username taken');
  return false;
}

(async () => {
  const devices = shIgnore('adb devices').split('\n').filter((l) => l.includes('\tdevice'));
  if (devices.length === 0) {
    console.error('[play-auth] No adb device. Connect phone with USB debugging.');
    process.exit(2);
  }
  console.log('[play-auth] device:', devices[0]);
  console.log('[play-auth] package:', pkg, 'mode:', mode);

  let ok = true;
  if (mode === 'sign-in' || mode === 'both') ok = (await testSignIn()) && ok;
  if (mode === 'sign-up' || mode === 'both') ok = (await testSignUp()) && ok;
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(99);
});
