#!/usr/bin/env node
/**
 * Enter OTP on sign-in screen and tap Verify. Requires code on screen already.
 * Usage: AUTH_PROBE_CODE=123456 node scripts/sign-in-verify-otp.mjs
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const code = process.env.AUTH_PROBE_CODE;
if (!code || code.length !== 6) {
  console.error('Set AUTH_PROBE_CODE to the 6-digit SMS code');
  process.exit(1);
}

function shIgnore(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    /* ignore */
  }
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function dump() {
  const p = path.join(os.tmpdir(), 'gyw-verify.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-verify.xml');
  shIgnore(`adb pull /sdcard/gyw-verify.xml "${p}"`);
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

(async () => {
  shIgnore('adb logcat -c');
  let xml = dump();
  const fields = [...xml.matchAll(/class="android.widget.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)];
  if (fields.length > 0) {
    const m = fields[fields.length - 1];
    const x = Math.floor((+m[1] + +m[3]) / 2);
    const y = Math.floor((+m[2] + +m[4]) / 2);
    shIgnore(`adb shell input tap ${x} ${y}`);
    await sleep(300);
    shIgnore(`adb shell input text ${code}`);
  }
  await sleep(400);
  xml = dump();
  const tapped =
    tapText(xml, 'Verify') ||
    tapText(xml, 'Doğrula') ||
    tapText(xml, 'Send code');
  console.log('[verify-otp] tapped verify:', tapped);
  await sleep(12000);
  const log = execSync('adb logcat -d -s ReactNativeJS:I ReactNativeJS:W', { encoding: 'utf8' });
  const lines = log.split('\n').filter((l) => /AUTH_VERIFY|OTP verify|internal/i.test(l));
  console.log(lines.join('\n') || '(no verify logs)');
  xml = dump();
  const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
  console.log('UI:', texts.slice(0, 15).join(' | '));
})();
