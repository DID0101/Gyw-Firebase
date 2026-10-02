import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function dump() {
  const p = path.join(os.tmpdir(), 'gyw-ui.xml');
  execSync('adb shell uiautomator dump /sdcard/gyw-ui.xml', { stdio: 'ignore' });
  execSync(`adb pull /sdcard/gyw-ui.xml "${p}"`, { stdio: 'ignore' });
  return fs.readFileSync(p, 'utf8');
}

function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
  if (!m) return false;
  const x = Math.floor((+m[1] + +m[3]) / 2);
  const y = Math.floor((+m[2] + +m[4]) / 2);
  execSync(`adb shell input tap ${x} ${y}`);
  console.log(`[dismiss] tapped "${label}" at ${x},${y}`);
  return true;
}

let xml = dump();
const labels = ['ALLOW', 'Allow', 'OK', 'Continue', 'DON’T ALLOW', "DON'T ALLOW"];
for (const l of labels) {
  if (l === 'DON’T ALLOW' || l === "DON'T ALLOW") continue;
  if (tapText(xml, l)) process.exit(0);
}
// Overlay dialog: prefer ALLOW over DENIED
if (tapText(xml, 'ALLOW')) process.exit(0);
console.log('[dismiss] no permission button found');
