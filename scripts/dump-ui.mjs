#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const p = path.join(os.tmpdir(), 'gyw-dump-ui.xml');
execSync('adb shell uiautomator dump /sdcard/gyw-dump-ui.xml', { stdio: 'ignore' });
execSync(`adb pull /sdcard/gyw-dump-ui.xml "${p}"`, { stdio: 'ignore' });
const xml = fs.readFileSync(p, 'utf8');
const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
console.log('TEXTS:', texts.join(' | '));
console.log('auth-phone-input:', xml.includes('auth-phone-input'));
console.log('auth-send-otp:', xml.includes('auth-send-otp'));
