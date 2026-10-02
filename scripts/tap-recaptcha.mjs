import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const xmlPath = path.join(os.tmpdir(), 'gyw-ui.xml');
const xml = fs.readFileSync(xmlPath, 'utf8');
const m = xml.match(/text="I'm not a robot"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (!m) {
  console.log('Checkbox not found');
  process.exit(1);
}
const x = Math.floor((+m[1] + +m[3]) / 2);
const y = Math.floor((+m[2] + +m[4]) / 2);
console.log('Tapping checkbox at', x, y);
execSync(`adb shell input tap ${x} ${y}`);
