import fs from 'fs';
import os from 'os';
import path from 'path';

const xml = fs.readFileSync(path.join(os.tmpdir(), 'gyw-ui.xml'), 'utf8');
for (const m of xml.matchAll(/text="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
  if (/ALLOW|DENIED|overlay|Allow/i.test(m[1])) {
    const cx = Math.floor((+m[2] + +m[4]) / 2);
    const cy = Math.floor((+m[3] + +m[5]) / 2);
    console.log(m[1], '->', cx, cy, `[${m[2]},${m[3]}][${m[4]},${m[5]}]`);
  }
}
