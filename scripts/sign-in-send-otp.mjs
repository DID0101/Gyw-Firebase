#!/usr/bin/env node
/**
 * Fill sign-in phone field and tap Send OTP.
 * Usage: AUTH_PROBE_PHONE=905526055202 node scripts/sign-in-send-otp.mjs
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const phone = process.env.AUTH_PROBE_PHONE || '905526055202';

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
function dump() {
  const p = path.join(os.tmpdir(), 'gyw-signin.xml');
  shIgnore('adb shell uiautomator dump /sdcard/gyw-signin.xml');
  shIgnore(`adb pull /sdcard/gyw-signin.xml "${p}"`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
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

let xml = dump();
if (!tapId(xml, 'auth-phone-input')) {
  console.error('auth-phone-input not found');
  process.exit(2);
}
await new Promise((r) => setTimeout(r, 400));
for (let i = 0; i < 20; i++) shIgnore('adb shell input keyevent 67');
shIgnore(`adb shell input text ${phone}`);
await new Promise((r) => setTimeout(r, 400));
xml = dump();
if (!tapId(xml, 'auth-send-otp')) {
  console.error('auth-send-otp not found');
  process.exit(3);
}
console.log(`[sign-in-send-otp] tapped Send OTP for +${phone.replace(/^\+/, '')}`);
