#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const label = process.argv[2];
if (!label) {
  console.error('Usage: node tap-ui-text.mjs "Continue"');
  process.exit(1);
}

const dumpPath = path.join(os.tmpdir(), 'gyw-tap-ui.xml');
execSync('adb shell uiautomator dump /sdcard/gyw-tap-ui.xml', { stdio: 'ignore' });
execSync(`adb pull /sdcard/gyw-tap-ui.xml "${dumpPath}"`, { stdio: 'ignore' });
const xml = fs.readFileSync(dumpPath, 'utf8');
const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
const m = xml.match(re);
if (!m) {
  console.error('Not found:', label);
  process.exit(2);
}
const x = Math.floor((+m[1] + +m[3]) / 2);
const y = Math.floor((+m[2] + +m[4]) / 2);
execSync(`adb shell input tap ${x} ${y}`, { stdio: 'inherit' });
console.log('tapped', label, { x, y });
