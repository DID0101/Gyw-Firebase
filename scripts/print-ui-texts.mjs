import fs from 'fs';
import os from 'os';
import path from 'path';

const xml = fs.readFileSync(path.join(os.tmpdir(), 'gyw-ui.xml'), 'utf8');
const texts = [...xml.matchAll(/text="([^"]{2,})"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
console.log(texts.join(' | '));
