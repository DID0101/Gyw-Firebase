import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const p = path.join(os.tmpdir(), 'gyw-ui-debug.xml');
execSync('adb shell uiautomator dump /sdcard/gyw-ui-debug.xml');
execSync(`adb pull /sdcard/gyw-ui-debug.xml "${p}"`);
const x = fs.readFileSync(p, 'utf8');
const idx = x.indexOf('Continue');
console.log('Continue idx', idx);
if (idx >= 0) console.log(x.slice(Math.max(0, idx - 120), idx + 200));
console.log('\nAll nodes with Continue:');
for (const m of x.matchAll(/<node[^>]*Continue[^>]*>/g)) console.log(m[0].slice(0, 400));
