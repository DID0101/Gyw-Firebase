import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const xmlPath = path.join(os.tmpdir(), 'gyw-ui.xml');
const xml = fs.readFileSync(xmlPath, 'utf8');

function tap(x, y) {
  execSync(`adb shell input tap ${Math.round(x)} ${Math.round(y)}`);
  console.log('tap', Math.round(x), Math.round(y));
}

// Tap Gyw row in overlay list
const gyw = xml.match(/text="Gyw"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (gyw) {
  tap((+gyw[1] + +gyw[3]) / 2, (+gyw[2] + +gyw[4]) / 2);
}

execSync('adb shell uiautomator dump /sdcard/gyw-ui.xml', { stdio: 'ignore' });
execSync(`adb pull /sdcard/gyw-ui.xml "${xmlPath}"`, { stdio: 'ignore' });
const xml2 = fs.readFileSync(xmlPath, 'utf8');
const texts = [...xml2.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
console.log('after gyw tap:', texts.slice(0, 15).join(' | '));

// Enable switch if on detail screen
const sw =
  xml2.match(/class="android\.widget\.Switch"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ||
  xml2.match(/clickable="true"[^>]*class="android\.widget\.Switch"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
if (sw) {
  tap((+sw[1] + +sw[3]) / 2, (+sw[2] + +sw[4]) / 2);
  console.log('toggled switch');
}

execSync('adb shell uiautomator dump /sdcard/gyw-ui.xml', { stdio: 'ignore' });
execSync(`adb pull /sdcard/gyw-ui.xml "${xmlPath}"`, { stdio: 'ignore' });
const xml3 = fs.readFileSync(xmlPath, 'utf8');
const texts3 = [...xml3.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
console.log('final:', texts3.slice(0, 20).join(' | '));
