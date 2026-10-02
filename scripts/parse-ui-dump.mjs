#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';

const file = process.argv[2] || path.join(os.tmpdir(), 'ui-si.xml');
const xml = fs.readFileSync(file, 'utf8');
const texts = [...xml.matchAll(/text="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
console.log('TEXTS:', texts.slice(0, 40).join(' | '));
for (const id of ['auth-phone-input', 'auth-send-otp']) {
  const re = new RegExp(
    `resource-id="[^"]*${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  );
  const m = xml.match(re);
  console.log(id, m ? `${Math.floor((+m[1] + +m[3]) / 2)},${Math.floor((+m[2] + +m[4]) / 2)}` : 'NOT_FOUND');
}
