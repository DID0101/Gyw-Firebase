import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const xmlPath = path.join(os.tmpdir(), 'gyw-ui.xml');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function refresh() {
  execSync('adb shell uiautomator dump /sdcard/gyw-ui.xml', { stdio: 'ignore' });
  execSync(`adb pull /sdcard/gyw-ui.xml "${xmlPath}"`, { stdio: 'ignore' });
  return fs.readFileSync(xmlPath, 'utf8');
}

function tapText(xml, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = xml.match(new RegExp(`text="${esc}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
  if (!m) return false;
  const x = Math.floor((+m[1] + +m[3]) / 2);
  const y = Math.floor((+m[2] + +m[4]) / 2);
  execSync(`adb shell input tap ${x} ${y}`);
  console.log('tap', label, x, y);
  return true;
}

function texts(xml) {
  return [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1]);
}

(async () => {
  let xml = refresh();
  tapText(xml, 'Permissions');
  await sleep(2000);
  xml = refresh();
  console.log('permissions screen:', texts(xml).join(' | '));
  for (const label of ['Display over other apps', 'Phone', 'Notifications']) {
    xml = refresh();
    if (tapText(xml, label)) {
      await sleep(1500);
      xml = refresh();
      if (tapText(xml, 'Allow') || tapText(xml, 'ALLOW')) console.log('allowed', label);
      await sleep(1000);
      execSync('adb shell input keyevent 4', { stdio: 'ignore' });
      await sleep(800);
    }
  }
  execSync('adb shell appops set com.gyw1.chat SYSTEM_ALERT_WINDOW allow', { stdio: 'ignore' });
  try {
    execSync('adb shell pm grant com.gyw1.chat android.permission.POST_NOTIFICATIONS', { stdio: 'ignore' });
  } catch {
    /* optional */
  }
  console.log('done');
})();
