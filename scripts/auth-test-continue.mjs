#!/usr/bin/env node
/**
 * Continue sign-in test from current screen (no pm clear / force-stop).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pkg = 'com.gyw1.chat';
const phone = (process.env.AUTH_PROBE_PHONE || '905526055202').replace(/^\+/, '');

function shIgnore(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    /* */
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function dump() {
  const p = path.join(os.tmpdir(), 'gyw-ui.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-ui.xml');
  shIgnore(`adb pull /sdcard/gyw-ui.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}
function uiTexts(xml) {
  return [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}
function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
  if (!m) return false;
  shIgnore(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}
function tapId(xml, id) {
  const m = xml.match(new RegExp(`resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
  if (!m) return false;
  shIgnore(`adb shell input tap ${Math.floor((+m[1] + +m[3]) / 2)} ${Math.floor((+m[2] + +m[4]) / 2)}`);
  return true;
}

(async () => {
  console.log('[continue] Open Gyw on your phone. Tap ALLOW if overlay dialog shows.');
  let xml = '';
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    xml = dump();
    const texts = uiTexts(xml);
    const line = texts.join(' | ');
    if (texts.some((t) => /overlay on the lock/i.test(t))) {
      if (i % 5 === 0) console.log(`[continue] waiting overlay dismiss… (${i})`);
      continue;
    }
    if (xml.includes('auth-phone-input') || texts.includes('Continue') || texts.includes('Sign in')) {
      console.log('[continue] ready:', line.slice(0, 120));
      break;
    }
    if (i % 10 === 0) console.log('[continue] current:', line.slice(0, 100));
  }

  if (!xml.includes('auth-phone-input')) {
    if (tapText(xml, 'Continue')) await sleep(2500);
    xml = dump();
    if (tapText(xml, 'Sign in')) await sleep(2500);
    xml = dump();
  }
  if (!xml.includes('auth-phone-input')) {
    console.error('[continue] FAIL: not on sign-in. Open Gyw → Sign in manually.');
    console.error(uiTexts(xml).join(' | '));
    process.exit(1);
  }

  tapId(xml, 'auth-phone-input');
  await sleep(400);
  for (let i = 0; i < 30; i++) shIgnore('adb shell input keyevent 67');
  shIgnore(`adb shell input text %2B${phone}`);
  await sleep(500);
  xml = dump();
  tapId(xml, 'auth-send-otp');
  console.log('[continue] OTP send tapped — complete reCAPTCHA on device (60s)…');
  await sleep(60000);
  xml = dump();
  const texts = uiTexts(xml);
  console.log('[continue] UI:', texts.join(' | '));
  const onRecaptcha = texts.some((t) => /human|not a robot|bridges/i.test(t));
  const onOtp = xml.includes('auth-verify-otp') || texts.some((t) => /enter.*code|6.digit/i.test(t));
  if (onRecaptcha) console.log('RESULT: complete reCAPTCHA on phone');
  else if (onOtp) console.log('RESULT: OTP screen — enter SMS code on phone or send code here');
  else console.log('RESULT: check device');
})();
